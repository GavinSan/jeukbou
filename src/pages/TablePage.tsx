import { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { applyEvent } from '../engine/table.ts';
import type { Line, TableEvent } from '../engine/table.ts';
import { ConflictError, appendEvent } from '../lib/data.ts';
import { useEvents, useGroup, useTable } from '../lib/live.ts';
import { computeTable, describe, rulesOf } from '../lib/score.ts';
import { Avatar, Chips, Loading, TopBar, fmt, message, tone } from '../ui.tsx';

const TYPES = ['食出', '自摸', '雙響', '三響', '詐糊', '特別事項', '流局', '完場'] as const;
type EntryType = (typeof TYPES)[number];
const WIN_TYPES: EntryType[] = ['食出', '自摸', '雙響', '三響'];

const SPECIALS = [
  { k: '暗槓', v: 5, dir: 'collect' as const },
  { k: '一台花', v: 5, dir: 'collect' as const },
  { k: '一台草', v: 2, dir: 'collect' as const },
  { k: '圍骰', v: 5, dir: 'collect' as const },
  { k: '骰開一二三', v: 5, dir: 'pay' as const },
  { k: '叫碰唔碰', v: 5, dir: 'pay' as const },
  { k: '被追（番子）', v: 5, dir: 'pay' as const },
  { k: '被追（其他）', v: 10, dir: 'pay' as const },
];

const KIND: Record<Line['kind'], string> = { pending: '擺低', settle: '找數', instant: '即時', water: '抽水' };
// 枱面位置：自己（東）喺下面，逆時針南西北
const POS = ['seat-s', 'seat-e', 'seat-n', 'seat-w'];

const maxWinners = (t: EntryType) => (t === '雙響' ? 2 : t === '三響' ? 3 : 1);

export default function TablePage({ user, groupId, sessionId, tableId }: { user: User; groupId: string; sessionId: string; tableId: string }) {
  const group = useGroup(groupId);
  const table = useTable(groupId, sessionId, tableId);
  const events = useEvents(groupId, sessionId, tableId);
  const rules = useMemo(() => rulesOf(group.data), [group.data]);
  const computed = useMemo(() => (table.data ? computeTable(table.data, events.data, rules) : null), [table.data, events.data, rules]);

  const [type, setType] = useState<EntryType>('食出');
  const [winners, setWinners] = useState<string[]>([]);
  const [loser, setLoser] = useState<string>('');
  const [fans, setFans] = useState<Record<string, string>>({});
  const [who, setWho] = useState('');
  const [special, setSpecial] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (table.error || group.error) return <main className="page"><TopBar back={`/g/${groupId}/s/${sessionId}`} /><p className="error">{table.error ?? group.error}</p></main>;
  if (!table.data || !computed) return <main className="page"><TopBar back={`/g/${groupId}/s/${sessionId}`} /><Loading /></main>;

  const t = table.data;
  const c = computed;
  const seats = t.seats;
  const name = (id: string) => t.names[id] ?? '玩家';
  const ended = c.state.ended;
  const lastStep = c.steps[c.steps.length - 1];
  const every = rules.la.settleEvery;
  const settleable = rules.la.enabled && every > 0 ? c.state.chains.filter((ch) => ch.count % every === 0) : [];

  const owe: Record<string, number> = {};
  const collect: Record<string, number> = {};
  for (const ch of c.state.chains) {
    owe[ch.pulled] = (owe[ch.pulled] ?? 0) + ch.owed;
    collect[ch.puller] = (collect[ch.puller] ?? 0) + ch.owed;
  }

  function pickType(next: EntryType) {
    setType(next);
    setError('');
    setConfirmEnd(false);
    const max = maxWinners(next);
    const w = winners.slice(0, max);
    setWinners(w);
    if (next === '三響' && w.length === 3) setLoser(seats.find((s) => !w.includes(s)) ?? '');
  }

  function toggleWinner(id: string) {
    const max = maxWinners(type);
    let w: string[];
    if (max === 1) w = [id];
    else if (winners.includes(id)) w = winners.filter((x) => x !== id);
    else { w = [...winners, id]; if (w.length > max) w = w.slice(w.length - max); }
    setWinners(w);
    if (w.includes(loser)) setLoser('');
    if (type === '三響' && w.length === 3) setLoser(seats.find((s) => !w.includes(s)) ?? '');
  }

  function fanOf(id: string): number {
    const n = Number(fans[id] ?? '');
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : NaN;
  }

  function stepFan(id: string, d: number) {
    const cur = Number.isFinite(fanOf(id)) ? fanOf(id) : 0;
    setFans((f) => ({ ...f, [id]: String(Math.max(0, cur + d)) }));
  }

  function build(): TableEvent {
    if (WIN_TYPES.includes(type)) {
      const max = maxWinners(type);
      if (winners.length !== max) throw new Error(max === 1 ? '揀邊個食糊' : `要揀 ${max} 個食糊`);
      const l = type === '自摸' ? null : loser;
      if (type !== '自摸' && !l) throw new Error('揀邊個出銃');
      for (const w of winners) if (!Number.isFinite(fanOf(w))) throw new Error(`入 ${name(w)} 嘅番數`);
      return { type: 'win', winners: winners.map((w) => ({ player: w, fan: fanOf(w) })), loser: l };
    }
    if (type === '詐糊') {
      if (!who) throw new Error('揀邊個詐糊');
      return { type: 'falseWin', player: who };
    }
    if (type === '特別事項') {
      if (!who) throw new Error('揀邊個');
      const s = SPECIALS[special];
      return { type: 'special', player: who, label: s.k, amount: s.v, direction: s.dir };
    }
    if (type === '流局') return { type: 'draw' };
    return { type: 'end' };
  }

  async function push(event: TableEvent | { type: 'undo'; target: number }, done: string) {
    setError('');
    setBusy(true);
    try {
      if (event.type !== 'undo') applyEvent(c.state, event, rules);
      await appendEvent(groupId, sessionId, tableId, events.data.length + 1, user.uid, event);
      setFlash(done);
      setTimeout(() => setFlash(''), 2500);
      setWinners([]);
      setLoser('');
      setFans({});
      setWho('');
      setConfirmEnd(false);
    } catch (err) {
      setError(err instanceof ConflictError ? err.message : message(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (type === '完場' && !confirmEnd) { setConfirmEnd(true); return; }
    try {
      const ev = build();
      await push(ev, '已入數');
    } catch (err) {
      setError(message(err));
    }
  }

  const isWin = WIN_TYPES.includes(type);
  const needsLoser = type === '食出' || type === '雙響';

  return (
    <main className="page">
      <TopBar
        back={`/g/${groupId}/s/${sessionId}`}
        title={<span className="stack tight center-text"><strong>{t.name}</strong><span className="muted small">{ended ? '已完場' : `${c.info.roundWind}圈 · 第 ${c.info.hand} 鋪`}</span></span>}
      />

      <section className="board card" aria-label="枱面">
        {seats.map((id, i) => {
          const settled = c.state.settled[id] ?? 0;
          const isDealer = c.info.dealer === id && !ended;
          return (
            <div key={id} className={`seat ${POS[i]}${owe[id] ? ' owes' : ''}`}>
              <div className="seat-name">
                <Avatar name={name(id)} size="sm" />
                <span className="ellipsis grow">{name(id)}</span>
                {isDealer && <span className="badge">莊{c.state.streak ? ` 連${c.state.streak}` : ''}</span>}
              </div>
              <div className={`seat-score num ${tone(settled)}`}>{fmt(settled)}</div>
              <div className="seat-pend">
                {owe[id] ? <><Chips amount={owe[id]} /><span className="num neg">{owe[id]}</span></> : null}
                {collect[id] ? <span className="num pos">+{collect[id]}</span> : null}
              </div>
            </div>
          );
        })}
        <div className="board-center">
          <strong className="wind">{ended ? '完場' : `${c.info.roundWind}圈`}</strong>
          {!ended && rules.dealer.enabled && <span className="small">莊番 {c.info.dealerFan}</span>}
          <span className="small muted">水 <span className="num">{c.state.water}</span></span>
        </div>
      </section>

      {settleable.length > 0 && !ended && (
        <section className="stack">
          {settleable.map((ch) => (
            <div key={ch.puller + ch.pulled} className="prompt">
              <span>第 {ch.count} 拉：{name(ch.pulled)} 可以揀找數（唔找就等第 {ch.count + every} 拉）</span>
              <button type="button" className="btn owe" disabled={busy} onClick={() => push({ type: 'settle', puller: ch.puller, pulled: ch.pulled }, '已找數')}>
                找數 {ch.owed}
              </button>
            </div>
          ))}
        </section>
      )}

      {!ended && (
        <section className="card stack">
          <div className="pills" role="group" aria-label="結果">
            {TYPES.map((k) => (
              <button key={k} type="button" className="pill" aria-pressed={type === k} onClick={() => pickType(k)}>{k}</button>
            ))}
          </div>

          {isWin && (
            <div className="field">
              <span className="label">邊個食糊{maxWinners(type) > 1 ? `（揀 ${maxWinners(type)} 個）` : ''}</span>
              <div className="pick-grid">
                {seats.map((id) => (
                  <button key={id} type="button" className="pick" aria-pressed={winners.includes(id)} onClick={() => toggleWinner(id)}>
                    <Avatar name={name(id)} size="sm" /><span className="ellipsis">{name(id)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsLoser && (
            <div className="field">
              <span className="label">邊個出銃</span>
              <div className="pick-grid">
                {seats.map((id) => (
                  <button key={id} type="button" className="pick lose" aria-pressed={loser === id} disabled={winners.includes(id)} onClick={() => setLoser(id)}>
                    <Avatar name={name(id)} size="sm" /><span className="ellipsis">{name(id)}</span>
                    {c.state.chains.some((ch) => ch.pulled === id && winners.includes(ch.puller)) && <span className="tiny neg">被拉</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {type === '三響' && loser && <p className="small">出銃：<strong>{name(loser)}</strong>（自動揀）</p>}

          {isWin && winners.length > 0 && (
            <div className="field">
              <span className="label">牌型番（底 {rules.base}、莊、雙響會自動加）</span>
              {winners.map((w) => (
                <div key={w} className="fan-row">
                  <span className="ellipsis fan-name">{name(w)}</span>
                  <button type="button" className="round" aria-label={`${name(w)} 減一番`} onClick={() => stepFan(w, -1)}>−</button>
                  <input
                    id={`fan-${w}`}
                    className="fan-input num"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={fans[w] ?? ''}
                    placeholder="0"
                    onChange={(e) => setFans((f) => ({ ...f, [w]: e.target.value }))}
                    aria-label={`${name(w)} 番數`}
                  />
                  <button type="button" className="round" aria-label={`${name(w)} 加一番`} onClick={() => stepFan(w, 1)}>+</button>
                  <span className="muted">番</span>
                </div>
              ))}
            </div>
          )}

          {type === '特別事項' && (
            <label className="field">
              <span className="label">邊樣嘢（即時找，唔影響拉）</span>
              <select id="special" value={special} onChange={(e) => setSpecial(Number(e.target.value))}>
                {SPECIALS.map((s, i) => <option key={s.k} value={i}>{s.k} · {s.dir === 'collect' ? '收' : '俾'}每家 {s.v}</option>)}
              </select>
            </label>
          )}

          {(type === '詐糊' || type === '特別事項') && (
            <div className="field">
              <span className="label">邊個</span>
              <div className="pick-grid">
                {seats.map((id) => (
                  <button key={id} type="button" className="pick" aria-pressed={who === id} onClick={() => setWho(id)}>
                    <Avatar name={name(id)} size="sm" /><span className="ellipsis">{name(id)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === '流局' && <p className="muted small">冇人輸贏，拉住嘅數留低。</p>}
          {type === '完場' && <p className="muted small">所有拉住嘅數會即刻找晒，之後呢張枱唔可以再入數。</p>}

          <button type="button" className={`btn big${type === '完場' ? ' owe' : ''}`} disabled={busy} onClick={submit}>
            {type === '完場' ? (confirmEnd ? '確定完場' : '完場') : '入數'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
          {flash && <p className="ok" role="status">{flash}</p>}
        </section>
      )}

      {lastStep && (
        <section className="card stack">
          <div className="between">
            <h2>最新一鋪</h2>
            <span className="muted small">{describe(lastStep.event, name)}</span>
          </div>
          <Lines lines={lastStep.result.lines} name={name} />
        </section>
      )}

      <section className="stack">
        <div className="between">
          <h2 className="section-title">紀錄</h2>
          <span className="muted small">{c.steps.length} 項</span>
        </div>
        {c.skipped.length > 0 && (
          <p className="warn">{c.skipped.map((s) => `第 ${s.seq} 項計唔到：${s.message}`).join('；')}</p>
        )}
        <div className="card list">
          {c.steps.length === 0 && <p className="muted pad">未有紀錄</p>}
          {[...c.steps].reverse().map((st, i) => (
            <details key={st.seq} className="history">
              <summary>
                <span className="num muted rank">{c.steps.length - i}</span>
                <span className="grow">{describe(st.event, name)}</span>
                {i === 0 && (
                  <button
                    type="button"
                    className="link small"
                    disabled={busy}
                    onClick={(e) => { e.preventDefault(); push({ type: 'undo', target: st.seq }, '已撤回'); }}
                  >
                    撤回
                  </button>
                )}
              </summary>
              <Lines lines={st.result.lines} name={name} />
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

function Lines({ lines, name }: { lines: Line[]; name: (id: string) => string }) {
  if (!lines.length) return <p className="muted small">冇數要計</p>;
  return (
    <ul className="lines">
      {lines.map((l, i) => (
        <li key={i} className="line">
          <span className={`kind k-${l.kind}`}>{KIND[l.kind]}</span>
          <span className="grow">
            {name(l.from)} → {l.to === null ? '水' : name(l.to)} <span className="muted small">{l.note}</span>
          </span>
          <span className="num">{Math.round(l.amount * 100) / 100}</span>
        </li>
      ))}
    </ul>
  );
}
