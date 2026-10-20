// 一張枱：綠絨布枱面 + 撳人入數。資料由外面傳入，所以示範模式都用到。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { applyEvent, replay, seatWind } from '../engine/table.ts';
import type { Line, TableEvent } from '../engine/table.ts';
import type { Rules } from '../engine/rules.ts';
import type { SwapRequest, TableDoc, LogEvent } from '../lib/data.ts';
import type { Computed } from '../lib/score.ts';
import { ago, describe, netOf, trendOf } from '../lib/score.ts';
import { TrendChart } from './Charts.tsx';
import Celebrate from './Celebrate.tsx';
import CatGag from './CatGag.tsx';
import { FanPicker } from './FanTable.tsx';
import type { FanTable } from '../lib/fanTable.ts';
import { money } from './SettleScreen.tsx';
import { sfx, unlock } from '../lib/sound.ts';
import { buzz } from '../lib/haptics.ts';
import { setPref, usePrefs } from '../lib/prefs.ts';
import Settings from './Settings.tsx';
import { Link } from '../lib/router.tsx';
import { Chips, ConfirmDelete, Hint, NumInput, RollingNumber, Sheet, TopBar, fmt, message, useNow, clampName } from '../ui.tsx';
import FanWheel from './FanWheel.tsx';
import DiceRoll, { Die } from './Dice.tsx';
import SeatDraw from './SeatDraw.tsx';
import { CHASE_MAX_REPEAT, SPECIAL_ITEMS, SpecialArt, SpecialBurst, artOf, chaseAmount, suggestRepeat } from './Specials.tsx';
import type { Art } from './Specials.tsx';

const SPOTS = ['s-bottom', 's-right', 's-top', 's-left'];
// 快捷番數：每 10 一格，10 至 300
const QUICK_FANS = Array.from({ length: 30 }, (_, i) => 10 + i * 10);
const KIND: Record<Line['kind'], string> = { pending: '枱面', settle: '找數', instant: '即時', water: '抽水' };

interface Entry {
  winners: string[];
  /** undefined = 未揀；null = 自摸 */
  loser: string | null | undefined;
  fans: Record<string, number>;
  step: 'who' | 'fan';
  current: string;
  /** 呢鋪莊點計：undefined = 跟家規 */
  dealer?: 'one' | 'none';
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
  /** 局主／管理員：刪除呢張枱 */
  onDeleteTable?: () => Promise<void>;
  /** 牌友圈番數表：入番數時可以撳牌型加 */
  fanTable?: FanTable;
  /** 夠拉時揀「不找」（全枱同步） */
  onDecline?: (key: string) => Promise<void>;
  /** 找數單用嚟換算金額 */
  cash?: { perUnit: number; currency: string; rounding?: 'up' | 'round' | 'none' };
  /** 唔喺呢張枱（又唔係場主／局主）：只可以睇 */
  canEnter?: boolean;
}

const totalOf = (c: Computed, id: string) => (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0);

