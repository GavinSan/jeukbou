// 大局總覽：每張枱最新一鋪、統計、全場排名、最新動態、加枱
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Draw, PullPush, TableDoc } from '../lib/data.ts';
import { drawNext } from '../lib/data.ts';
import { sfx } from '../lib/sound.ts';
import { buzz } from '../lib/haptics.ts';
import { DrawBoard, DrawSetup } from './RegroupDraw.tsx';
import type { DrawTable } from './RegroupDraw.tsx';
import { Link } from '../lib/router.tsx';
import type { Computed } from '../lib/score.ts';
import { addPlay, ago, describe, emptyPlay, netOf, trendOf } from '../lib/score.ts';
import Awards, { PlayTable, kingsOf, paceOf } from './Awards.tsx';
import { Sparkline } from './Charts.tsx';
import { Avatar, Chips, ConfirmDelete, CopyLink, Hint, RollingNumber, fmt, Sheet, TopBar, message, tone, useNow, clampName } from '../ui.tsx';
import type { Candidate } from './TableScreen.tsx';
import { shuffle } from './SeatDraw.tsx';

const WINDS = ['東', '南', '西', '北'];

export interface SessionScreenProps {
  title: string;
  back: string;
  tables: TableDoc[];
  computed: Record<string, Computed | null>;
  tableHref: (tableId: string) => string;
  invite: string | null;
  rulesHref?: string;
  settleHref?: string;
  /** 電視直播 */
  liveHref?: string;
  /** 局主／管理員：刪除成個大局 */
  onDeleteSession?: () => Promise<void>;
  /** 呢局抽唔抽水（打牌嘅人揀） */
  water?: { on: boolean; onToggle: (on: boolean) => Promise<void> };
  /** 有人夠拉時推播通知邊個 */
  pullPush?: { value: PullPush; onChange: (v: PullPush) => Promise<void> };
  /** 埋數狀態 */
  closedNote?: ReactNode;
  notice?: ReactNode;
  candidates?: Candidate[];
  onAddTable?: (seats: Candidate[]) => Promise<void>;
  me?: string | null;
  /** 已埋數但撳咗「開枱」：去今日大局（冇就開新大局） */
  onClosedAdd?: () => void;
  /** 幾張枱一齊執位（抽牌）：任何坐緊嘅人提議；場主／局主可以直接開始 */
  regroup?: {
    draw: Draw | null;
    canForce: boolean;
    candidates: { id: string; name: string }[];
    onStart: (d: Draw) => Promise<void>;
    onApprove: () => Promise<void>;
    onPick: (tile: number, player: string) => Promise<'ok' | 'taken' | 'done-already' | 'not-turn'>;
    onAuto: () => Promise<void>;
    onCancel: () => Promise<void>;
    onApply: (plan: { keep: string | null; seats: string[]; names: Record<string, string>; name: string }[], endTables: string[]) => Promise<void>;
  };
}

/** 快圈紀錄：「快東」「快南」…；再打四圈就「加四圈」 */
function quickTags(c: Computed): string[] {
  const out: string[] = [];
  c.steps.forEach((st, i) => {
    if (st.event.type !== 'extend') return;
    const prev = i > 0 ? c.steps[i - 1].result.state : null;
    const turns = prev?.dealerTurns ?? 0;
    out.push((st.event.rounds ?? 1) >= 4 ? '加四圈' : `快${WINDS[Math.floor(turns / 4) % 4]}`);
  });
  return out;
}

