// 一張枱：綠絨布枱面 + 撳人入數。資料由外面傳入，所以示範模式都用到。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { applyEvent, replay, seatWind } from '../engine/table.ts';
import type { Line, TableEvent } from '../engine/table.ts';
import type { Rules } from '../engine/rules.ts';
import type { SwapRequest, TableDoc, LogEvent } from '../lib/data.ts';
import type { Computed } from '../lib/score.ts';
import { ago, describe, netOf } from '../lib/score.ts';
import { setSoundOn, sfx, soundOn, unlock } from '../lib/sound.ts';
import { Link } from '../lib/router.tsx';
import { Chips, RollingNumber, Sheet, TopBar, fmt, message, useNow } from '../ui.tsx';
import FanWheel from './FanWheel.tsx';
import DiceRoll, { Die } from './Dice.tsx';
import SeatDraw from './SeatDraw.tsx';
import { CHASE_MAX_REPEAT, SPECIAL_ITEMS, SpecialArt, SpecialBurst, artOf, chaseAmount, suggestRepeat } from './Specials.tsx';
import type { Art } from './Specials.tsx';

const SPOTS = ['s-bottom', 's-right', 's-top', 's-left'];
const QUICK_FANS = [5, 8, 10, 13, 15, 20, 25, 30, 40, 50];
const KIND: Record<Line['kind'], string> = { pending: '擺低', settle: '找數', instant: '即時', water: '抽水' };

interface Entry {
  winners: string[];
  /** undefined = 未揀；null = 自摸 */
  loser: string | null | undefined;
  fans: Record<string, number>;
  step: 'who' | 'fan';
  current: string;
}

type More = null | 'menu' | 'falseWin' | 'special' | 'draw' | 'end' | 'swap' | 'reseat';

export interface Candidate {
  id: string;
  name: string;
}

export interface TableScreenProps {
  table: TableDoc;
  computed: Computed;
  rules: Rules;
  me: string | null;
  back: string;
  subtitle?: string;
  rulesHref?: string;
  /** 可以換入嚟嘅人（未坐低嘅成員） */
  candidates?: Candidate[];
  pendingSwaps?: SwapRequest[];
  /** 頂部額外提示（例如有人請你入枱） */
  notice?: ReactNode;
  onPush: (event: LogEvent) => Promise<void>;
  onSwap?: (out: string, incoming: Candidate, guest: boolean) => Promise<'done' | 'requested'>;
  onCancelSwap?: (id: string) => Promise<void>;
  onReseat?: (seats: string[]) => Promise<void>;
  onDice?: () => Promise<void>;
}

const totalOf = (c: Computed, id: string) => (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0);

