// 大局總覽：每張枱最新一鋪、統計、全場排名、最新動態、加枱
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { TableDoc } from '../lib/data.ts';
import { Link } from '../lib/router.tsx';
import type { Computed } from '../lib/score.ts';
import { ago, describe, netOf, trendOf } from '../lib/score.ts';
import { Sparkline } from './Charts.tsx';
import { Avatar, Chips, CopyLink, Hint, RollingNumber, fmt, Sheet, TopBar, message, tone, useNow } from '../ui.tsx';
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
  notice?: ReactNode;
  candidates?: Candidate[];
  onAddTable?: (seats: Candidate[]) => Promise<void>;
}

export default function SessionScreen({ title, back, tables, computed, tableHref, invite, rulesHref, notice, candidates = [], onAddTable }: SessionScreenProps) {
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [guest, setGuest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ranking = useMemo(() => {
    const rows: { id: string; name: string; table: string; net: number; spark: number[] }[] = [];
    for (const t of tables) {
      const c = computed[t.id];
      if (!c) continue;
      const ids = Object.keys(c.state.settled);
      const trend = trendOf(c, ids);
      for (const id of ids) {
        rows.push({ id, name: t.names[id] ?? '玩家', table: t.name, net: (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0), spark: trend[id] });
      }
    }
    return rows.sort((a, b) => b.net - a.net);
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
  const people = tables.reduce((a, t) => a + (computed[t.id]?.state.seats.length ?? t.seats.length), 0);

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
        right={rulesHref ? <Link to={rulesHref} className="iconbtn" ariaLabel="家規">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M6 4h12v16H6z" /><path d="M9 9h6M9 13h6M9 17h3" /></svg>
        </Link> : undefined}
      />

      {notice}

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
                <span className="muted small">{!c ? '' : c.state.ended ? '已完場' : `${c.info.roundWind}圈 第 ${c.info.hand} 鋪`}</span>
              </div>
              <div className="tcard-rows">
                {seats.map((id) => {
                  const settled = c?.state.settled[id] ?? 0;
                  const dealer = c && !c.state.ended && c.info.dealer === id;
                  return (
                    <div key={id} className="prow">
                      <Avatar name={name(id)} size="sm" />
                      <span className="ellipsis grow">{name(id)}{dealer ? '（莊）' : ''}</span>
                      {owe[id] ? <Chips amount={owe[id]} /> : null}
                      <RollingNumber value={settled} className={`num ${tone(settled)}`} />
                    </div>
                  );
                })}
              </div>
              {c && (
                <div className="facts">
                  <span className="fact"><b>{c.stats.hands}</b> 鋪</span>
                  {c.stats.biggest && <span className="fact">最大 <b>{c.stats.biggest.fan}</b> 番（{name(c.stats.biggest.player)}）</span>}
                  {c.stats.selfDraws > 0 && <span className="fact">自摸 <b>{c.stats.selfDraws}</b></span>}
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
      </section>

      {ranking.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2>全場排名</h2>
            <span className="muted small">連枱面，抽水 {water}</span>
          </div>
          <div className="list">
            {ranking.map((r, i) => (
              <div key={r.id + r.table} className="listrow">
                <span className="num rank">{i + 1}</span>
                <Avatar name={r.name} size="sm" />
                <span className="grow rank-who"><span className="ellipsis">{r.name}</span><small className="muted">{r.table}</small></span>
                <Sparkline values={r.spark} />
                <RollingNumber value={r.net} className={`num ${tone(r.net)} big-num`} />
              </div>
            ))}
          </div>
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

      {invite && (
        <section className="panel">
          <h3>邀請加入</h3>
          <Hint>對方登入後會自動加入牌友圈並來到這個大局，之後可換入枱或另開一枱。</Hint>
          <CopyLink url={invite} />
        </section>
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
              <input id="add-guest" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="訪客名" maxLength={20} />
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