export default function SessionScreen({ title, back, tables, computed, tableHref, invite, liveHref, rulesHref, onDeleteSession, water: waterCtl, pullPush, closedNote, notice, candidates = [], onAddTable, me = null, onClosedAdd, regroup: rg }: SessionScreenProps) {
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [delSession, setDelSession] = useState(false);
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [guest, setGuest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drawSetup, setDrawSetup] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const openTables = tables.filter((t) => computed[t.id] && !computed[t.id]!.state.ended);
  const drawTables: DrawTable[] = openTables.map((t) => ({ id: t.id, name: t.name, seats: computed[t.id]!.state.seats, names: t.names }));
  const draw = rg?.draw ?? null;
  const seatedMe = !!me && openTables.some((t) => computed[t.id]!.state.seats.includes(me));
  // 有人開始執位：參加嘅人自動彈個抽牌板出嚟（每次一次）
  const autoOpened = useRef('');
  useEffect(() => {
    if (!draw || !me) return;
    const key = `${draw.id}-${draw.status}`;
    if (autoOpened.current === key) return;
    if (draw.players.some((p) => p.id === me) || draw.by === me) { autoOpened.current = key; setBoardOpen(true); }
  }, [draw, me]);
  // 輪住揀：到我嗰陣彈個板出嚟、響一聲、震一下（每次輪到一次）
  const turnKey = useRef('');
  const myTurn = !!draw && !!draw.strict && draw.status === 'picking' && !!me && drawNext(draw) === me;
  useEffect(() => {
    if (!draw || !myTurn) return;
    const key = `${draw.id}-${Object.keys(draw.picks).length}`;
    if (turnKey.current === key) return;
    turnKey.current = key;
    setBoardOpen(true);
    sfx.chips();
    buzz('win');
  }, [myTurn, draw]);
  // 底部中間「＋ 開枱」：網址帶 #add-table 就打開加枱
  const canAdd = !!onAddTable;
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== '#add-table') return;
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* 唔緊要 */ }
      if (canAdd) { setAdding(true); setPicked([]); setError(''); }
      else onClosedAdd?.();
    };
    check();
    window.addEventListener('popstate', check);
    return () => window.removeEventListener('popstate', check);
  }, [canAdd]);

  const ranking = useMemo(() => {
    // 同一個人打過幾張枱：合埋一行，走勢接駁落去
    const byId = new Map<string, { id: string; name: string; table: string; net: number; spark: number[] }>();
    for (const t of [...tables].sort((a, b) => a.order - b.order)) {
      const c = computed[t.id];
      if (!c) continue;
      const ids = Object.keys(c.state.settled);
      const trend = trendOf(c, ids);
      for (const id of ids) {
        const net = (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0);
        const row = byId.get(id);
        if (!row) { byId.set(id, { id, name: t.names[id] ?? '玩家', table: t.name, net, spark: trend[id] }); continue; }
        const base = row.spark[row.spark.length - 1] ?? 0;
        row.spark = [...row.spark, ...trend[id].slice(1).map((v) => v + base)];
        row.net += net;
        row.table = `${row.table}、${t.name}`;
      }
    }
    return [...byId.values()].sort((a, b) => b.net - a.net);
  }, [tables, computed]);

  const feed = useMemo(() => {
    const items: { key: string; no: number; text: string; moves: { name: string; v: number }[]; at: number | null; seq: number }[] = [];
    for (const t of tables) {
      const c = computed[t.id];
      if (!c) continue;
      const name = (id: string) => t.names[id] ?? '玩家';
      for (const st of c.steps) {
        const moves = Object.entries(netOf(st.delta)).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ name: name(id), v }));
        items.push({ key: `${t.id}-${st.seq}`, no: t.order + 1, text: describe(st.event, name), moves, at: st.at, seq: st.seq });
      }
    }
    return items.sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity) || b.seq - a.seq).slice(0, 6);
  }, [tables, computed]);

  const water = Object.values(computed).reduce((a, c) => a + (c?.state.water ?? 0), 0);
  // 全場數據：幾張枱加埋
  const play = useMemo(() => tables.reduce((acc, t) => (computed[t.id] ? addPlay(acc, computed[t.id]!.stats) : acc), emptyPlay()), [tables, computed]);
  const allNames = useMemo(() => Object.assign({}, ...tables.map((t) => t.names)) as Record<string, string>, [tables]);
  const kings = useMemo(() => kingsOf(play), [play]);
  const people = new Set(tables.flatMap((t) => Object.keys(computed[t.id]?.state.settled ?? {}).length ? Object.keys(computed[t.id]!.state.settled) : t.seats)).size;

  function toggle(p: Candidate) {
    setPicked((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : list.length < 4 ? [...list, p] : list));
  }

  async function create() {
    if (picked.length !== 4 || !onAddTable) return;
    setBusy(true);
    setError('');
    try {
      await onAddTable(shuffle(picked));
      setAdding(false);
      setPicked([]);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <TopBar
        back={back}
        title={<div className="stack tight"><h1>{title}</h1><span className="muted small">{tables.length} 張枱，{people} 人</span></div>}
        right={(liveHref || rulesHref) ? <span className="row tight">
          {rulesHref && <Link to={rulesHref} className="iconbtn" ariaLabel="家規">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></svg>
          </Link>}
          {liveHref && <Link to={liveHref} className="iconbtn" ariaLabel="電視直播">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /><circle cx="7" cy="9" r="1.2" fill="currentColor" stroke="none" /></svg>
          </Link>}
        </span> : undefined}
      />

      {notice}
      {closedNote}
      {waterCtl && (
        <div className="water-toggle">
          <span className="grow">抽水<small className="muted">{waterCtl.on ? '　依家規' : '　此局不抽'}</small></span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={waterCtl.on}
            aria-label="此局抽水"
            onClick={async () => {
              if (!window.confirm(waterCtl.on ? '此局不抽水？所有枱會重新計算。' : '此局恢復抽水？所有枱會重新計算。')) return;
              try { await waterCtl.onToggle(!waterCtl.on); } catch (err) { alert(message(err)); }
            }}
          />
        </div>
      )}

      {liveHref && (
        <Link to={liveHref} className="link-card live-link">
          <span className="live-pill"><i className="live-dot" aria-hidden="true" />LIVE</span>
          <span className="grow"><b>電視直播</b><small>大字分數、全場排名、直播室、音樂；可以投去電視</small></span>
          <span className="chev" aria-hidden="true">›</span>
        </Link>
      )}
      {pullPush && (
        <div className="water-toggle">
          <span className="grow">夠拉通知<small className="muted">　有人被拉三、六…推播俾</small></span>
          <select className="inline-select" value={pullPush.value} aria-label="夠拉通知邊個" onChange={(e) => { pullPush.onChange(e.target.value as PullPush).catch((err) => alert(message(err))); }}>
            <option value="off">唔通知</option>
            <option value="table">同枱嘅人</option>
            <option value="session">成個大局</option>
            <option value="group">成個牌友圈</option>
          </select>
        </div>
      )}

      <section className="stack">
        {tables.map((t) => {
          const c = computed[t.id];
          const name = (id: string) => t.names[id] ?? '玩家';
          const last = c?.steps[c.steps.length - 1];
          const owe: Record<string, number> = {};
          for (const ch of c?.state.chains ?? []) owe[ch.pulled] = (owe[ch.pulled] ?? 0) + ch.owed;
          const seats = c?.state.seats ?? t.seats;
          return (
            <Link key={t.id} to={tableHref(t.id)} className="tcard">
              <div className="tcard-head">
                <h3>{t.name}</h3>
                <span className="muted small">{!c ? '' : c.state.ended ? '已完場' : `${c.info.roundWind}圈${WINDS[c.state.dealerTurns % 4]}位 第 ${c.info.hand} 鋪`}</span>
              </div>
              <div className="tcard-rows">
                {seats.map((id) => {
                  const settled = c?.state.settled[id] ?? 0;
                  const dealer = c && !c.state.ended && c.info.dealer === id;
                  return (
                    <div key={id} className="prow">
                      <Avatar name={name(id)} size="sm" />
                      <span className="grow prow-name">
                        <span className="prow-text">
                          {name(id)}
                          {dealer && <span className="prow-dealer">莊</span>}
                          {kings.win === id && <span className="king-tag win" title="全場食糊最多">食糊王</span>}
                          {kings.self === id && <span className="king-tag self" title="全場自摸最多">自摸王</span>}
                        </span>
                        {owe[id] ? <Chips amount={owe[id]} /> : null}
                      </span>
                      <RollingNumber value={settled} className={`num ${tone(settled)}`} />
                    </div>
                  );
                })}
              </div>
              {c && (
                <div className="facts">
                  {c.state.dealerTurns > 0 && <span className="fact"><b>{String(Math.round((c.state.dealerTurns / 4) * 100) / 100)}</b> 圈</span>}
                  <span className="fact"><b>{c.stats.hands}</b> 鋪</span>
                  {paceOf(c.stats.roundMs) && <span className="fact">速度 <b>{paceOf(c.stats.roundMs)}</b></span>}
                  {quickTags(c).map((q, i) => <span key={q + i} className="fact qk">{q}</span>)}
                  {c.stats.biggest && <span className="fact">最大 <b>{c.stats.biggest.fan}</b> 番（{name(c.stats.biggest.player)}）</span>}
                  {c.stats.selfDraws > 0 && <span className="fact">自摸 <b>{c.stats.selfDraws}</b></span>}
                  <span className="fact">水 <b>{c.state.water}</b></span>
                  {c.state.chains.map((ch) => (
                    <span key={ch.puller + ch.pulled} className="fact la">{name(ch.puller)} 拉 {name(ch.pulled)} {ch.count}</span>
                  ))}
                </div>
              )}
              <div className="latest" key={last?.seq ?? 0}>
                {last ? <><span className={`grow${last.at && now - last.at < 60000 ? ' flashrow' : ''}`}>{describe(last.event, name)}</span><span className="when">{ago(last.at, now)}</span></> : <span className="muted">未開始</span>}
              </div>
            </Link>
          );
        })}
        {onAddTable && <button type="button" className="btn plain" onClick={() => { setAdding(true); setPicked([]); setError(''); }}>加一張枱</button>}
        {rg && !draw && openTables.length >= 1 && (rg.canForce || seatedMe) && <button type="button" className="btn plain" onClick={() => { setError(''); setDrawSetup(true); }}>{openTables.length} 張枱一齊執位</button>}
        {rg && draw && (
          <button type="button" className={`link-card draw-live${myTurn ? ' my-turn' : ''}`} onClick={() => setBoardOpen(true)}>
            <span className="draw-live-dot" aria-hidden="true" />
            <span className="grow"><b>{myTurn ? '到你揀位！' : '一齊執位進行中'}</b><small>{draw.status === 'propose' ? '等每張枱同意' : draw.status === 'picking' ? `揀緊牌：${Object.keys(draw.picks).length}/${draw.tiles.length}` : '揀晒，等確認'}</small></span>
            <span className="chev" aria-hidden="true">›</span>
          </button>
        )}
      </section>

      {ranking.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2>全場排名</h2>
            <span className="muted small">抽水 {water}</span>
          </div>
          <div className="list">
            {ranking.map((r, i) => (
              <div key={r.id} className="listrow">
                <span className="num rank">{i + 1}</span>
                <Avatar name={r.name} size="sm" />
                <span className="grow rank-who"><span className="ellipsis">{r.name}{kings.win === r.id && <span className="king-tag win">食糊王</span>}{kings.self === r.id && <span className="king-tag self">自摸王</span>}</span><small className="muted">{r.table}</small></span>
                <Sparkline values={r.spark} />
                <RollingNumber value={r.net} className={`num ${tone(r.net)} big-num`} />
              </div>
            ))}
          </div>
        </section>
      )}

      {play.hands > 0 && (
        <section className="stack">
          <h2 className="section-head">全場數據</h2>
          <PlayTable play={play} ids={ranking.map((r) => r.id)} name={(id) => allNames[id] ?? '玩家'} me={me} />
          <Awards play={play} name={(id) => allNames[id] ?? '玩家'} />
        </section>
      )}


      {feed.length > 0 && (
        <section className="stack">
          <h2>最新</h2>
          <ul className="feed list">
            {feed.map((f) => (
              <li key={f.key}>
                <span className="feed-no" aria-label={`第 ${f.no} 枱`}>{f.no}</span>
                <span className="feed-body">
                  <span className="feed-text">{f.text}</span>
                  {f.moves.length > 0 && (
                    <span className="feed-moves">
                      {f.moves.map((m) => <span key={m.name} className={tone(m.v)}>{m.name} <b className="num">{fmt(m.v)}</b></span>)}
                    </span>
                  )}
                </span>
                <span className="feed-when">{ago(f.at, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {onDeleteSession && (
        <section className="danger-zone">
          <h3>危險操作</h3>
          <button type="button" className="btn danger" onClick={() => setDelSession(true)}>刪除此大局</button>
        </section>
      )}
      {delSession && onDeleteSession && (
        <ConfirmDelete title="刪除大局" detail={`會永久刪除「${title}」所有枱、紀錄、開支同 Group，無法復原。`} word={title} onConfirm={onDeleteSession} onClose={() => setDelSession(false)} />
      )}

      {invite && (
        <section className="panel">
          <h3>邀請加入</h3>
          <Hint>對方登入後會自動加入牌友圈並來到這個大局，之後可換入枱或另開一枱。</Hint>
          <CopyLink url={invite} />
        </section>
      )}

      {rg && drawSetup && (
        <DrawSetup tables={drawTables} candidates={rg.candidates} ranking={ranking.map((r) => r.id)} me={me ?? ''} canForce={rg.canForce} onStart={rg.onStart} onClose={() => setDrawSetup(false)} />
      )}
      {rg && draw && boardOpen && (
        <DrawBoard draw={draw} me={me ?? ''} tables={drawTables} canForce={rg.canForce} onApprove={rg.onApprove} onPick={rg.onPick} onAuto={rg.onAuto} onCancel={rg.onCancel} onApply={rg.onApply} onClose={() => setBoardOpen(false)} />
      )}

      {adding && onAddTable && (
        <Sheet onClose={() => setAdding(false)} label="加一張枱">
          <h2>加一張枱</h2>
          <Hint>選 4 人即可開枱，座位隨機分配。</Hint>
          <div className="choices">
            {candidates.map((p) => (
              <button key={p.id} type="button" className="choice" aria-pressed={picked.some((x) => x.id === p.id)} onClick={() => toggle(p)}>
                <span className="ellipsis">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field grow">
              <span>加訪客（無帳戶）</span>
              <input id="add-guest" value={guest} onChange={(e) => setGuest(clampName(e.target.value))} placeholder="訪客名" />
            </label>
            <button
              type="button"
              className="btn plain"
              disabled={!guest.trim() || picked.length >= 4}
              onClick={() => { toggle({ id: `guest-${Math.random().toString(36).slice(2, 10)}`, name: guest.trim() }); setGuest(''); }}
            >
              加
            </button>
          </div>
          <div className="choices">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="choice static">
                <small>第 {i + 1} 位</small>
                <span className="ellipsis">{picked[i]?.name ?? '—'}</span>
              </div>
            ))}
          </div>
          <button type="button" className="btn big" disabled={busy || picked.length !== 4} onClick={create}>
            {picked.length === 4 ? '開枱' : `尚欠 ${4 - picked.length} 人`}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </Sheet>
      )}
    </main>
  );
}

export { WINDS };