export default function TableScreen(props: TableScreenProps) {
  const { table, computed: c, rules, me, back, subtitle, rulesHref, candidates = [], pendingSwaps = [], notice, onPush } = props;
  const now = useNow();
  const name = useCallback((id: string) => table.names[id] ?? '玩家', [table.names]);
  const seats = c.state.seats;
  const ended = c.state.ended;

  // 自己坐喺下面
  const rotate = me && seats.includes(me) ? seats.indexOf(me) : 0;
  const spotOf = (i: number) => SPOTS[(i - rotate + 4) % 4];

  const [entry, setEntry] = useState<Entry | null>(null);
  const [more, setMore] = useState<More>(null);
  const [who, setWho] = useState('');
  const [spArt, setSpArt] = useState<Art | ''>('');
  const [spPlay, setSpPlay] = useState(0);
  const [chaseKind, setChaseKind] = useState<'fan' | 'other'>('fan');
  const [repeat, setRepeat] = useState(0);
  const [instant, setInstant] = useState(false);
  const [burst, setBurst] = useState<{ art: Art; text?: string; key: number } | null>(null);
  const [swapOut, setSwapOut] = useState('');
  const [swapIn, setSwapIn] = useState('');
  const [guestName, setGuestName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [dealing, setDealing] = useState(true);
  const [sound, setSound] = useState(soundOn);
  const [fx, setFx] = useState<{ up: string[]; down: string[]; delta: Record<string, number>; hp: boolean; key: number }>({ up: [], down: [], delta: {}, hp: false, key: 0 });
  const [diceShown, setDiceShown] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ seq: number; event: TableEvent; current: string } | null>(null);

  useEffect(() => { const t = setTimeout(() => setDealing(false), 900); return () => clearTimeout(t); }, []);

  // 任何人嘅數有變（包括其他手機入嘅）就郁：升嘅推牌，跌嘅震
  const snapshot = seats.map((id) => `${id}:${totalOf(c, id)}:${c.state.settled[id] ?? 0}`).join('|') + `#${c.steps.length}`;
  const prev = useRef<{ snap: string; settled: Record<string, number>; total: Record<string, number> } | null>(null);
  useEffect(() => {
    const settledNow: Record<string, number> = {};
    const totalNow: Record<string, number> = {};
    for (const id of seats) { settledNow[id] = c.state.settled[id] ?? 0; totalNow[id] = totalOf(c, id); }
    const before = prev.current;
    prev.current = { snap: snapshot, settled: settledNow, total: totalNow };
    if (!before || before.snap === snapshot) return;
    const up: string[] = [];
    const down: string[] = [];
    const delta: Record<string, number> = {};
    for (const id of seats) {
      if (before.settled[id] === undefined) continue;
      // 大數字（實數）有變就用佢；冇就睇擺低咗幾多
      const d = settledNow[id] - before.settled[id] || totalNow[id] - before.total[id];
      if (d > 0) up.push(id);
      else if (d < 0) down.push(id);
      if (d) delta[id] = d;
    }
    if (!up.length && !down.length) return;
    const lastStep = c.steps[c.steps.length - 1];
    const last = lastStep?.event;
    const hp = !!lastStep && last?.type !== 'win' && lastStep.result.lines.some((l) => l.kind === 'settle');
    setFx((f) => ({ up, down, delta, hp, key: f.key + 1 }));
    const art = last ? artOf(last) : null;
    if (art && last?.type === 'special') {
      const rep = last.meta?.repeat ?? 0;
      setBurst((b) => ({ art, text: art === 'chase' ? (rep > 0 ? `追 ×${rep + 1}` : '追') : undefined, key: (b?.key ?? 0) + 1 }));
    }
    if (last?.type === 'win') sfx.win();
    else if (hp) sfx.settle();
    else if (last?.type === 'special' || last?.type === 'falseWin' || last?.type === 'end') sfx.chips();
    else sfx.tap();
    const t = setTimeout(() => setFx((f) => ({ ...f, up: [], down: [], delta: {} })), hp ? 1300 : 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // 擲骰：全枱同步，啱啱擲（20 秒內）先播
  // 角落嗰三粒要等動畫播完先換，唔好劇透
  const dice = table.dice;
  const fresh = (d: typeof dice) => !!d && Date.now() - d.at <= 20000;
  const [corner, setCorner] = useState(() => (fresh(dice) ? null : dice ?? null));
  useEffect(() => {
    if (!dice) return;
    if (!fresh(dice)) { setCorner(dice); return; }
    setDiceShown(dice.n);
    sfx.dice();
  }, [dice?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const revealDice = () => { if (dice) setCorner(dice); };

  const owe: Record<string, number> = {};
  const collect: Record<string, number> = {};
  for (const ch of c.state.chains) {
    owe[ch.pulled] = (owe[ch.pulled] ?? 0) + ch.owed;
    collect[ch.puller] = (collect[ch.puller] ?? 0) + ch.owed;
  }

  const every = rules.la.settleEvery;
  const settleable = rules.la.enabled && every > 0 && !ended
    ? c.state.chains.filter((ch) => ch.count % every === 0 && !dismissed.includes(`${ch.puller}>${ch.pulled}#${ch.count}`))
    : [];

  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast(''), 2200);
  }

  async function run(task: () => Promise<unknown>, done: string) {
    unlock();
    setError('');
    setBusy(true);
    try {
      await task();
      setEntry(null);
      setMore(null);
      setEditing(null);
      setWho('');
      if (done) flash(done);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const push = (event: LogEvent, done: string) =>
    run(async () => {
      if (event.type !== 'undo' && event.type !== 'edit') applyEvent(c.state, event, rules);
      await onPush(event);
    }, done);

  // ---------- 食糊 ----------
  function startWin(id: string) {
    unlock();
    if (ended) return;
    setError('');
    sfx.tap();
    setEntry({ winners: [id], loser: undefined, fans: {}, step: 'who', current: id });
  }

  const draft: TableEvent | null = useMemo(() => {
    if (!entry || entry.loser === undefined) return null;
    return { type: 'win', winners: entry.winners.map((w) => ({ player: w, fan: entry.fans[w] ?? 0 })), loser: entry.loser };
  }, [entry]);

  const preview = useMemo((): { lines: Line[]; error: string } => {
    if (!draft) return { lines: [], error: '' };
    try {
      return { lines: applyEvent(c.state, draft, rules).lines, error: '' };
    } catch (err) {
      return { lines: [], error: message(err) };
    }
  }, [draft, c.state, rules]);

  function setFan(id: string, v: number) {
    setEntry((e) => (e ? { ...e, fans: { ...e.fans, [id]: Math.max(0, Math.min(500, Math.round(v))) } } : e));
  }

  const lastStep = c.steps[c.steps.length - 1];
  const log = [...c.steps].reverse().slice(0, showAll ? undefined : 5);
  // 紀錄表嘅欄：開枱嗰四個，之後換入嚟嘅排後面
  const cols = useMemo(() => {
    const out = [...table.seats];
    for (const st of c.steps) for (const id of st.result.state.seats) if (!out.includes(id)) out.push(id);
    return out;
  }, [table.seats, c.steps]);
  const sum = (lines: Line[]) => lines.filter((l) => l.kind !== 'water').reduce((a, l) => a + l.amount, 0);
  const free = candidates.filter((p) => !seats.includes(p.id));
  const myPending = pendingSwaps.filter((r) => r.status === 'pending' && r.tableId === table.id);

  // 改數預覽：用新內容由頭計一次，睇邊個嘅數有變
  const editPreview = useMemo((): { rows: { id: string; before: number; after: number }[]; error: string; changed: boolean } => {
    if (!editing) return { rows: [], error: '', changed: false };
    const original = c.steps.find((x) => x.seq === editing.seq)?.event;
    const changed = JSON.stringify(original) !== JSON.stringify(editing.event);
    try {
      const after = replay(table.seats, c.steps.map((x) => (x.seq === editing.seq ? editing.event : x.event)), rules).state;
      const afterPending: Record<string, number> = {};
      for (const ch of after.chains) {
        afterPending[ch.puller] = (afterPending[ch.puller] ?? 0) + ch.owed;
        afterPending[ch.pulled] = (afterPending[ch.pulled] ?? 0) - ch.owed;
      }
      const rows = Object.keys(after.settled)
        .map((id) => ({ id, before: totalOf(c, id), after: (after.settled[id] ?? 0) + (afterPending[id] ?? 0) }))
        .filter((r) => r.before !== r.after);
      return { rows, error: '', changed };
    } catch (err) {
      return { rows: [], error: message(err), changed };
    }
  }, [editing, c, rules, table.seats]);

  const deletePreview = useMemo((): string => {
    if (!editing) return '';
    try {
      replay(table.seats, c.steps.filter((x) => x.seq !== editing.seq).map((x) => x.event), rules);
      return '';
    } catch (err) {
      return `刪除唔到：${message(err)}`;
    }
  }, [editing, c, rules, table.seats]);

  function openSpecial() {
    unlock();
    setError('');
    setSpArt('');
    setWho('');
    setRepeat(0);
    setInstant(false);
    setMore('special');
  }

  const menuButton = (
    <button type="button" className="iconbtn" aria-label="其他：換人、擲骰、掉位、詐糊、聲效" onClick={() => { unlock(); setError(''); setMore('menu'); }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>
    </button>
  );

  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>{table.name}</h1>{subtitle && <span className="muted small">{subtitle}</span>}</div>} right={menuButton} />

      {notice}

      {myPending.map((r) => (
        <div key={r.id} className="banner calm">
          <span className="grow">等緊 {r.inName} 接受，換 {name(r.out)}</span>
          {props.onCancelSwap && <button type="button" className="textbtn" onClick={() => run(() => props.onCancelSwap!(r.id), '已取消')}>取消</button>}
        </div>
      ))}

      {settleable.map((ch) => (
        <div key={ch.puller + ch.pulled} className="banner">
          <span className="grow">第 {ch.count} 拉，{name(ch.pulled)} 欠 {name(ch.puller)} <b className="num">{ch.owed}</b>。{name(ch.pulled)} 揀找唔找。</span>
          <button type="button" className="btn danger" disabled={busy} onClick={() => push({ type: 'settle', puller: ch.puller, pulled: ch.pulled }, '已找數')}>找數</button>
          <button type="button" className="textbtn loss" onClick={() => setDismissed((d) => [...d, `${ch.puller}>${ch.pulled}#${ch.count}`])}>唔找</button>
        </div>
      ))}

      <section className={`felt${dealing ? ' deal' : ''}`} aria-label="枱面">
        {seats.map((id, i) => {
          const settled = c.state.settled[id] ?? 0;
          const isDealer = c.info.dealer === id && !ended;
          const up = fx.up.includes(id);
          const down = fx.down.includes(id);
          const cls = ['tile', spotOf(i), up ? 'won' : '', down ? 'hit' : '', down && fx.hp ? 'hp' : ''].filter(Boolean).join(' ');
          return (
            <button key={id} type="button" className={cls} onClick={() => startWin(id)} disabled={ended} aria-label={`${name(id)}，${settled} 番，撳嚟入佢食糊`}>
              <span className="t-name"><span className="ellipsis">{name(id)}</span>{isDealer && <span className="dealer-mark">莊{c.state.streak ? c.state.streak : ''}</span>}</span>
              <RollingNumber value={settled} className={`t-score t-${tone2(settled)}`} />
              <span className="t-foot">
                {owe[id] ? <><Chips key={`c${owe[id]}`} amount={owe[id]} pop={down} /><RollingNumber value={-owe[id]} className="t-loss" /></> : null}
                {collect[id] ? <RollingNumber value={collect[id]} className="t-gain" /> : null}
                <span className="t-wind">{seatWind(c.state, id)}</span>
              </span>
              {fx.delta[id] ? <span className={`float ${fx.delta[id] > 0 ? 'gain' : 'loss'}${fx.hp ? ' hp' : ''}`} key={`f${fx.key}`}>{fmt(fx.delta[id])}</span> : null}
            </button>
          );
        })}
        {burst && <SpecialBurst key={burst.key} art={burst.art} text={burst.text} />}
        <button
          type="button"
          className="felt-dice"
          disabled={!props.onDice || ended || busy}
          onClick={() => props.onDice && run(() => props.onDice!(), '')}
          aria-label={corner ? `今場骰：${corner.values.join('、')}，撳嚟再擲` : '今場未擲骰，撳嚟擲'}
        >
          {(corner?.values ?? idleDice(table.id)).map((v, i) => <Die key={i} value={v} rolling={false} size={24} />)}
          {corner && <span className="felt-dice-sum">{corner.values.reduce((a, b) => a + b, 0)}</span>}
        </button>
        <div className="felt-center">
          <span className="wind-tile">{ended ? '完' : c.info.roundWind}</span>
          <span className="small">{ended ? '已完場' : `第 ${c.info.hand} 鋪`}</span>
        </div>
      </section>

      {!ended && (
        <div className="actions">
          <span className="hint">撳食糊嗰個人入數</span>
        </div>
      )}
      {!ended && (
        <div className="acts">
          <button type="button" className="act" onClick={openSpecial}><span>特別事項</span><small>花草槓骰追</small></button>
          <button type="button" className="act" onClick={() => { unlock(); setError(''); setMore('draw'); }}><span>流局</span><small>冇人食</small></button>
          <button type="button" className="act end" onClick={() => { unlock(); setError(''); setMore('end'); }}><span>完場</span><small>全部找數</small></button>
        </div>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>紀錄</h2>
          {lastStep && !ended && (
            <button type="button" className="textbtn loss" disabled={busy} onClick={() => push({ type: 'undo', target: lastStep.seq }, '已撤回')}>撤回最後一鋪</button>
          )}
        </div>
        {c.skipped.length > 0 && <p className="banner small">{c.skipped.map((s) => `第 ${s.seq} 項計唔到：${s.message}`).join('；')}</p>}
        {c.steps.length === 0 ? (
          <p className="muted">未有紀錄。開始之前可以擲骰或者掉位；開咗就撳上面食糊嗰個人。</p>
        ) : (
          <div className="ledger" style={{ '--cols': cols.length } as CSSProperties}>
            <div className="lg-names" aria-hidden="true">
              {cols.map((id) => <span key={id} className={id === me ? 'me' : ''}>{name(id)}</span>)}
            </div>
            <ol className="lg-rows">
              {log.map((st) => {
                const net = netOf(st.delta, false);
                return (
                  <li key={st.seq}>
                    <button
                      type="button"
                      className="lg-row"
                      disabled={ended || !editable(st.event)}
                      onClick={() => { unlock(); setError(''); setEditing({ seq: st.seq, event: st.event, current: st.event.type === 'win' ? st.event.winners[0].player : '' }); }}
                    >
                      <span className="lg-head">
                        <span className="lg-what">{describe(st.event, name)}{st.edited && <span className="tag instant">改過</span>}</span>
                        <span className="lg-when">{ago(st.at, now)}</span>
                      </span>
                      <span className="lg-cells">
                        {cols.map((id) => {
                          const v = net[id] ?? 0;
                          const cash = st.delta.settled[id] ?? 0;
                          return (
                            <span key={id} className={`lg-cell${id === me ? ' me' : ''}`}>
                              {v ? <b className={`num ${tone2(v)}`}>{fmt(v)}</b> : !cash ? <span className="lg-dash">·</span> : null}
                              {cash && cash !== v ? <small className={`lg-pend ${tone2(cash)}`}>找 {fmt(cash)}</small> : null}
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="lg-total">
              <span className="lg-head"><span className="lg-what">合計</span>{c.state.water ? <span className="lg-when">抽水 {c.state.water}</span> : null}</span>
              <span className="lg-cells">
              {cols.map((id) => {
                const v = c.state.settled[id] ?? 0;
                const p = c.pending[id] ?? 0;
                return (
                  <span key={id} className={`lg-cell${id === me ? ' me' : ''}`}>
                    <b className={`num ${tone2(v + p)}`}>{fmt(v + p)}</b>
                    {p ? <><small className={`lg-pend ${tone2(v)}`}>找咗 {fmt(v)}</small><small className={`lg-pend ${tone2(p)}`}>擺 {fmt(p)}</small></> : null}
                  </span>
                );
              })}
              </span>
            </div>
          </div>
        )}
        {c.steps.length > 0 && !ended && <p className="muted small">每格係嗰鋪嘅輸贏（連擺低未找嘅）；細字「找」係嗰鋪真係找咗嘅錢。最底合計 = 找咗 + 擺低。撳任何一鋪可以改番數或者刪除。</p>}
        {c.steps.length > 5 && (
          <button type="button" className="textbtn" onClick={() => setShowAll((v) => !v)}>{showAll ? '收埋' : `睇晒 ${c.steps.length} 鋪`}</button>
        )}
      </section>

      {entry && (
        <Sheet onClose={() => setEntry(null)} label="入數">
          {entry.step === 'who' ? (
            <>
              <h2>{entry.winners.map(name).join('、')} 食糊</h2>
              <div className="field">
                <span>邊個出銃？</span>
                <div className="choices">
                  {seats.filter((s) => !entry.winners.includes(s)).map((s) => (
                    <button key={s} type="button" className="choice loser" aria-pressed={entry.loser === s} onClick={() => setEntry({ ...entry, loser: s })}>
                      <span className="ellipsis">{name(s)}</span>
                      {c.state.chains.some((ch) => ch.pulled === s && entry.winners.includes(ch.puller)) && <small>被拉緊</small>}
                    </button>
                  ))}
                  {entry.winners.length === 1 && (
                    <button type="button" className="choice" aria-pressed={entry.loser === null} onClick={() => setEntry({ ...entry, loser: null })}>自摸<small>三家俾</small></button>
                  )}
                </div>
              </div>
              {entry.loser && (
                <div className="field">
                  <span>一炮多響？撳埋另外食糊嘅人</span>
                  <div className="choices">
                    {seats.filter((s) => s !== entry.loser && s !== entry.winners[0]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="choice"
                        aria-pressed={entry.winners.includes(s)}
                        onClick={() => setEntry({ ...entry, winners: entry.winners.includes(s) ? entry.winners.filter((x) => x !== s) : [...entry.winners, s] })}
                      >
                        <span className="ellipsis">{name(s)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" className="btn big" disabled={entry.loser === undefined} onClick={() => setEntry({ ...entry, step: 'fan', current: entry.winners[0] })}>
                下一步：番數
              </button>
            </>
          ) : (
            <>
              <div className="between">
                <h2>{entry.loser === null ? `${name(entry.winners[0])} 自摸` : `${entry.winners.map(name).join('、')} 食 ${name(entry.loser ?? '')}`}</h2>
                <button type="button" className="textbtn" onClick={() => setEntry({ ...entry, step: 'who' })}>改</button>
              </div>
              {entry.winners.length > 1 && (
                <div className="choices">
                  {entry.winners.map((w) => (
                    <button key={w} type="button" className="choice" aria-pressed={entry.current === w} onClick={() => setEntry({ ...entry, current: w })}>
                      <span className="ellipsis">{name(w)}</span><small>{entry.fans[w] ?? 0} 番</small>
                    </button>
                  ))}
                </div>
              )}
              <div className="fan-row">
                <button type="button" className="stepper" aria-label="減一番" onClick={() => setFan(entry.current, (entry.fans[entry.current] ?? 0) - 1)}>−</button>
                <FanWheel key={entry.current} value={entry.fans[entry.current] ?? 0} onChange={(v) => setFan(entry.current, v)} label={`${name(entry.current)} 番數`} />
                <button type="button" className="stepper" aria-label="加一番" onClick={() => setFan(entry.current, (entry.fans[entry.current] ?? 0) + 1)}>+</button>
              </div>
              <div className="quick">
                {QUICK_FANS.map((n) => (
                  <button key={n} type="button" aria-pressed={(entry.fans[entry.current] ?? 0) === n} onClick={() => setFan(entry.current, n)}>{n}</button>
                ))}
              </div>
              <p className="center-text muted small">碌滾輪或者撳快捷掣；撳中間個數字可以自己打。{autoNote(rules)}</p>
              {preview.lines.length > 0 && (
                <div className="preview" aria-live="polite">
                  {preview.lines.filter((l) => l.kind !== 'water').map((l, i) => (
                    <div key={i} className="pv">
                      <span className={`tag ${l.kind}`}>{KIND[l.kind]}</span>
                      <span>{name(l.from)} → {l.to ? name(l.to) : '水'}</span>
                      <span className="pv-note">{l.note}</span>
                      <span className="num">{l.amount}</span>
                    </div>
                  ))}
                </div>
              )}
              {preview.error && <p className="error">{preview.error}</p>}
              <button type="button" className="btn big" disabled={busy || !draft || !!preview.error} onClick={() => draft && push(draft, '已入數')}>
                入數{draft ? `，共 ${sum(preview.lines)}` : ''}
              </button>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </Sheet>
      )}

      {more && (
        <Sheet onClose={() => setMore(null)} label="其他">
          {more === 'menu' && (
            <>
              <h2>其他</h2>
              <div className="choices three">
                {props.onSwap && !ended && <button type="button" className="choice" onClick={() => { setSwapOut(''); setSwapIn(''); setGuestName(''); setMore('swap'); }}>換人<small>加人入枱</small></button>}
                {props.onDice && !ended && <button type="button" className="choice" onClick={() => run(() => props.onDice!(), '')}>擲骰<small>三粒</small></button>}
                {props.onReseat && !ended && c.steps.length === 0 && <button type="button" className="choice" onClick={() => setMore('reseat')}>掉位<small>抽風牌</small></button>}
                {!ended && <button type="button" className="choice" onClick={() => setMore('falseWin')}>詐糊<small>俾每家 {rules.falseWinPenalty}</small></button>}
                <button type="button" className="choice" aria-pressed={sound} onClick={() => { unlock(); setSoundOn(!sound); setSound(!sound); if (!sound) setTimeout(() => sfx.tap(), 30); }}>
                  聲效<small>{sound ? '開緊' : '閂咗'}</small>
                </button>
              </div>
              {rulesHref && <Link to={rulesHref} className="textbtn center-text">睇呢個大局嘅家規</Link>}
            </>
          )}
          {more === 'falseWin' && (
            <>
              <h2>邊個詐糊？</h2>
              <div className="choices">
                {seats.map((s) => (
                  <button key={s} type="button" className="choice loser" aria-pressed={who === s} onClick={() => setWho(s)}>
                    <span className="ellipsis">{name(s)}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn big" disabled={busy || !who} onClick={() => push({ type: 'falseWin', player: who }, '已入數')}>入數</button>
            </>
          )}
          {more === 'special' && (() => {
            const item = SPECIAL_ITEMS.find((x) => x.art === spArt);
            const isChase = spArt === 'chase';
            const amount = isChase ? chaseAmount(chaseKind, repeat, instant) : item?.amount ?? 0;
            const pick = (art: Art) => {
              unlock();
              setSpArt(art);
              setSpPlay((n) => n + 1);
              if (art === 'chase') { const r = suggestRepeat(lastStep?.event, chaseKind); setRepeat(r); setInstant(r > 0); sfx.tap(); }
              else if (art === 'triple' || art === 'dice123') sfx.dice();
              else sfx.chips();
            };
            return (
              <>
                <h2>特別事項</h2>
                <p className="muted small">即時找數，唔影響拉，唔抽水。</p>
                <div className="sp-grid">
                  {SPECIAL_ITEMS.map((it) => (
                    <button
                      key={it.art + (spArt === it.art ? spPlay : 0)}
                      type="button"
                      className={`sp-card sp-${it.art}${spArt === it.art ? ' on play' : ''}`}
                      aria-pressed={spArt === it.art}
                      onClick={() => pick(it.art)}
                    >
                      <SpecialArt art={it.art} heat={it.art === 'chase' && spArt === 'chase' && instant ? repeat : 0} />
                      <span className="sp-label">{it.label}</span>
                      <span className="sp-note">{it.art === 'chase' && spArt === 'chase' ? `俾每家 ${amount}` : it.note}</span>
                    </button>
                  ))}
                </div>
                {isChase && (
                  <div className="stack tight">
                    <div className="row">
                      <span className="grow small muted">追咗咩牌</span>
                      <div className="seg" role="group" aria-label="番子定非番子">
                        {([['fan', '番子（5 起）'], ['other', '非番子（10 起）']] as const).map(([k, t]) => (
                          <button key={k} type="button" aria-pressed={chaseKind === k} onClick={() => { setChaseKind(k); const r = suggestRepeat(lastStep?.event, k); setRepeat(r); if (r > 0) setInstant(true); }}>{t}</button>
                        ))}
                      </div>
                    </div>
                    <div className="row">
                      <span className="grow small muted">係咪即摸？<br />即摸先會同一隻再追加 5</span>
                      <div className="seg" role="group" aria-label="係咪即摸">
                        <button type="button" aria-pressed={!instant} onClick={() => setInstant(false)}>唔係</button>
                        <button type="button" aria-pressed={instant} onClick={() => { setInstant(true); sfx.tap(); }}>即摸</button>
                      </div>
                    </div>
                    {instant && <div className="row">
                      <span className="grow small muted">同一隻追咗幾次{suggestRepeat(lastStep?.event, chaseKind) > 0 ? '（上一鋪都係即摸被追）' : ''}</span>
                      <div className="seg" role="group" aria-label="同一隻追咗幾次">
                        {Array.from({ length: CHASE_MAX_REPEAT + 1 }, (_, r) => (
                          <button key={r} type="button" aria-pressed={repeat === r} onClick={() => { setRepeat(r); if (r > 0) sfx.chips(); }}>
                            {r === 0 ? '第 1 次' : `+${r}`}
                          </button>
                        ))}
                      </div>
                    </div>}
                    {instant && repeat > 0 && <p className={`chase-note heat-${repeat}`}>即摸，同一隻再追 {repeat} 次：{chaseAmount(chaseKind, 0)} + {5 * repeat} = 每家 {amount}{repeat === CHASE_MAX_REPEAT ? '，追到盡' : ''}</p>}
                  </div>
                )}
                {spArt && (
                  <div className="field">
                    <span>{item?.dir === 'collect' ? '邊個收？' : isChase ? '邊個被追？' : '邊個俾？'}</span>
                    <div className="choices">
                      {seats.map((s) => (
                        <button key={s} type="button" className={`choice${item?.dir === 'pay' ? ' loser' : ''}`} aria-pressed={who === s} onClick={() => setWho(s)}>
                          <span className="ellipsis">{name(s)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  className="btn big"
                  disabled={busy || !who || !item}
                  onClick={() => {
                    if (!item) return;
                    const rep = instant ? repeat : 0;
                    const label = isChase ? `被追（${chaseKind === 'fan' ? '番子' : '非番子'}${instant ? '，即摸' : ''}）${rep > 0 ? `同一隻第 ${rep + 1} 次` : ''}` : item.label;
                    push({
                      type: 'special', player: who, label, amount, direction: item.dir,
                      meta: isChase ? { art: 'chase', chase: chaseKind, repeat: rep, instant } : { art: item.art },
                    }, '已入數');
                  }}
                >
                  {item ? `入數，${item.dir === 'collect' ? '收' : '俾'}每家 ${amount}` : '揀一樣'}
                </button>
              </>
            );
          })()}
          {more === 'draw' && (
            <>
              <h2>流局</h2>
              <p className="muted">冇人輸贏，拉住嘅數留低。{rules.dealer.drawKeepsDealer ? '莊家冧莊。' : '過莊。'}</p>
              <button type="button" className="btn big" disabled={busy} onClick={() => push({ type: 'draw' }, '已入流局')}>確認流局</button>
            </>
          )}
          {more === 'end' && (
            <>
              <h2>完場</h2>
              <p className="muted">所有拉住嘅數即刻找晒，之後呢張枱唔可以再入數。</p>
              <button type="button" className="btn big danger" disabled={busy} onClick={() => push({ type: 'end' }, '已完場')}>確認完場</button>
            </>
          )}
          {more === 'swap' && props.onSwap && (
            <>
              <h2>換人</h2>
              <div className="field">
                <span>邊個走？</span>
                <div className="choices">
                  {seats.map((s) => (
                    <button key={s} type="button" className="choice loser" aria-pressed={swapOut === s} onClick={() => setSwapOut(s)}>
                      <span className="ellipsis">{name(s)}</span>
                      {(owe[s] || collect[s]) ? <small>拉緊，會即刻找數</small> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>邊個入嚟？</span>
                <div className="choices">
                  {free.map((p) => (
                    <button key={p.id} type="button" className="choice" aria-pressed={swapIn === p.id} onClick={() => setSwapIn(p.id)}>
                      <span className="ellipsis">{p.name}</span><small>要佢接受</small>
                    </button>
                  ))}
                  <button type="button" className="choice" aria-pressed={swapIn === '__guest'} onClick={() => setSwapIn('__guest')}>訪客<small>冇帳戶</small></button>
                </div>
                {swapIn === '__guest' && (
                  <input id="swap-guest" className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="訪客名" maxLength={20} aria-label="訪客名" />
                )}
                {free.length === 0 && <p className="muted small">冇其他成員得閒。用大局嘅邀請連結叫人入嚟，佢就會出現喺度。</p>}
              </div>
              <button
                type="button"
                className="btn big"
                disabled={busy || !swapOut || !swapIn || (swapIn === '__guest' && !guestName.trim())}
                onClick={() => {
                  const guest = swapIn === '__guest';
                  const incoming = guest ? { id: `guest-${Math.random().toString(36).slice(2, 10)}`, name: guestName.trim() } : free.find((p) => p.id === swapIn);
                  if (!incoming) return;
                  run(async () => {
                    const r = await props.onSwap!(swapOut, incoming, guest);
                    if (r === 'requested') flash(`已經請 ${incoming.name} 接受`);
                  }, guest ? '已換人' : '已發出邀請');
                }}
              >
                {swapIn && swapIn !== '__guest' ? '請佢接受' : '換人'}
              </button>
            </>
          )}
          {more === 'reseat' && props.onReseat && (
            <SeatDraw players={seats} name={name} busy={busy} onCancel={() => setMore(null)} onConfirm={(s) => run(() => props.onReseat!(s), '已掉位')} />
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </Sheet>
      )}

      {diceShown !== null && dice && dice.n === diceShown && (
        <Sheet onClose={() => { revealDice(); setDiceShown(null); }} label="擲骰">
          <h2 className="center-text">{name(dice.by)} 擲骰</h2>
          <DiceRoll values={dice.values} onDone={revealDice} />
          <button type="button" className="btn big" onClick={() => { revealDice(); setDiceShown(null); }}>好</button>
        </Sheet>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)} label="改呢鋪">
          <div className="between">
            <h2>改呢鋪</h2>
            <span className="muted small">{describe(c.steps.find((x) => x.seq === editing.seq)?.event ?? editing.event, name)}</span>
          </div>
          {editing.event.type === 'win' && (() => {
            const ev = editing.event;
            if (ev.type !== 'win') return null;
            const cur = editing.current;
            const fanOf = (p: string) => ev.winners.find((w) => w.player === p)?.fan ?? 0;
            const setF = (v: number) => setEditing({ ...editing, event: { ...ev, winners: ev.winners.map((w) => (w.player === cur ? { ...w, fan: Math.max(0, Math.min(500, v)) } : w)) } });
            return (
              <>
                {ev.winners.length > 1 && (
                  <div className="choices">
                    {ev.winners.map((w) => (
                      <button key={w.player} type="button" className="choice" aria-pressed={cur === w.player} onClick={() => setEditing({ ...editing, current: w.player })}>
                        <span className="ellipsis">{name(w.player)}</span><small>{w.fan} 番</small>
                      </button>
                    ))}
                  </div>
                )}
                <div className="fan-row">
                  <button type="button" className="stepper" aria-label="減一番" onClick={() => setF(fanOf(cur) - 1)}>−</button>
                  <FanWheel key={`e-${cur}`} value={fanOf(cur)} onChange={setF} label={`${name(cur)} 番數`} />
                  <button type="button" className="stepper" aria-label="加一番" onClick={() => setF(fanOf(cur) + 1)}>+</button>
                </div>
              </>
            );
          })()}
          {editing.event.type === 'special' && (() => {
            const ev = editing.event;
            if (ev.type !== 'special') return null;
            return (
              <div className="fan-row">
                <button type="button" className="stepper" aria-label="減一" onClick={() => setEditing({ ...editing, event: { ...ev, amount: Math.max(1, ev.amount - 1) } })}>−</button>
                <span className="num big-fan">{ev.amount}</span>
                <button type="button" className="stepper" aria-label="加一" onClick={() => setEditing({ ...editing, event: { ...ev, amount: ev.amount + 1 } })}>+</button>
              </div>
            );
          })()}
          {editPreview.rows.length > 0 && (
            <div className="preview" aria-live="polite">
              {editPreview.rows.map((r) => (
                <div key={r.id} className="pv">
                  <span>{name(r.id)}</span>
                  <span className="pv-note">{r.before} → </span>
                  <span className={`num ${r.after > r.before ? 'gain' : 'loss'}`}>{r.after}</span>
                </div>
              ))}
            </div>
          )}
          {editPreview.error && <p className="error">{editPreview.error}</p>}
          <button type="button" className="btn big" disabled={busy || !editPreview.changed || !!editPreview.error} onClick={() => push({ type: 'edit', target: editing.seq, event: editing.event }, '已改')}>
            {editPreview.changed ? '儲存修改' : '未改'}
          </button>
          <button type="button" className="btn plain" disabled={busy || !!deletePreview} onClick={() => push({ type: 'undo', target: editing.seq }, '已刪除')}>刪除呢鋪</button>
          {deletePreview && <p className="muted small">{deletePreview}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </Sheet>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

const tone2 = (n: number) => (n > 0 ? 'gain' : n < 0 ? 'loss' : 'even');

/** 可以改嘅鋪：食糊、特別事項、詐糊、流局（後兩樣只可以刪） */
const editable = (e: TableEvent) => e.type === 'win' || e.type === 'special' || e.type === 'falseWin' || e.type === 'draw';

/** 未擲過骰就用枱嘅 id 砌三個固定點數做裝飾 */
function idleDice(id: string): number[] {
  let h = 7;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return [h % 6 + 1, Math.floor(h / 6) % 6 + 1, Math.floor(h / 36) % 6 + 1];
}

function autoNote(r: Rules): string {
  const parts: string[] = [];
  if (r.base) parts.push(`底 ${r.base}`);
  if (r.dealer.enabled) parts.push('莊番');
  if (r.multiWinBonus.double || r.multiWinBonus.triple) parts.push('雙響');
  if (r.reverse.enabled) parts.push('反雙響');
  return parts.length ? `${parts.join('、')}會自動加。` : '';
}