export default function TableScreen(props: TableScreenProps) {
  const { table, computed: c, rules, me, back, subtitle, rulesHref, candidates = [], pendingSwaps = [], notice, onPush } = props;
  const now = useNow();
  const name = useCallback((id: string) => table.names[id] ?? '玩家', [table.names]);
  const seats = c.state.seats;
  const ended = c.state.ended;
  const viewOnly = props.canEnter === false;
  // 打完圈數：問繼續（快圈／再打四圈）、換位、換人定完場
  const roundsDone = !!c.state.roundsDone && !ended;

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
  /** 暗槓／天槓唔記得開：反轉做罰，加倍 */
  const [forgot, setForgot] = useState(false);
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
  const pf = usePrefs();
  const [settings, setSettings] = useState(false);
  const [fx, setFx] = useState<{ up: string[]; down: string[]; delta: Record<string, number>; hp: boolean; key: number }>({ up: [], down: [], delta: {}, hp: false, key: 0 });
  const [diceShown, setDiceShown] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ seq: number; event: TableEvent; current: string } | null>(null);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [delTable, setDelTable] = useState(false);
  const [party, setParty] = useState<{ fan: number; key: number } | null>(null);
  const [gag, setGag] = useState<{ name: string; key: number; variant: number } | null>(null);
  const endGag = useCallback(() => setGag(null), []);
  // 食糊動畫播緊：找數單同「夠拉」提示等佢播完先出，唔好撞埋一齊
  const [winHold, setWinHold] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const deferredSettle = useRef(false);
  const held = winHold || !!party || !!gag;
  const [picking, setPicking] = useState(false);
  const [pickedNote, setPickedNote] = useState('');

  useEffect(() => { const t = setTimeout(() => setDealing(false), 900); return () => clearTimeout(t); }, []);

  // 入數時：收埋底部 tab，枱面捲返上嚟，保持睇到張枱
  const entering = !!entry;
  useEffect(() => {
    if (!entering) return;
    document.body.classList.add('entering');
    const felt = document.querySelector('.felt') as HTMLElement | null;
    if (felt) window.scrollTo({ top: Math.max(0, felt.getBoundingClientRect().top + window.scrollY - 64), behavior: 'smooth' });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEntry(null); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.classList.remove('entering'); window.removeEventListener('keydown', onKey); };
  }, [entering]);

  // 任何人嘅數有變（包括其他手機入嘅）就郁：升嘅推牌，跌嘅震
  const snapshot = seats.map((id) => `${id}:${totalOf(c, id)}:${c.state.settled[id] ?? 0}`).join('|') + `#${c.steps.length}`;
  const prev = useRef<{ snap: string; settled: Record<string, number>; total: Record<string, number>; lastSeq: number } | null>(null);
  useEffect(() => {
    const settledNow: Record<string, number> = {};
    const totalNow: Record<string, number> = {};
    for (const id of seats) { settledNow[id] = c.state.settled[id] ?? 0; totalNow[id] = totalOf(c, id); }
    const before = prev.current;
    prev.current = { snap: snapshot, settled: settledNow, total: totalNow, lastSeq: c.steps[c.steps.length - 1]?.seq ?? 0 };
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
    const lastStep = c.steps[c.steps.length - 1];
    const isNew = !!lastStep && lastStep.seq > before.lastSeq;
    if (!up.length && !down.length) {
      if (isNew && lastStep.event.type === 'draw') { sfx.draw(); buzz('tap'); }
      return;
    }
    const last = lastStep?.event;
    const hp = !!lastStep && last?.type !== 'win' && lastStep.result.lines.some((l) => l.kind === 'settle');
    setFx((f) => ({ up, down, delta, hp, key: f.key + 1 }));
    // 有人找數（包括斷拉、劈、完場、換人）：全枱彈找數單
    // 淨係新入嘅一鋪先彈（改舊數唔彈）
    if (lastStep && lastStep.seq > before.lastSeq && lastStep.result.lines.some((l) => l.kind === 'settle')) {
      setReceipt(lastStep.seq);
      if (last?.type === 'win') deferredSettle.current = true;
    }
    if (isNew && last?.type === 'win') {
      setWinHold(true);
      window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => setWinHold(false), 1300);
    }
    const art = last ? artOf(last) : null;
    if (art && last?.type === 'special') {
      const rep = last.meta?.repeat ?? 0;
      const pen = !!last.meta?.penalty;
      setBurst((b) => ({ art: pen ? 'forgot' : art, text: pen ? '唔記得開！' : art === 'chase' ? (rep > 0 ? `追 ×${rep + 1}` : '追') : art === 'heaven' ? '天槓！' : undefined, key: (b?.key ?? 0) + 1 }));
    }
    if (!isNew && lastStep && lastStep.seq < before.lastSeq) sfx.undo();
    else if (last?.type === 'win') {
      const top = Math.max(...last.winners.map((w) => w.fan));
      if (last.winners.length > 1) sfx.multi(last.winners.length);
      else if (last.loser === null) sfx.selfDraw();
      else sfx.win(top);
      buzz('win');
      if (isNew && top >= 30) setParty((p) => ({ fan: top, key: (p?.key ?? 0) + 1 }));
    }
    else if (hp) { sfx.settle(); buzz('hit'); }
    else if (last?.type === 'special' && last.meta?.penalty) { sfx.special('forgot'); buzz('hit'); }
    else if (last?.type === 'special') { sfx.special(art ?? ''); buzz(art === 'heaven' ? 'win' : 'tap'); }
    else if (last?.type === 'falseWin') {
      sfx.falseWin();
      buzz('hit');
      // 兩款貓：跟紀錄序號揀，全枱電話見到同一款
      if (isNew) setGag({ name: name(last.player), key: Date.now(), variant: (lastStep?.seq ?? 0) % 2 });
    }
    else if (last?.type === 'end') { sfx.end(); buzz('win'); }
    else sfx.tap();
    const t = setTimeout(() => setFx((f) => ({ ...f, up: [], down: [], delta: {} })), hp ? 1300 : 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // 食糊動畫完咗：先播找數聲，再出找數單／夠拉提示
  const askCount = settleableCount(c, rules, ended, table.declined ?? [], dismissed);
  const wasHeld = useRef(false);
  useEffect(() => {
    if (held) { wasHeld.current = true; return; }
    if (!wasHeld.current) return;
    wasHeld.current = false;
    if (deferredSettle.current) { deferredSettle.current = false; sfx.settle(); buzz('hit'); }
    else if (askCount > 0) { sfx.tap(); buzz('tap'); }
  }, [held]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

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

  /** 拉緊／被拉緊幾多舖（有幾條就攞最多嗰條） */
  const laCount = (id: string, side: 'puller' | 'pulled') => Math.max(0, ...c.state.chains.filter((ch) => ch[side] === id).map((ch) => ch.count));

  const every = rules.la.settleEvery;
  const settleable = rules.la.enabled && every > 0 && !ended
    ? c.state.chains.filter((ch) => {
      const key = `${ch.puller}>${ch.pulled}#${ch.count}`;
      return ch.count % every === 0 && !dismissed.includes(key) && !(table.declined ?? []).includes(key);
    })
    : [];
  // 有人夠拉未決定找唔找：先鎖住入數
  const locked = settleable.length > 0;

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
    if (viewOnly) { flash('你唔喺呢張枱，只可以睇'); return; }
    if (roundsDone) { flash('已打完圈數，請先揀繼續定完場'); return; }
    if (locked) { flash('請先決定是否找數'); sfx.tap(); return; }
    setError('');
    sfx.tap();
    setEntry({ winners: [id], loser: undefined, fans: {}, step: 'who', current: id });
    setPicking(false);
    setPickedNote('');
  }

  function chooseLoser(id: string) {
    if (!entry) return;
    setEntry({ ...entry, loser: id, step: 'fan', current: entry.winners[0] });
    sfx.tap();
  }

  /** 入數期間撳枱上嘅牌 */
  function tapDuringEntry(id: string) {
    if (!entry) return;
    if (entry.step === 'who') {
      if (entry.winners.includes(id)) { setEntry(null); return; }
      chooseLoser(id);
      return;
    }
    // 番數步驟：撳其他人 = 一炮多響（加／減贏家）
    if (id === entry.loser || entry.loser === null) return;
    if (id === entry.winners[0]) { setEntry({ ...entry, current: id }); return; }
    const has = entry.winners.includes(id);
    if (!has && entry.winners.length >= 3) return;
    const winners = has ? entry.winners.filter((x) => x !== id) : [...entry.winners, id];
    setEntry({ ...entry, winners, current: has ? entry.winners[0] : id });
    flash(has ? `取消 ${name(id)}` : `一炮多響：加 ${name(id)}`);
    sfx.tap();
  }

  const draft: TableEvent | null = useMemo(() => {
    if (!entry || entry.loser === undefined) return null;
    const ev: TableEvent = { type: 'win', winners: entry.winners.map((w) => ({ player: w, fan: entry.fans[w] ?? 0 })), loser: entry.loser };
    return entry.dealer ? { ...ev, dealer: entry.dealer } : ev;
  }, [entry]);

  const preview = useMemo((): { lines: Line[]; error: string } => {
    if (!draft) return { lines: [], error: '' };
    try {
      return { lines: applyEvent(c.state, draft, rules).lines, error: '' };
    } catch (err) {
      return { lines: [], error: message(err) };
    }
  }, [draft, c.state, rules]);

  const previewNet = useMemo(() => {
    const out: Record<string, number> = {};
    for (const l of preview.lines) {
      out[l.from] = (out[l.from] ?? 0) - l.amount;
      if (l.to) out[l.to] = (out[l.to] ?? 0) + l.amount;
    }
    return out;
  }, [preview]);

  function setFan(id: string, v: number) {
    setEntry((e) => (e ? { ...e, fans: { ...e.fans, [id]: Math.max(0, Math.min(500, Math.round(v))) } } : e));
  }

  // 骰跟住莊家：莊坐邊，骰就喺佢隔籬個角
  const dealerSpot = c.info.dealer && !ended && seats.includes(c.info.dealer) ? spotOf(seats.indexOf(c.info.dealer)) : 's-bottom';
  const diceCorner = ({ 's-bottom': 'bl', 's-right': 'br', 's-top': 'tr', 's-left': 'tl' } as Record<string, string>)[dealerSpot] ?? 'bl';
  const lastStep = c.steps[c.steps.length - 1];
  const log = [...c.steps].reverse().slice(0, showAll ? undefined : 5);
  const trend = useMemo(() => {
    const t = trendOf(c, seats);
    return seats.map((id) => ({ id, name: name(id), values: t[id] }));
  }, [c, seats, name]);
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
      return `不能刪除：${message(err)}`;
    }
  }, [editing, c, rules, table.seats]);

  /** 打開特別事項；由撳人嗰度嚟就預先揀好人（同款） */
  function openSpecial(forWho = '', art: Art | '' = '') {
    unlock();
    if (viewOnly) { flash('你唔喺呢張枱，只可以睇'); return; }
    if (locked) { flash('請先決定是否找數'); return; }
    if (roundsDone) { flash('已打完圈數，請先揀繼續定完場'); return; }
    setError('');
    setEntry(null);
    setSpArt(art);
    setSpPlay((n) => n + 1);
    setWho(forWho);
    setForgot(false);
    if (art === 'chase') { const r = suggestRepeat(lastStep?.event, chaseKind); setRepeat(r); setInstant(r > 0); }
    else { setRepeat(0); setInstant(false); }
    if (art === 'false') sfx.falseWin();
    else if (art === 'heaven') sfx.special('kong');
    else if (art) sfx.special(art);
    setMore('special');
  }

  const menuButton = (
    <button type="button" className="iconbtn" aria-label="其他：換人、擲骰、掉位、聲效" onClick={() => { unlock(); setError(''); setMore('menu'); }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>
    </button>
  );

  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>{table.name}</h1>{subtitle && <span className="muted small">{subtitle}</span>}</div>} right={menuButton} />

      {notice}

      {myPending.map((r) => (
        <div key={r.id} className="banner calm">
          <span className="grow">等待 {r.inName} 接受（換 {name(r.out)}）</span>
          {props.onCancelSwap && <button type="button" className="textbtn" onClick={() => run(() => props.onCancelSwap!(r.id), '已取消')}>取消</button>}
        </div>
      ))}

      {!held && settleable.map((ch) => (
        <div key={ch.puller + ch.pulled} className="banner settle-ask">
          <span className="grow">第 {ch.count} 拉：{name(ch.pulled)} 欠 {name(ch.puller)} <b className="num">{ch.owed}</b>，由 {name(ch.pulled)} 決定是否找數。</span>
          <button type="button" className="btn danger" disabled={busy} onClick={() => push({ type: 'settle', puller: ch.puller, pulled: ch.pulled }, '已找數')}>找數</button>
          <button
            type="button"
            className="textbtn loss"
            disabled={busy}
            onClick={() => {
              const key = `${ch.puller}>${ch.pulled}#${ch.count}`;
              if (props.onDecline) run(() => props.onDecline!(key), '');
              else setDismissed((d) => [...d, key]);
            }}
          >不找</button>
        </div>
      ))}

      <section className={`felt${dealing ? ' deal' : ''}${locked ? ' locked' : ''}`} aria-label="枱面">
        {seats.map((id, i) => {
          const settled = c.state.settled[id] ?? 0;
          const isDealer = c.info.dealer === id && !ended;
          const up = fx.up.includes(id);
          const down = fx.down.includes(id);
          const isWinner = !!entry && entry.winners.includes(id);
          const isLoser = !!entry && entry.loser === id;
          const pickable = !!entry && entry.step === 'who' && !isWinner;
          const ghost = entry ? previewNet[id] ?? 0 : 0;
          const cls = ['tile', spotOf(i), up ? 'won' : '', down ? 'hit' : '', down && fx.hp ? 'hp' : '', isWinner ? 'is-winner' : '', isLoser ? 'is-loser' : '', pickable ? 'pickable' : ''].filter(Boolean).join(' ');
          return (
            <button
              key={id}
              type="button"
              className={cls}
              onClick={() => (entry ? tapDuringEntry(id) : startWin(id))}
              disabled={ended}
              aria-label={entry ? (pickable ? `${name(id)} 出銃` : name(id)) : `${name(id)}，${settled} 番，按此記錄食糊`}
            >
              {isWinner && <span className="t-badge win">{entry?.loser === null ? '摸' : '食'}</span>}
              {isLoser && <span className="t-badge lose">銃</span>}
              {entry && ghost !== 0 && <span key={`g${ghost}`} className={`ghost ${ghost > 0 ? 'gain' : 'loss'}`}>{fmt(ghost)}</span>}
              <span className="t-name"><span className="ellipsis">{name(id)}</span>{isDealer && <span className="dealer-mark">莊{c.state.streak ? c.state.streak : ''}</span>}</span>
              <RollingNumber value={settled} className={`t-score t-${tone2(settled)}`} />
              <span className="t-foot">
                {owe[id] ? <><Chips key={`c${owe[id]}`} amount={owe[id]} pop={down} /><RollingNumber value={-owe[id]} className="t-loss" /><span className="t-la loss" title="被拉第幾舖">被拉{laCount(id, 'pulled')}</span></> : null}
                {collect[id] ? <><RollingNumber value={collect[id]} className="t-gain" /><span className="t-la gain" title="拉緊第幾舖">拉{laCount(id, 'puller')}</span></> : null}
                <span className="t-wind">{seatWind(c.state, id)}</span>
              </span>
              {fx.delta[id] ? <span className={`float ${fx.delta[id] > 0 ? 'gain' : 'loss'}${fx.hp ? ' hp' : ''}`} key={`f${fx.key}`}>{fmt(fx.delta[id])}</span> : null}
            </button>
          );
        })}
        {burst && <SpecialBurst key={burst.key} art={burst.art} text={burst.text} />}
        <button
          type="button"
          className={`felt-dice at-${diceCorner}`}
          disabled={!props.onDice || ended || busy}
          onClick={() => props.onDice && run(() => props.onDice!(), '')}
          aria-label={corner ? `骰：${corner.values.join('、')}，按此再擲` : '按此擲骰'}
        >
          {(corner?.values ?? idleDice(table.id)).map((v, i) => <Die key={i} value={v} rolling={false} size={24} />)}
          {corner && <span className="felt-dice-sum">{corner.values.reduce((a, b) => a + b, 0)}</span>}
        </button>
        <div className="felt-center">
          <span className="wind-tile">{ended ? '完' : c.info.roundWind}</span>
          <span className="small">{ended ? '已完場' : `第 ${c.info.hand} 鋪`}</span>
          <span className="felt-water">水 {c.state.water}</span>
        </div>
      </section>

      {viewOnly && !ended && <p className="banner calm">你唔喺呢張枱，只可以睇。坐低嘅人、場主同局主先可以入數。</p>}
      {roundsDone && !viewOnly && (
        <section className="rounds-done" aria-label="打完圈數">
          <div className="rounds-head">
            <span className="wind-tile small-tile">完</span>
            <div className="grow">
              <h2>打完 {rules.rounds + (c.state.extraRounds ?? 0)} 圈</h2>
              <p className="muted small">仲有冇人繼續？繼續打，拉住嘅數照拉。</p>
            </div>
          </div>
          <div className="rounds-go">
            <button type="button" className="btn" disabled={busy} onClick={() => push({ type: 'extend', rounds: 1 }, `打${c.info.nextQuick}`)}>打{c.info.nextQuick}<small>一圈</small></button>
            <button type="button" className="btn plain" disabled={busy} onClick={() => push({ type: 'extend', rounds: 4 }, '再打四圈')}>再打四圈</button>
          </div>
          <div className="rounds-more">
            {props.onReseat && <button type="button" className="textbtn" onClick={() => { setError(''); setMore('reseat'); }}>換位</button>}
            {props.onSwap && <button type="button" className="textbtn" onClick={() => { setSwapOut(''); setSwapIn(''); setGuestName(''); setError(''); setMore('swap'); }}>換人</button>}
            <button type="button" className="textbtn loss" onClick={() => { setError(''); setMore('end'); }}>完場</button>
          </div>
        </section>
      )}
      {!ended && !entry && !viewOnly && !roundsDone && (pf.hints || locked) && (
        <div className="actions">
          <span className={`hint${locked ? ' loss' : ''}`}>{locked ? '有人夠拉，決定找數後才可再入數' : '按贏家入數'}</span>
        </div>
      )}
      {!ended && !viewOnly && !roundsDone && (
        <div className="acts">
          <button type="button" className="act" disabled={locked} onClick={() => openSpecial()}><span>特別事項</span><small>花草槓骰追詐</small></button>
          <button type="button" className="act" disabled={locked} onClick={() => { unlock(); setError(''); setMore('draw'); }}><span>流局</span><small>無人食糊</small></button>
          <button type="button" className="act end" onClick={() => { unlock(); setError(''); setMore('end'); }}><span>完場</span><small>結算全部</small></button>
        </div>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>紀錄</h2>
          {lastStep && !ended && !viewOnly && (
            <button type="button" className="textbtn loss" disabled={busy} onClick={() => push({ type: 'undo', target: lastStep.seq }, '已撤回')}>撤回上一鋪</button>
          )}
        </div>
        {c.skipped.length > 0 && <p className="banner small">{c.skipped.map((s) => `第 ${s.seq} 項無法計算：${s.message}`).join('；')}</p>}
        {c.steps.length === 0 ? (
          <p className="muted">未有紀錄。</p>
        ) : (
          <div className="ledger" style={{ '--cols': cols.length, '--mi': Math.max(0, cols.indexOf(me ?? '')) } as CSSProperties}>
            {me && cols.includes(me) && <span className="lg-mecol" aria-hidden="true" />}
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
                          const water = st.result.lines.filter((l) => l.kind === 'water' && l.from === id).reduce((a, l) => a + l.amount, 0);
                          const cash = (st.delta.settled[id] ?? 0) + water;
                          return (
                            <span key={id} className={`lg-cell${id === me ? ' me' : ''}`}>
                              {v ? <b className={`num ${tone2(v)}`}>{fmt(v)}</b> : !cash ? <span className="lg-dash">·</span> : null}
                              {cash && cash !== v ? <small className={`lg-pend ${tone2(cash)}`}>{cash > 0 ? '袋' : '找'} {fmt(cash)}</small> : null}
                              {water ? <small className="lg-pend lg-water">水 −{water}</small> : null}
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
                    {p ? <><small className={`lg-pend ${tone2(v)}`}>袋 {fmt(v)}</small><small className={`lg-pend ${tone2(p)}`}>枱面 {fmt(p)}</small></> : null}
                  </span>
                );
              })}
              </span>
            </div>
          </div>
        )}
        {c.steps.length > 0 && !ended && <Hint>每格是該鋪輸贏。「找」是當鋪已找的數，「水」是抽水。合計 =「袋」（已找）+「枱面」（拉住未找）。按任何一鋪可修改或刪除。</Hint>}
        {c.steps.length > 5 && (
          <button type="button" className="textbtn" onClick={() => setShowAll((v) => !v)}>{showAll ? '收起' : `顯示全部 ${c.steps.length} 項`}</button>
        )}
      </section>

      {c.steps.length > 1 && (
        <section className="stack">
          <h2>走勢</h2>
          <TrendChart
            series={trend}
            labels={['開局', ...c.steps.map((st, i) => `第 ${i + 1} 項：${describe(st.event, name)}`)]}
            me={me}
          />
        </section>
      )}

      {entry && (
        <div className="dock" role="dialog" aria-label="入數" aria-modal="false">
          {entry.step === 'who' ? (
            <>
              <div className="dock-head">
                <h2>{entry.winners.map(name).join('、')} 食糊</h2>
                <button type="button" className="iconbtn small" aria-label="取消入數" onClick={() => setEntry(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              <p className="dock-ask">食糊：按枱上<b>出銃</b>的人，或者：</p>
              <div className="dock-chips">
                {entry.winners.length === 1 && (
                  <button type="button" className="pill big-pill" onClick={() => { setEntry({ ...entry, loser: null, step: 'fan', current: entry.winners[0] }); sfx.tap(); }}>自摸<small>三家付</small></button>
                )}
                {seats.filter((x) => !entry.winners.includes(x)).map((x) => (
                  <button key={x} type="button" className="pill" onClick={() => chooseLoser(x)}>
                    {name(x)}
                    {c.state.chains.some((ch) => ch.pulled === x && entry.winners.includes(ch.puller)) && <small>被拉中</small>}
                  </button>
                ))}
              </div>
              {entry.winners.length === 1 && (
                <div className="dock-sp">
                  <span className="small muted">或者 {name(entry.winners[0])} 有特別事項：</span>
                  <div className="dock-sp-row">
                    {SPECIAL_ITEMS.map((it) => (
                      <button key={it.art} type="button" className={`sp-chip sp-chip-${it.art}`} onClick={() => openSpecial(entry.winners[0], it.art)}>{it.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="dock-head">
                <h2>{entry.loser === null ? `${name(entry.winners[0])} 自摸` : `${entry.winners.map(name).join('、')} 食 ${name(entry.loser ?? '')}`}</h2>
                <button type="button" className="textbtn" onClick={() => setEntry({ ...entry, step: 'who', loser: undefined, winners: [entry.winners[0]] })}>修改</button>
                <button type="button" className="iconbtn small" aria-label="取消入數" onClick={() => setEntry(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              {entry.winners.length > 1 && (
                <div className="dock-chips">
                  {entry.winners.map((w) => (
                    <button key={w} type="button" className="pill" aria-pressed={entry.current === w} onClick={() => setEntry({ ...entry, current: w })}>
                      {name(w)} <b className="num">{entry.fans[w] ?? 0}</b> 番
                    </button>
                  ))}
                </div>
              )}
              <div className="dock-fan">
                <button type="button" className="stepper" aria-label="減一番" onClick={() => { setFan(entry.current, (entry.fans[entry.current] ?? 0) - 1); setPickedNote(''); }}>−</button>
                <FanWheel
                  key={entry.current}
                  compact
                  item={44}
                  visible={3}
                  value={entry.fans[entry.current] ?? 0}
                  onChange={(v) => { setFan(entry.current, v); setPickedNote(''); }}
                  label={`${name(entry.current)} 番數`}
                />
                <button type="button" className="stepper" aria-label="加一番" onClick={() => { setFan(entry.current, (entry.fans[entry.current] ?? 0) + 1); setPickedNote(''); }}>+</button>
              </div>
              <div className="dock-quick" role="group" aria-label="快捷番數">
                {QUICK_FANS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n >= 200 ? 'hot3' : n >= 100 ? 'hot2' : n >= 70 ? 'hot1' : ''}
                    aria-pressed={(entry.fans[entry.current] ?? 0) === n}
                    onClick={() => { setFan(entry.current, n); setPickedNote(''); if (n >= 70) sfx.ramp(n >= 200 ? 3 : n >= 100 ? 2 : 1); }}
                  >{n}</button>
                ))}
              </div>
              {(() => {
                // 莊食糊（包括莊自摸）或者莊出銃先問莊點計
                const dealerId = c.state.seats[c.state.dealerSeat];
                const involved = entry.loser === dealerId || entry.winners.includes(dealerId);
                if (!involved) return null;
                const autoZ = rules.dealer.enabled ? 2 * c.state.streak + 1 : 0;
                const opts: { key: 'auto' | 'one' | 'none'; label: string }[] = [{ key: 'auto', label: autoZ ? `跟家規 ${autoZ}` : '跟家規（不計）' }];
                if (autoZ !== 1) opts.push({ key: 'one', label: '當 1 番' });
                if (autoZ !== 0) opts.push({ key: 'none', label: '不計' });
                const cur = entry.dealer ?? 'auto';
                return (
                  <div className="dock-dealer">
                    <span className="small muted">莊（{name(dealerId)}）</span>
                    <div className="seg" role="radiogroup" aria-label="呢鋪莊點計">
                      {opts.map((o) => (
                        <button key={o.key} type="button" role="radio" aria-checked={cur === o.key} aria-pressed={cur === o.key} onClick={() => { setEntry({ ...entry, dealer: o.key === 'auto' ? undefined : o.key }); sfx.tap(); }}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="dock-tools">
                {props.fanTable && (
                  <button type="button" className="pill" onClick={() => setPicking(true)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
                    番數表
                  </button>
                )}
                {entry.loser && entry.winners.length < 3 && <span className="muted small">一炮多響：再按枱上其他贏家</span>}
                <span className="auto-mini">
                  {autoChips(rules).filter((x) => x.on).map((x) => x.label).join('・') || '無自動計'}
                  {rulesHref && <> · <Link to={rulesHref} className="textbtn small">家規</Link></>}
                </span>
              </div>
              {pickedNote && <p className="small muted">{pickedNote}</p>}
              {preview.error && <p className="error">{preview.error}</p>}
              <button type="button" className="btn big" disabled={busy || !draft || !!preview.error} onClick={() => draft && push(draft, '已入數')}>
                入數{draft ? `，共 ${sum(preview.lines)}` : ''}
              </button>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
      {entry && picking && props.fanTable && (
        <Sheet onClose={() => setPicking(false)} label="番數表">
          <FanPicker
            table={props.fanTable}
            onClose={() => setPicking(false)}
            onUse={(fan, picked) => { setFan(entry.current, fan); setPickedNote(picked.map((p) => p.name).join('、')); setPicking(false); sfx.tap(); }}
          />
        </Sheet>
      )}

      {more && (
        <Sheet onClose={() => setMore(null)} label="其他">
          {more === 'menu' && (
            <>
              <h2>其他</h2>
              <div className="choices three">
                {props.onSwap && !ended && !viewOnly && <button type="button" className="choice" onClick={() => { setSwapOut(''); setSwapIn(''); setGuestName(''); setMore('swap'); }}>換人<small>有人加入</small></button>}
                {props.onDice && !ended && <button type="button" className="choice" onClick={() => run(() => props.onDice!(), '')}>擲骰<small>三粒骰</small></button>}
                {props.onReseat && !ended && !viewOnly && (c.steps.length === 0 || roundsDone) && <button type="button" className="choice" onClick={() => setMore('reseat')}>{c.steps.length === 0 ? '掉位' : '換位'}<small>抽風牌或自己揀</small></button>}
                <button type="button" className="choice" aria-pressed={pf.sound} onClick={() => { unlock(); setPref('sound', !pf.sound); if (!pf.sound) setTimeout(() => sfx.tap(), 30); }}>
                  聲效<small>{pf.sound ? '開' : '關'}</small>
                </button>
                <button type="button" className="choice" onClick={() => { setMore(null); setSettings(true); }}>設定<small>提示、震動</small></button>
              </div>
              {rulesHref && <Link to={rulesHref} className="textbtn center-text">家規</Link>}
              {props.onDeleteTable && <button type="button" className="textbtn loss center-text" onClick={() => { setMore(null); setDelTable(true); }}>刪除此枱（局主）</button>}
            </>
          )}
          {more === 'falseWin' && (
            <>
              <h2>誰詐糊？</h2>
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
            const canForget = spArt === 'kong' || spArt === 'heaven';
            const penalty = canForget && forgot;
            // 金額跟家規（特別事項）設定
            const sp = rules.specials;
            const amountOf = (art: Art | ''): number => art === 'chase' ? chaseAmount(chaseKind, repeat, instant) : art === 'false' ? rules.falseWinPenalty
              : art === 'heaven' ? sp.heaven : art === 'kong' ? sp.kong : art === 'flower' ? sp.flower : art === 'grass' ? sp.grass
              : art === 'triple' ? sp.triple : art === 'dice123' ? sp.dice123 : art === 'pong' ? sp.pong : item?.amount ?? 0;
            const forgotOf = (art: Art | '') => (art === 'heaven' ? sp.heavenForgot : sp.kongForgot);
            const base = amountOf(spArt);
            const amount = penalty ? forgotOf(spArt) : base;
            const dir = penalty ? 'pay' : item?.dir;
            const pick = (art: Art) => {
              unlock();
              // 暗槓／天槓：再撳一下反轉做「唔記得開」（罰），再撳就反返轉頭
              if (art === spArt && (art === 'kong' || art === 'heaven')) {
                const on = !forgot;
                setForgot(on);
                setSpPlay((n) => n + 1);
                if (on) { sfx.special('forgot'); buzz('hit'); } else sfx.special(art === 'heaven' ? 'kong' : art);
                return;
              }
              setSpArt(art);
              setForgot(false);
              setSpPlay((n) => n + 1);
              if (art === 'chase') { const r = suggestRepeat(lastStep?.event, chaseKind); setRepeat(r); setInstant(r > 0); sfx.tap(); }
              // 每款撳落去都有自己把聲（天槓留返入數先播全套）
              else if (art === 'heaven') sfx.special('kong');
              else if (art === 'false') sfx.falseWin();
              else sfx.special(art);
            };
            return (
              <>
                <h2>特別事項</h2>
                <Hint>即時找數，不影響拉，不抽水。</Hint>
                <div className="sp-grid">
                  {SPECIAL_ITEMS.map((it) => {
                    const flipped = spArt === it.art && forgot && (it.art === 'kong' || it.art === 'heaven');
                    const a = amountOf(it.art);
                    const note = it.art === 'chase' ? (spArt === 'chase' ? `付每家 ${amount}` : it.note)
                      : flipped ? `罰每家 ${forgotOf(it.art)}`
                      : `${it.dir === 'collect' ? '收' : '付'}每家 ${a}`;
                    return (
                      <button
                        key={it.art + (spArt === it.art ? spPlay : 0)}
                        type="button"
                        className={`sp-card sp-${it.art}${spArt === it.art ? ' on play' : ''}${flipped ? ' flipped' : ''}`}
                        aria-pressed={spArt === it.art}
                        aria-label={flipped ? `${it.label}唔記得開，罰每家 ${forgotOf(it.art)}` : undefined}
                        onClick={() => pick(it.art)}
                      >
                        <SpecialArt art={flipped ? 'forgot' : it.art} heat={it.art === 'chase' && spArt === 'chase' && instant ? repeat : 0} />
                        <span className="sp-label">{flipped ? `${it.label}唔記得開` : it.label}</span>
                        <span className="sp-note">{note}</span>
                      </button>
                    );
                  })}
                </div>
                {canForget && <p className="small muted center-text">{forgot ? '再撳一下張卡 = 返去開咗（收）' : `再撳一下張卡 = 唔記得開（罰每家 ${forgotOf(spArt)}）`}</p>}
                {isChase && (
                  <div className="stack tight">
                    <div className="row">
                      <span className="grow small muted">被追的牌</span>
                      <div className="seg" role="group" aria-label="番子定非番子">
                        {([['fan', '番子 5'], ['other', '非番子 10']] as const).map(([k, t]) => (
                          <button key={k} type="button" aria-pressed={chaseKind === k} onClick={() => { setChaseKind(k); const r = suggestRepeat(lastStep?.event, k); setRepeat(r); if (r > 0) setInstant(true); }}>{t}</button>
                        ))}
                      </div>
                    </div>
                    <div className="row instant-row">
                      <span className="grow">
                        <span className="small muted">{!instant ? '即摸？按右邊' : repeat === 0 ? '即摸，再按 = 同一隻再追' : `同一隻再追 ${repeat} 次`}</span>
                      </span>
                      <button
                        key={`im-${instant ? repeat + 1 : 0}`}
                        type="button"
                        className={`instant-btn heat-${instant ? repeat + 1 : 0}`}
                        aria-pressed={instant}
                        aria-label={!instant ? '即摸' : `即摸，同一隻再追 ${repeat} 次，再按${repeat >= CHASE_MAX_REPEAT ? '取消' : '加一'}`}
                        onClick={() => {
                          if (!instant) { setInstant(true); setRepeat(0); sfx.ramp(0); return; }
                          if (repeat >= CHASE_MAX_REPEAT) { setInstant(false); setRepeat(0); sfx.undo(); return; }
                          setRepeat(repeat + 1);
                          sfx.ramp(repeat + 1);
                          buzz('tap');
                        }}
                      >
                        <span>即摸</span>
                        {instant && repeat > 0 && <b className="num">+{repeat}</b>}
                      </button>
                    </div>
                    {instant && <p className={`chase-note heat-${repeat}`}>{repeat === 0 ? '即摸' : `即摸，再追 ${repeat} 次`}：{chaseAmount(chaseKind, 0, false)} + {5 * (repeat + 1)} = 每家 {amount}{repeat === CHASE_MAX_REPEAT ? '（封頂）' : ''}</p>}
                  </div>
                )}
                {spArt && (
                  <div className="field">
                    <span>{penalty ? '誰唔記得開？' : item?.dir === 'collect' ? '誰收？' : isChase ? '誰被追？' : spArt === 'false' ? '誰詐糊？' : '誰付？'}</span>
                    <div className="choices">
                      {seats.map((s) => (
                        <button key={s} type="button" className={`choice${dir === 'pay' ? ' loser' : ''}`} aria-pressed={who === s} onClick={() => setWho(s)}>
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
                    if (item.art === 'false') { push({ type: 'falseWin', player: who }, '已入數'); return; }
                    const rep = instant ? repeat : 0;
                    const label = isChase ? `被追（${chaseKind === 'fan' ? '番子' : '非番子'}${instant ? '，即摸' : ''}）${rep > 0 ? `同一隻第 ${rep + 1} 次` : ''}` : penalty ? `${item.label}唔記得開（罰）` : item.label;
                    push({
                      type: 'special', player: who, label, amount, direction: penalty ? 'pay' : item.dir,
                      meta: isChase ? { art: 'chase', chase: chaseKind, repeat: rep, instant } : penalty ? { art: item.art, penalty: true } : { art: item.art },
                    }, '已入數');
                  }}
                >
                  {item ? `入數，${dir === 'collect' ? '收' : '付'}每家 ${amount}` : '請選擇'}
                </button>
              </>
            );
          })()}
          {more === 'draw' && (
            <>
              <h2>流局</h2>
              <p className="muted">無人輸贏，拉住的數保留。{rules.dealer.drawKeepsDealer ? '莊家連莊。' : '過莊。'}</p>
              <button type="button" className="btn big" disabled={busy} onClick={() => push({ type: 'draw' }, '已入流局')}>確認流局</button>
            </>
          )}
          {more === 'end' && (
            <>
              <h2>完場</h2>
              <p className="muted">所有拉住的數即時結算，之後不能再入數。</p>
              <button type="button" className="btn big danger" disabled={busy} onClick={() => push({ type: 'end' }, '已完場')}>確認完場</button>
            </>
          )}
          {more === 'swap' && props.onSwap && (
            <>
              <h2>換人</h2>
              <div className="field">
                <span>誰離開？</span>
                <div className="choices">
                  {seats.map((s) => (
                    <button key={s} type="button" className="choice loser" aria-pressed={swapOut === s} onClick={() => setSwapOut(s)}>
                      <span className="ellipsis">{name(s)}</span>
                      {(owe[s] || collect[s]) ? <small>有拉，會先結算</small> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>誰加入？</span>
                <div className="choices">
                  {free.map((p) => (
                    <button key={p.id} type="button" className="choice" aria-pressed={swapIn === p.id} onClick={() => setSwapIn(p.id)}>
                      <span className="ellipsis">{p.name}</span><small>需對方接受</small>
                    </button>
                  ))}
                  <button type="button" className="choice" aria-pressed={swapIn === '__guest'} onClick={() => setSwapIn('__guest')}>訪客<small>無帳戶</small></button>
                </div>
                {swapIn === '__guest' && (
                  <input id="swap-guest" className="input" value={guestName} onChange={(e) => setGuestName(clampName(e.target.value))} placeholder="訪客名" aria-label="訪客名" />
                )}
                {free.length === 0 && <p className="muted small">沒有空閒成員。可用大局邀請連結邀請新人。</p>}
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
                    if (r === 'requested') flash(`已邀請 ${incoming.name}`);
                  }, guest ? '已換人' : '已發出邀請');
                }}
              >
                {swapIn && swapIn !== '__guest' ? '發出邀請' : '換人'}
              </button>
            </>
          )}
          {more === 'reseat' && props.onReseat && (
            <SeatDraw players={seats} name={name} busy={busy} title={c.steps.length ? '換位' : '掉位'} onCancel={() => setMore(null)} onConfirm={(s) => run(() => props.onReseat!(s), '已掉位')} />
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
        <Sheet onClose={() => setEditing(null)} label="修改">
          <div className="between">
            <h2>修改</h2>
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
            {editPreview.changed ? '儲存' : '未有修改'}
          </button>
          <button type="button" className="btn plain" disabled={busy || !!deletePreview} onClick={() => push({ type: 'undo', target: editing.seq }, '已刪除')}>刪除此鋪</button>
          {deletePreview && <p className="muted small">{deletePreview}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </Sheet>
      )}

      {settings && <Settings onClose={() => setSettings(false)} />}
      {party && <Celebrate key={party.key} fan={party.fan} onDone={() => setParty(null)} />}
      {gag && <CatGag key={gag.key} name={gag.name} variant={gag.variant} onDone={endGag} />}
      {delTable && props.onDeleteTable && (
        <ConfirmDelete title="刪除此枱" detail={`會永久刪除「${table.name}」所有紀錄，無法復原。`} word={table.name} onConfirm={props.onDeleteTable} onClose={() => setDelTable(false)} />
      )}
      {receipt !== null && !held && (() => {
        const st = c.steps.find((x) => x.seq === receipt);
        if (!st) return null;
        const settles = st.result.lines.filter((l) => l.kind === 'settle');
        const waters = st.result.lines.filter((l) => l.kind === 'water');
        const waterTotal = waters.reduce((a, l) => a + l.amount, 0);
        const cash = props.cash;
        const toCash = (fan: number) => {
          if (!cash || !(cash.perUnit > 0)) return '';
          const v = fan / cash.perUnit;
          const r = cash.rounding === 'up' ? Math.ceil(v - 1e-9) : cash.rounding === 'round' ? Math.round(v) : v;
          return `${cash.rounding === 'none' ? '≈ ' : ''}${money(r)}`;
        };
        const people = Object.entries(st.delta.settled).filter(([, v]) => v).sort((a, b) => a[1] - b[1]);
        return (
          <Sheet onClose={() => setReceipt(null)} label="找數單">
            <div className="between">
              <h2>找數</h2>
              <span className="muted small">{describe(st.event, name)}</span>
            </div>
            <ul className="receipt">
              {settles.map((l, i) => (
                <li key={i}>
                  <span className="rc-who"><b className="loss">{name(l.from)}</b><span className="muted"> 付 </span><b className="gain">{l.to ? name(l.to) : '水'}</b></span>
                  <span className="rc-amt"><b className="num">{l.amount}</b> 番<small className="muted">{toCash(l.amount)}</small></span>
                  <small className="rc-note muted">{l.note}</small>
                </li>
              ))}
              {waters.length > 0 && (
                <li className="rc-water">
                  <span className="rc-who">抽水</span>
                  <span className="rc-amt"><b className="num">{waterTotal}</b> 番<small className="muted">{toCash(waterTotal)}</small></span>
                  <small className="rc-note muted">{waters.map((l) => `${name(l.from)} ${l.amount}（${l.note}）`).join('、')}</small>
                </li>
              )}
            </ul>
            {people.length > 0 && (
              <div className="rc-net">
                {people.map(([id, v]) => (
                  <span key={id}>{name(id)} <b className={`num ${v > 0 ? 'gain' : 'loss'}`}>{v > 0 ? `收 ${v}` : `付 ${-v}`}</b></span>
                ))}
              </div>
            )}
            <button type="button" className="btn big" onClick={() => setReceipt(null)}>好</button>
          </Sheet>
        );
      })()}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

/** 有幾多條拉夠數要問找唔找（同上面 settleable 一樣嘅條件） */
function settleableCount(c: Computed, rules: Rules, ended: boolean, declined: string[], dismissed: string[]): number {
  const every = rules.la.settleEvery;
  if (!rules.la.enabled || every <= 0 || ended) return 0;
  return c.state.chains.filter((ch) => {
    const key = `${ch.puller}>${ch.pulled}#${ch.count}`;
    return ch.count % every === 0 && !dismissed.includes(key) && !declined.includes(key);
  }).length;
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

function autoChips(r: Rules): { label: string; on: boolean }[] {
  return [
    { label: r.base ? `底 ${r.base}` : '底', on: r.base > 0 },
    { label: '莊', on: r.dealer.enabled },
    { label: '雙三響', on: !!(r.multiWinBonus.double || r.multiWinBonus.triple) },
    { label: '反雙響', on: r.reverse.enabled },
  ];
}
