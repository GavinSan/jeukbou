// 埋數：麻雀數（連水）同晚餐等開支分開計，亦可以合併；Group 一齊計；最少轉賬
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { MoneyRounding } from '../engine/settlement.ts';
import { guestId, isGuest, pairActive, teamActive } from '../lib/data.ts';
import type { ExpenseDoc, PairDoc, Payout, SettleConfig, TeamDoc } from '../lib/data.ts';
import { payKey } from '../lib/data.ts';
import { buildSettle, payoutOf, samePayout } from '../lib/settle.ts';
import { Hint, NumInput, Sheet, TopBar, clampName, message, useConfirm } from '../ui.tsx';
import { go } from '../lib/router.tsx';

export interface Player {
  id: string;
  name: string;
}

export interface SettleScreenProps {
  title: string;
  back: string;
  players: Player[];
  /** 每人番數（已找 + 枱面，已扣水） */
  fan: Record<string, number>;
  water: number;
  /** 未完場嘅枱數 */
  unfinished: number;
  config: SettleConfig;
  /** 局主先改到設定 */
  canEdit: boolean;
  /** 可以收水嘅人（成員 + 今晚玩家） */
  accounts: Player[];
  expenses: ExpenseDoc[];
  pairs: PairDoc[];
  /** 牌友圈嘅預設 Group（每次自動一齊計） */
  teams?: TeamDoc[];
  /** 管理預設 Group 嘅頁 */
  teamsHref?: string;
  me: string | null;
  onSaveConfig: (c: SettleConfig) => Promise<void>;
  /** 埋數設定喺家規頁 */
  settingsHref?: string;
  /** 水由誰保管：場主（或局主）改得，只可以揀局入面嘅人 */
  canSetWater?: boolean;
  waterOptions?: Player[];
  onSetWaterTo?: (uid: string) => Promise<void>;
  /** 埋數（完場並鎖定） */
  closing?: {
    closed: { by: string; at: number } | null;
    request: { by: string; approvals: string[] } | null;
    /** 要同意嘅人（有帳戶嘅玩家） */
    needed: string[];
    isHost: boolean;
    onClose: (payout?: Payout) => Promise<void>;
    onRequest: () => Promise<void>;
    onApprove: () => Promise<void>;
    onCancel: () => Promise<void>;
    /** 全部轉賬已轉 */
    allPaid?: boolean;
  };
  onAddExpense: (e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>) => Promise<void>;
  /** 埋數後嘅轉賬快照、已轉標記 */
  payout?: Payout | null;
  paid?: Record<string, { by: string; at: number }>;
  onMarkPaid?: (key: string, on: boolean) => Promise<void>;
  onSavePayout?: (p: Payout) => Promise<void>;
  /** 轉賬詳情頁 */
  payHref?: string;
  onDeleteExpense: (id: string) => Promise<void>;
  /** 改開支 */
  onUpdateExpense?: (id: string, e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>) => Promise<void>;
  onProposePair: (a: string, b: string) => Promise<void>;
  onAcceptPair: (id: string) => Promise<void>;
  /** 同意預設 Group */
  onAcceptTeam?: (id: string) => Promise<void>;
  onDeletePair: (id: string) => Promise<void>;
  /** 今日有份但冇打牌嘅人（開支用） */
  people?: Player[];
  onAddPerson?: (p: Player) => Promise<void>;
  onRemovePerson?: (p: Player) => Promise<void>;
  /** 已埋數：唔可以再加或者改開支、Group（局主除外） */
  locked?: boolean;
  /** 每張枱每人番數（撳人睇明細用） */
  perTable?: { id: string; name: string; fan: Record<string, number> }[];
  /** 超級管理員：Group 即刻生效 */
  isAdmin?: boolean;
  /** 所有資料（枱、每鋪、開支、Group）載入晒：未載晒唔好存快照 */
  ready?: boolean;
  /** 今晚唔用嘅預設 Group */
  skipTeams?: string[];
  onSkipTeam?: (teamId: string, skip: boolean) => Promise<void>;
}

const LABELS = ['晚餐', '宵夜', '飲品', '的士', '場租', '其他'];
const CURRENCIES = ['CAD', 'HKD', 'USD'];
const ROUND_LABEL: Record<MoneyRounding, string> = { up: '每人金額向上取整', round: '每人金額四捨五入', none: '' };

/** 金額輸入：淨係數字同一個小數點，最多兩位小數，唔會有「01」 */
function cleanMoney(raw: string): string {
  let t = raw.replace(/[^0-9.]/g, '');
  const i = t.indexOf('.');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2);
  return t.replace(/^0+(?=\d)/, '');
}

export function money(n: number, signed = false): string {
  const abs = Math.abs(Math.round(n * 100) / 100);
  const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const sign = n < -0.004 ? '−' : signed && n > 0.004 ? '+' : '';
  return `${sign}$${txt}`;
}

const tone = (n: number) => (n > 0.004 ? 'gain' : n < -0.004 ? 'loss' : 'even');
const fanTxt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

type SheetKind = null | 'config' | 'expense' | 'pair' | 'person' | { edit: ExpenseDoc } | { who: string };
type View = 'game' | 'expense' | 'combined';

const PlusIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);

export default function SettleScreen(p: SettleScreenProps) {
  const cfg = p.config;
  const ids = p.players.map((x) => x.id);
  const people = p.people ?? [];
  const guestNames: Record<string, string> = Object.assign({}, ...p.expenses.map((e) => e.names ?? {}));
  const nameOf = (id: string) => p.players.find((x) => x.id === id)?.name ?? people.find((x) => x.id === id)?.name
    ?? p.accounts.find((x) => x.id === id)?.name ?? guestNames[id] ?? '玩家';
  const accountName = (key: string) => key.split(' + ').map(nameOf).join(' + ');
  /** 戶口名：Group 就逐個名一行，唔使切 … */
  const Acct = ({ k, cls }: { k: string; cls: string }) => {
    const parts = k.split(' + ');
    if (parts.length === 1) return <span className={`acct ${cls}`}>{nameOf(k)}</span>;
    return <span className={`acct grp ${cls}`} title={accountName(k)}>{parts.map((id) => <span key={id}>{nameOf(id)}</span>)}</span>;
  };
  const locked = !!p.locked;

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [view, setView] = useState<View>('combined');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmUI, ask] = useConfirm();

  const skipTeams = p.skipTeams ?? [];
  const inputKey = JSON.stringify([p.players, people, p.fan, p.water, cfg, p.expenses, p.pairs, p.teams ?? [], skipTeams]);
  const built = useMemo(
    () => buildSettle({ players: p.players, people, fan: p.fan, water: p.water, cfg, expenses: p.expenses, pairs: p.pairs, teams: p.teams ?? [], skipTeams }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputKey],
  );
  const { r, activePairs, attendees, shares, isAll } = built;
  const tonightDefaults = (p.teams ?? []).map((t) => ({ t, here: t.members.filter((m) => attendees.includes(m)), active: teamActive(t) })).filter((x) => x.here.length > 0);
  const led = r ? (view === 'game' ? r.gameLedger : view === 'expense' ? r.expenseLedger : r.combined) : null;
  const closed = !!p.closing?.closed;
  const editing = sheet && typeof sheet === 'object' && 'edit' in sheet ? sheet.edit : null;
  const who = sheet && typeof sheet === 'object' && 'who' in sheet ? sheet.who : null;

  const snapshot = (): Payout | null => (r ? payoutOf(r, cfg.currency, nameOf) : null);
  // 已埋數：快照未有或者同而家計出嚟唔同（例如局主改過開支）就更新。
  // 一定要等晒資料載入（唔係就會存咗一個淨係開支、冇 Group 嘅錯數）
  const ready = p.ready !== false;
  const savedKey = useRef('');
  useEffect(() => {
    if (!ready || !closed || !r || !p.onSavePayout) return;
    const snap = snapshot();
    if (!snap || samePayout(snap, p.payout)) return;
    const k = JSON.stringify(snap.transfers);
    if (savedKey.current === k) return;
    savedKey.current = k;
    p.onSavePayout(snap).catch(() => { savedKey.current = ''; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, closed, p.payout, r]);

  // 每個戶口：麻雀（連水）、開支、合計
  const summary = r ? Object.keys(r.combined.accounts)
    .map((k) => ({ k, game: r.gameLedger.accounts[k] ?? 0, exp: r.expenseLedger.accounts[k] ?? 0, total: r.combined.accounts[k] ?? 0 }))
    .filter((x) => Math.abs(x.game) > 0.004 || Math.abs(x.exp) > 0.004)
    .sort((a, b) => b.total - a.total) : [];
  const items = p.expenses.filter((e) => e.kind === 'expense');
  const moves = p.expenses.filter((e) => e.kind === 'transfer');
  const expTotal = items.reduce((a, e) => a + e.amount, 0);
  const tfTotal = led ? led.transfers.reduce((a, t) => a + t.amount, 0) : 0;
  const showPaid = view === 'combined' && closed && !!p.onMarkPaid;
  const paidCount = r ? r.combined.transfers.filter((t) => p.paid?.[payKey(t)]).length : 0;
  const shareLabel = (e: ExpenseDoc) => (isAll[e.id] ? '全部人有份' : `${(shares[e.id] ?? e.sharedBy).length} 人有份`);

  async function run(task: () => Promise<void>, keepSheet = false) {
    setBusy(true);
    setError('');
    try {
      await task();
      if (!keepSheet) setSheet(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function shareText(): string {
    if (!r) return '';
    const out = [`${p.title} 埋數（${cfg.perUnit} 番 = ${cfg.currency} $1${ROUND_LABEL[cfg.rounding] ? `，${ROUND_LABEL[cfg.rounding]}` : ''}）`];
    const block = (title: string, ts: { from: string; to: string; amount: number }[]) => {
      out.push('', `【${title}】`);
      if (!ts.length) out.push('不用轉賬');
      for (const t of ts) out.push(`${accountName(t.from)} → ${accountName(t.to)} ${money(t.amount)}`);
    };
    out.push('', '【每人】麻雀／開支／合計');
    for (const x of summary) out.push(`${accountName(x.k)}：${money(x.game, true)}／${money(x.exp, true)}／${money(x.total, true)}`);
    block(p.expenses.length ? '轉賬（麻雀＋開支合併）' : '轉賬', r.combined.transfers);
    if (p.expenses.length) {
      block('只計麻雀', r.gameLedger.transfers);
      block('只計開支', r.expenseLedger.transfers);
      out.push('', `【開支】合共 ${money(expTotal)}`);
      for (const e of p.expenses) {
        out.push(e.kind === 'transfer'
          ? `${nameOf(e.payer)} 已付 ${nameOf(e.sharedBy[0] ?? '')} ${money(e.amount)}`
          : `${e.label} ${money(e.amount)}（${nameOf(e.payer)} 俾，${shareLabel(e)}）${e.note ? `：${e.note}` : ''}`);
      }
    }
    out.push('', `水：${p.water} 番，${money(r.water.total)}`);
    return out.join('\n');
  }

  async function share() {
    const text = shareText();
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 用戶取消 */ }
  }

  const gameRows = r ? p.players.map((pl) => ({ ...pl, fan: p.fan[pl.id] ?? 0, cash: r.game[pl.id] ?? 0 })).sort((a, b) => b.fan - a.fan) : [];
  // Group 合埋做一格：先合埋番數再取整；成員顯示各自份數（未取整）
  type Block = { key: string; name: string; fan: number; cash: number; members?: typeof gameRows };
  const gameBlocks: Block[] = [];
  if (r) {
    const done = new Set<string>();
    for (const row of gameRows) {
      if (done.has(row.id)) continue;
      const grp = activePairs.find((g) => g.includes(row.id));
      if (!grp) { gameBlocks.push({ key: row.id, name: row.name, fan: row.fan, cash: row.cash }); continue; }
      const members = gameRows.filter((x) => grp.includes(x.id));
      members.forEach((x) => done.add(x.id));
      const key = grp.join(' + ');
      gameBlocks.push({ key, name: accountName(key), fan: members.reduce((a, x) => a + x.fan, 0), cash: r.gameAccounts[key] ?? 0, members });
    }
  }
  const mine = (k: string) => !!p.me && k.split(' + ').includes(p.me);

  // 今日有份嘅人：我先，之後玩家，再之後其他人
  const roster: Player[] = useMemo(() => {
    const list = attendees.map((id) => ({ id, name: nameOf(id) }));
    return list.sort((a, b) => (a.id === p.me ? -1 : b.id === p.me ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendees.join(','), p.me, inputKey]);
  const others = p.accounts.filter((a) => !attendees.includes(a.id));

  // 開支表：每人每項俾咗（+）／有份（−），合計 = 最後要收／俾嘅數
  const matrixPeople = r ? attendees.filter((id) => items.some((e) => e.payer === id || (shares[e.id] ?? []).includes(id)) || moves.some((e) => e.payer === id || e.sharedBy.includes(id))) : [];
  const cell = (e: ExpenseDoc, id: string) => {
    const sh = shares[e.id] ?? e.sharedBy;
    return (e.payer === id ? e.amount : 0) - (sh.includes(id) ? e.amount / sh.length : 0);
  };
  const moveCell = (id: string) => moves.reduce((a, e) => a + (e.payer === id ? e.amount : 0) - (e.sharedBy.includes(id) ? e.amount : 0), 0);
  const matrixRows = r ? matrixPeople.map((id) => ({ id, cells: items.map((e) => cell(e, id)), move: moveCell(id), total: r.expense[id] ?? 0 })).sort((a, b) => b.total - a.total) : [];

  return (
    <main className="page settle-page">
      <TopBar back={p.back} title={<div className="stack tight"><h1>埋數</h1><span className="muted small">{p.title}</span></div>} />

      {p.unfinished > 0 && <p className="banner calm small">有 {p.unfinished} 枱未完場，枱面（拉住未找）已計入。</p>}

      <button type="button" className="rate" onClick={() => (p.settingsHref ? go(p.settingsHref) : setSheet('config'))}>
        <span className="rate-fan"><b className="num">{cfg.perUnit}</b> 番</span>
        <span className="rate-eq">=</span>
        <span className="rate-cash"><b className="num">$1</b> {cfg.currency}</span>
        <span className="rate-edit">{p.canEdit ? '在家規修改' : '家規'}</span>
      </button>
      {(ROUND_LABEL[cfg.rounding] || (p.canSetWater && p.onSetWaterTo && p.waterOptions?.length)) && (
        <div className="rate-note muted small">
          {ROUND_LABEL[cfg.rounding] && <span>{ROUND_LABEL[cfg.rounding]}</span>}
          {p.canSetWater && p.onSetWaterTo && p.waterOptions?.length ? (
            <>
              {ROUND_LABEL[cfg.rounding] && <span> · </span>}
              <span>水由</span>
              <select className="inline-select" value={cfg.waterTo} aria-label="水由誰保管" onChange={(e) => run(() => p.onSetWaterTo!(e.target.value))}>
                {p.waterOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <span>保管</span>
            </>
          ) : null}
        </div>
      )}

      {p.closing && <CloseBar c={{ ...p.closing, allPaid: !!r && r.combined.transfers.length > 0 && r.combined.transfers.every((t) => p.paid?.[payKey(t)]), onClose: () => p.closing!.onClose(snapshot() ?? undefined) }} me={p.me} nameOf={nameOf} busy={busy} run={run} />}

      {built.error && <p className="error">{built.error}</p>}

      {r && led && (
        <section className="stack">
          <div className="section-head">
            <h2>轉賬{showPaid && r.combined.transfers.length > 0 && <small className="muted head-note">已轉 {paidCount}/{r.combined.transfers.length}</small>}</h2>
            <button type="button" className="textbtn" onClick={share}>{copied ? '已複製' : '分享'}</button>
          </div>
          <div className="seg wide" role="group" aria-label="轉賬類別">
            <button type="button" aria-pressed={view === 'combined'} onClick={() => setView('combined')}>合併</button>
            <button type="button" aria-pressed={view === 'game'} onClick={() => setView('game')}>麻雀</button>
            <button type="button" aria-pressed={view === 'expense'} onClick={() => setView('expense')}>開支</button>
          </div>
          {led.transfers.length ? (
            <>
              <ol className={`transfers${showPaid ? ' has-paid' : ''}`}>
                {led.transfers.map((t, i) => {
                  const key = payKey(t);
                  const done = !!p.paid?.[key];
                  // 只有俾錢嗰個（Group 入面任何一個）先標記得
                  const canMark = mine(t.from) || !!p.isAdmin;
                  return (
                    <li key={i} className={showPaid && done ? 'done' : ''}>
                      <Acct k={t.from} cls="tf-from" />
                      <span className="tf-arrow" aria-label="俾">
                        <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 6h18M15 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      <Acct k={t.to} cls="tf-to" />
                      <b className="num tf-amt">{money(t.amount)}</b>
                      {showPaid && (canMark ? (
                        <button type="button" className={`tf-paid${done ? ' on' : ''}`} aria-pressed={done} aria-label={done ? '已轉，撳一下改返未轉' : '未轉，撳一下標記已轉'} disabled={busy} onClick={() => run(() => p.onMarkPaid!(key, !done), true)}>
                          {done ? '✓ 已轉' : '未轉'}
                        </button>
                      ) : (
                        <span className={`tf-paid static${done ? ' on' : ''}`}>{done ? '✓ 已轉' : '未轉'}</span>
                      ))}
                    </li>
                  );
                })}
              </ol>
              <p className="tf-total muted small">共 {led.transfers.length} 筆，合共 <b className="num">{money(tfTotal)}</b></p>
            </>
          ) : (
            <p className="muted">{view === 'expense' && !p.expenses.length ? '未有開支。' : '不用轉賬。'}</p>
          )}
          {showPaid && <Hint>俾錢嗰個轉咗就撳「未轉」標記（Group 一齊俾，任何一個標記都得），全部人都會見到。</Hint>}
          {p.payHref && closed && (
            <button type="button" className="link-card" onClick={() => go(p.payHref!)}>
              <span className="grow"><b>轉賬詳情</b><small>收款 email、邊筆未轉</small></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>
          )}
        </section>
      )}

      {r && summary.length > 0 && (
        <section className="stack">
          <h2>每人總結</h2>
          <div className="ledger settle-table sum-table">
            <div className="st-row st-head four"><span>玩家</span><span>麻雀</span><span>開支</span><span>合計</span></div>
            {summary.map((x) => (
              <button key={x.k} type="button" className={`st-row four st-tap${mine(x.k) ? ' me' : ''}`} onClick={() => setSheet({ who: x.k })} aria-label={`${accountName(x.k)} 明細`}>
                <Acct k={x.k} cls="" />
                <span className={`num ${tone(x.game)}`}>{money(x.game, true)}</span>
                <span className={`num ${tone(x.exp)}`}>{money(x.exp, true)}</span>
                <b className={`num ${tone(x.total)}`}>{money(x.total, true)}<span className="chev" aria-hidden="true">›</span></b>
              </button>
            ))}
          </div>
          <Hint>撳一個人睇明細：每張枱、每項開支。正數 = 收錢，負數 = 俾錢。</Hint>
        </section>
      )}

      {r && (
        <section className="stack">
          <h2>麻雀</h2>
          <div className="ledger settle-table">
            <div className="st-row st-head three"><span>玩家</span><span>番</span><span>金額</span></div>
            {gameBlocks.map((b) => b.members ? (
              <div key={b.key} className={`st-group${mine(b.key) ? ' me' : ''}`}>
                <div className="st-row three st-group-head">
                  <span><Acct k={b.key} cls="" /></span>
                  <span className={`num ${tone(b.fan)}`}>{fanTxt(b.fan)}</span>
                  <b className={`num ${tone(b.cash)}`}>{money(b.cash, true)}</b>
                </div>
                {b.members.map((row) => (
                  <div key={row.id} className="st-row three st-member">
                    <span className="ellipsis">{row.name}</span>
                    <span className="num">{fanTxt(row.fan)}</span>
                    <span className="num">{money(row.cash, true)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div key={b.key} className={`st-row three${b.key === p.me ? ' me' : ''}`}>
                <span className="ellipsis">{b.name}</span>
                <span className={`num ${tone(b.fan)}`}>{fanTxt(b.fan)}</span>
                <b className={`num ${tone(b.cash)}`}>{money(b.cash, true)}</b>
              </div>
            ))}
            <div className="st-row three st-water">
              <span className="ellipsis">水</span>
              <span className="num">{p.water}</span>
              <b className="num">{money(r.water.total, true)}</b>
            </div>
          </div>
          {activePairs.length > 0 && <Hint>Group 先合埋番數，再用一個戶口取整；下面細字係各自份數。</Hint>}
          {cfg.rounding !== 'none' && Math.abs(r.water.rounding) > 0.004 && (
            <Hint>水 {money(r.water.raw)}，取整差額 {money(r.water.rounding, true)}，合共 {money(r.water.total)}。</Hint>
          )}
        </section>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>開支{expTotal > 0 && <small className="muted head-note">合共 {money(expTotal)}</small>}</h2>
          {!locked && <button type="button" className="iconbtn add-btn" aria-label="新增開支" onClick={() => { setError(''); setSheet('expense'); }}><PlusIcon /></button>}
        </div>
        {r && matrixRows.length > 0 && (
          <div className="exp-matrix-wrap">
            <table className="exp-matrix">
              <thead>
                <tr>
                  <th scope="col">玩家</th>
                  {items.map((e) => <th key={e.id} scope="col">{e.label}<small>{money(e.amount)}</small></th>)}
                  {moves.length > 0 && <th scope="col">已轉賬</th>}
                  <th scope="col" className="tot">合計</th>
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((row) => (
                  <tr key={row.id} className={row.id === p.me ? 'me' : ''}>
                    <th scope="row">{nameOf(row.id)}</th>
                    {row.cells.map((v, i) => <td key={i} className={`num ${tone(v)}`}>{Math.abs(v) > 0.004 ? money(v, true) : '–'}</td>)}
                    {moves.length > 0 && <td className={`num ${tone(row.move)}`}>{Math.abs(row.move) > 0.004 ? money(row.move, true) : '–'}</td>}
                    <td className={`num tot ${tone(row.total)}`}>{money(row.total, true)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">合共</th>
                  {items.map((e) => <td key={e.id} className="num">{money(e.amount)}</td>)}
                  {moves.length > 0 && <td />}
                  <td className="num tot">{money(expTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {p.expenses.length ? (
          <ul className="list exp-list">
            {p.expenses.map((e) => (
              <li key={e.id} className="exp-row">
                <button type="button" className="exp-edit" aria-label={`修改 ${e.label}`} disabled={locked} onClick={() => { setError(''); setSheet({ edit: e }); }}>
                  <span className="exp-tag">{e.kind === 'transfer' ? '轉' : e.label.slice(0, 1)}</span>
                  <span className="grow exp-text">
                    <span>{e.kind === 'transfer' ? `${nameOf(e.payer)} 已付 ${nameOf(e.sharedBy[0] ?? '')}` : e.label}</span>
                    <small className="muted">
                      {e.kind === 'transfer' ? '已轉賬' : `${nameOf(e.payer)} 俾 · ${shareLabel(e)}`}
                      {e.note ? ` · ${e.note}` : ''}
                    </small>
                  </span>
                  <b className="num">{money(e.amount)}</b>
                  {!locked && <span className="chev" aria-hidden="true">›</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">未有開支。晚餐、的士、場租等在此分，與麻雀數分開。</p>
        )}
        <div className="people-row">
          <span className="muted small">今日有份：{attendees.length} 人</span>
          {people.map((pl) => (
            <span key={pl.id} className="person-chip">
              {pl.name}
              {!locked && p.onRemovePerson && !p.expenses.some((e) => e.payer === pl.id || (!isAll[e.id] && e.sharedBy.includes(pl.id))) && (
                <button type="button" aria-label={`移除 ${pl.name}`} disabled={busy} onClick={() => ask({ title: `移除 ${pl.name}`, detail: `${pl.name} 會由今日名單移除，「全部人」嘅開支唔再計佢。`, action: '移除', run: () => run(() => p.onRemovePerson!(pl), true) })}>×</button>
              )}
            </span>
          ))}
          {!locked && p.onAddPerson && <button type="button" className="person-chip add" onClick={() => { setError(''); setSheet('person'); }}>＋ 加人</button>}
        </div>
        {closed && (locked ? <p className="muted small">計好數，開支已鎖定，唔可以再加或者改。</p> : <p className="muted small">計好數：其他人已經唔可以再加或者改開支，只有局主仍然可以改。</p>)}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2>Group 一齊計</h2>
          {!locked && <button type="button" className="iconbtn add-btn" aria-label="今晚加 Group" onClick={() => { setError(''); setSheet('pair'); }}><PlusIcon /></button>}
        </div>
        {tonightDefaults.length > 0 || p.pairs.length > 0 ? (
          <ul className="list exp-list">
            {tonightDefaults.map(({ t, here, active }) => {
              const skipped = skipTeams.includes(t.id);
              return (
                <li key={t.id} className={`exp-row${skipped ? ' skipped' : ''}`}>
                  <span className="grow exp-text">
                    <span>{t.members.map(nameOf).join(' + ')}<span className="tag instant">預設</span></span>
                    <small className={active && here.length > 1 && !skipped ? 'gain' : 'muted'}>
                      {skipped
                        ? '今晚分開計'
                        : !active
                        ? `未生效：等待 ${t.members.filter((m) => !t.accepted.includes(m)).map(nameOf).join('、')} 同意`
                        : here.length > 1
                        ? (here.length < t.members.length ? `今晚 ${here.map(nameOf).join('、')} 一齊計（${t.members.filter((m) => !here.includes(m)).map(nameOf).join('、')} 冇嚟）` : '一齊計')
                        : `今晚只有 ${nameOf(here[0])}，分開計`}
                    </small>
                  </span>
                  {!skipped && !active && p.onAcceptTeam && (p.isAdmin || (p.me && t.members.includes(p.me) && !t.accepted.includes(p.me))) && (
                    <button type="button" className="btn small-btn" disabled={busy} onClick={() => run(() => p.onAcceptTeam!(t.id))}>{p.isAdmin && !(p.me && t.members.includes(p.me)) ? '直接生效' : '同意'}</button>
                  )}
                  {!locked && p.onSkipTeam && (skipped ? (
                    <button type="button" className="textbtn" disabled={busy} onClick={() => run(() => p.onSkipTeam!(t.id, false), true)}>恢復</button>
                  ) : here.length > 1 && (
                    <button type="button" className="iconbtn small" aria-label="今晚唔一齊計" disabled={busy} onClick={() => ask({ title: '今晚唔一齊計', detail: `${t.members.map(nameOf).join(' + ')} 今晚會分開計（之後可以撳「恢復」）。`, action: '分開計', run: () => run(() => p.onSkipTeam!(t.id, true), true) })}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  ))}
                </li>
              );
            })}
            {p.pairs.map((pr) => {
              const active = pairActive(pr);
              const waiting = [pr.a, pr.b].filter((id) => !isGuest(id) && !pr.accepted.includes(id));
              const clash = active && !activePairs.some((g) => g.includes(pr.a) && g.includes(pr.b));
              return (
                <li key={pr.id} className="exp-row">
                  <span className="grow exp-text">
                    <span>{nameOf(pr.a)} + {nameOf(pr.b)}</span>
                    <small className={active && !clash ? 'gain' : 'muted'}>{!active ? `等待 ${waiting.map(nameOf).join('、')} 同意` : clash ? '已在預設 Group，不重複計' : '今晚一齊計'}</small>
                  </span>
                  {!active && (p.isAdmin || (p.me && waiting.includes(p.me))) && <button type="button" className="btn small-btn" disabled={busy} onClick={() => run(() => p.onAcceptPair(pr.id))}>{p.isAdmin && !(p.me && waiting.includes(p.me)) ? '直接生效' : '同意'}</button>}
                  {!locked && (
                    <button type="button" className="iconbtn small" aria-label="取消此 Group" disabled={busy} onClick={() => ask({ title: '取消呢個 Group', detail: `${nameOf(pr.a)} + ${nameOf(pr.b)} 今晚會分開計。`, action: '取消 Group', run: () => run(() => p.onDeletePair(pr.id)) })}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Hint className="muted">幾個人一齊計數，只轉一次賬。</Hint>
        )}
        {p.teamsHref && <button type="button" className="textbtn" onClick={() => go(p.teamsHref!)}>設定預設 Group（每次自動一齊計）</button>}
      </section>

      {error && !sheet && <p className="error" role="alert">{error}</p>}

      {sheet === 'config' && <ConfigSheet cfg={cfg} canEdit={p.canEdit} accounts={p.accounts} busy={busy} error={error} onClose={() => setSheet(null)} onSave={(c) => run(() => p.onSaveConfig(c))} />}
      {(sheet === 'expense' || editing) && (
        <ExpenseSheet
          initial={editing ?? undefined}
          initialAll={editing ? !!isAll[editing.id] : true}
          roster={roster}
          playerIds={ids}
          others={others}
          me={p.me}
          busy={busy}
          error={error}
          onAddPerson={p.onAddPerson}
          onClose={() => setSheet(null)}
          onSave={(e) => run(() => (editing ? (p.onUpdateExpense ? p.onUpdateExpense(editing.id, e) : Promise.resolve()) : p.onAddExpense(e)))}
          onDelete={editing ? () => ask({ title: '刪除開支', detail: `「${editing.label} ${money(editing.amount)}」會被刪除，無得返轉頭。`, run: () => run(() => p.onDeleteExpense(editing.id)) }) : undefined}
        />
      )}
      {sheet === 'person' && p.onAddPerson && (
        <AddPersonSheet others={others} busy={busy} error={error} onClose={() => setSheet(null)} onAdd={(pl) => run(() => p.onAddPerson!(pl))} />
      )}
      {sheet === 'pair' && (
        <PairSheet
          players={roster.filter((pl) => !p.pairs.some((pr) => pr.a === pl.id || pr.b === pl.id) && !activePairs.some((g) => g.includes(pl.id)))}
          admin={!!p.isAdmin}
          busy={busy}
          error={error}
          onClose={() => setSheet(null)}
          onSave={(a, b) => run(() => p.onProposePair(a, b))}
        />
      )}
      {confirmUI}
      {r && who && (
        <Sheet onClose={() => setSheet(null)} label="明細">
          <PersonBreakdown
            k={who}
            r={r}
            nameOf={nameOf}
            perTable={p.perTable ?? []}
            fan={p.fan}
            water={p.water}
            expenses={p.expenses}
            shares={shares}
            Acct={Acct}
          />
          <button type="button" className="btn big" onClick={() => setSheet(null)}>完成</button>
        </Sheet>
      )}
    </main>
  );
}

/** 一個人（或者一個 Group）嘅明細：每張枱、水、每項開支 */
function PersonBreakdown({ k, r, nameOf, perTable, fan, water, expenses, shares, Acct }: {
  k: string; r: NonNullable<ReturnType<typeof buildSettle>['r']>; nameOf: (id: string) => string;
  perTable: { id: string; name: string; fan: Record<string, number> }[]; fan: Record<string, number>; water: number;
  expenses: ExpenseDoc[]; shares: Record<string, string[]>; Acct: (x: { k: string; cls: string }) => ReactElement;
}) {
  const ids = k.split(' + ');
  const multi = ids.length > 1;
  const who = (id: string) => (multi ? `${nameOf(id)} · ` : '');
  const tables = perTable.flatMap((t) => ids.filter((id) => id in t.fan).map((id) => ({ key: `${t.id}-${id}`, label: `${who(id)}${t.name}`, fan: t.fan[id] })));
  const keepsWater = ids.includes(r.water.to);
  const expLines: { key: string; label: string; note?: string; v: number }[] = [];
  for (const e of expenses) {
    for (const id of ids) {
      const sh = e.kind === 'transfer' ? e.sharedBy : shares[e.id] ?? e.sharedBy;
      const paid = e.payer === id ? e.amount : 0;
      const part = sh.includes(id) ? (e.kind === 'transfer' ? e.amount : e.amount / sh.length) : 0;
      if (!paid && !part) continue;
      const label = e.kind === 'transfer' ? `已轉賬 ${nameOf(e.payer)} → ${nameOf(e.sharedBy[0] ?? '')}` : e.label;
      const bits = [paid ? `俾咗 ${money(paid)}` : '', part ? `份 ${money(part)}` : ''].filter(Boolean).join('，');
      expLines.push({ key: `${e.id}-${id}`, label: `${who(id)}${label}`, note: [bits, e.note].filter(Boolean).join(' · '), v: paid - part });
    }
  }
  const game = r.gameLedger.accounts[k] ?? 0;
  const exp = r.expenseLedger.accounts[k] ?? 0;
  const total = r.combined.accounts[k] ?? 0;
  return (
    <div className="stack breakdown">
      <h2><Acct k={k} cls="" /></h2>
      <div className="bd-total"><small>合計</small><b className={`num ${tone(total)}`}>{money(total, true)}</b><span className="muted small">{total > 0.004 ? '要收' : total < -0.004 ? '要俾' : '唔使找'}</span></div>
      <h3>麻雀</h3>
      <ul className="bd-list">
        {tables.map((t) => <li key={t.key}><span className="grow">{t.label}</span><b className={`num ${tone(t.fan)}`}>{fanTxt(t.fan)} 番</b></li>)}
        {!tables.length && ids.some((id) => fan[id]) && ids.map((id) => <li key={id}><span className="grow">{nameOf(id)}</span><b className={`num ${tone(fan[id] ?? 0)}`}>{fanTxt(fan[id] ?? 0)} 番</b></li>)}
        {keepsWater && <li><span className="grow">水（{water} 番）</span><b className="num gain">{money(r.water.total, true)}</b></li>}
        <li className="bd-sum"><span className="grow">麻雀小計</span><b className={`num ${tone(game)}`}>{money(game, true)}</b></li>
      </ul>
      <h3>開支</h3>
      <ul className="bd-list">
        {expLines.map((l) => <li key={l.key}><span className="grow exp-text"><span>{l.label}</span>{l.note && <small className="muted">{l.note}</small>}</span><b className={`num ${tone(l.v)}`}>{money(l.v, true)}</b></li>)}
        {!expLines.length && <li className="muted">冇開支</li>}
        <li className="bd-sum"><span className="grow">開支小計</span><b className={`num ${tone(exp)}`}>{money(exp, true)}</b></li>
      </ul>
    </div>
  );
}

/** 揀人：我排第一；人多就有搜尋 */
function PeoplePick({ roster, me, value, onToggle, label }: {
  roster: Player[]; me: string | null; value: string[]; onToggle: (id: string) => void; label: string;
}) {
  const [q, setQ] = useState('');
  const shown = q.trim() ? roster.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase())) : roster;
  return (
    <div className="pp" role="group" aria-label={label}>
      {roster.length > 8 && <input className="input pp-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搵人名" aria-label={`${label}：搵人名`} />}
      <div className="pp-chips">
        {shown.map((pl) => (
          <button key={pl.id} type="button" className="pp-chip" aria-pressed={value.includes(pl.id)} onClick={() => onToggle(pl.id)}>
            <span className="ellipsis">{pl.name}</span>{pl.id === me && <small>你</small>}
          </button>
        ))}
        {!shown.length && <span className="muted small">搵唔到「{q}」</span>}
      </div>
    </div>
  );
}

function ExpenseSheet({ roster, playerIds, others, me, busy, error, onClose, onSave, initial, initialAll, onDelete, onAddPerson }: {
  roster: Player[]; playerIds: string[]; others: Player[]; me: string | null; busy: boolean; error: string; onClose: () => void;
  onSave: (e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>) => void;
  /** 修改：用返原本嘅開支 */
  initial?: ExpenseDoc;
  initialAll: boolean;
  onDelete?: () => void;
  onAddPerson?: (p: Player) => Promise<void>;
}) {
  void playerIds;
  const [kind, setKind] = useState<'expense' | 'transfer'>(initial?.kind ?? 'expense');
  const [label, setLabel] = useState(initial && initial.kind === 'expense' ? (LABELS.includes(initial.label) ? initial.label : '其他') : '晚餐');
  const [custom, setCustom] = useState(initial && initial.kind === 'expense' && !LABELS.includes(initial.label) ? initial.label : '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [payer, setPayer] = useState(initial?.payer ?? (me && roster.some((x) => x.id === me) ? me : ''));
  const [all, setAll] = useState(initial ? initialAll : true);
  const [shared, setShared] = useState<string[]>(initial && initial.kind === 'expense' ? initial.sharedBy : roster.map((x) => x.id));
  const [to, setTo] = useState(initial && initial.kind === 'transfer' ? initial.sharedBy[0] ?? '' : '');
  const [adding, setAdding] = useState(false);
  const [guest, setGuest] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const n = Number(amount);
  const finalLabel = label === '其他' ? custom.trim() || '其他' : label;
  const count = all ? roster.length : shared.length;
  const each = count ? n / count : 0;
  const ok = n > 0 && payer && (kind === 'transfer' ? to && to !== payer : count > 0);
  const toggleShared = (id: string) => setShared((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function add(pl: Player) {
    if (!onAddPerson) return;
    setAddBusy(true);
    try {
      await onAddPerson(pl);
      setShared((s) => (s.includes(pl.id) ? s : [...s, pl.id]));
      setGuest('');
    } finally { setAddBusy(false); }
  }

  return (
    <Sheet onClose={onClose} label={initial ? '修改開支' : '新增開支'}>
      <h2>{initial ? '修改開支' : '新增開支'}</h2>
      <div className="seg wide" role="group" aria-label="類別">
        <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>開支</button>
        <button type="button" aria-pressed={kind === 'transfer'} onClick={() => setKind('transfer')}>已轉賬</button>
      </div>

      {kind === 'expense' && (
        <div className="field">
          <span>項目</span>
          <div className="chips-row">
            {LABELS.map((l) => <button key={l} type="button" className="pill" aria-pressed={label === l} onClick={() => setLabel(l)}>{l}</button>)}
          </div>
          {label === '其他' && <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="項目名稱" maxLength={20} aria-label="項目名稱" />}
        </div>
      )}

      <div className="field">
        <span>金額</span>
        <div className="money-input">
          <span>$</span>
          <input className="input num big-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanMoney(e.target.value))} placeholder="0" aria-label="金額" />
        </div>
      </div>

      <label className="field">
        <span>備註</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 60))} placeholder="可留空，例如 XX 茶餐廳、AA 咗啤酒" aria-label="備註" />
      </label>

      <div className="field">
        <span>邊個俾</span>
        <PeoplePick roster={roster} me={me} value={payer ? [payer] : []} onToggle={(id) => setPayer(id)} label="邊個俾" />
      </div>

      {kind === 'transfer' ? (
        <div className="field">
          <span>俾咗邊個</span>
          <PeoplePick roster={roster.filter((pl) => pl.id !== payer)} me={me} value={to ? [to] : []} onToggle={(id) => setTo(id)} label="俾咗邊個" />
        </div>
      ) : (
        <div className="field">
          <div className="between">
            <span>邊個有份</span>
            <label className="switch-row small">
              <span>全部人（{roster.length}）</span>
              <button type="button" role="switch" className="switch" aria-checked={all} aria-label="全部人有份" onClick={() => { setAll((v) => !v); if (all) setShared(roster.map((x) => x.id)); }} />
            </label>
          </div>
          {all ? (
            <p className="muted small">今日全部人平分，之後加入嘅人都會自動有份。</p>
          ) : (
            <>
              <PeoplePick roster={roster} me={me} value={shared} onToggle={toggleShared} label="邊個有份" />
              <div className="between small">
                <span className="row tight-row">
                  <button type="button" className="textbtn" onClick={() => setShared(roster.map((x) => x.id))}>全選</button>
                  <button type="button" className="textbtn" onClick={() => setShared([])}>清除</button>
                </span>
                <span className="muted">已揀 {shared.length} 人</span>
              </div>
            </>
          )}
          {n > 0 && count > 0 && <span className="muted small">每人約 {money(each)}</span>}
        </div>
      )}

      {onAddPerson && (
        <div className="stack tight">
          {!adding ? (
            <button type="button" className="textbtn" onClick={() => setAdding(true)}>＋ 加今日有份嘅人（冇打牌）</button>
          ) : (
            <>
              <span className="small muted">加咗會成日都喺名單入面，唔使逐項開支再加。</span>
              {others.length > 0 && (
                <div className="chips-row">
                  {others.map((o) => <button key={o.id} type="button" className="pill" disabled={addBusy} onClick={() => add(o)}>＋ {o.name}</button>)}
                </div>
              )}
              <div className="row">
                <input className="input grow" value={guest} onChange={(e) => setGuest(clampName(e.target.value))} placeholder="訪客名，例如 阿明" aria-label="訪客名" />
                <button type="button" className="btn plain" disabled={!guest.trim() || addBusy} onClick={() => add({ id: guestId(), name: guest.trim() })}>加</button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <button
        type="button"
        className="btn big"
        disabled={busy || !ok}
        onClick={() => {
          const sharedBy = kind === 'transfer' ? [to] : all ? roster.map((x) => x.id) : shared;
          const used = new Set([payer, ...sharedBy]);
          const names = Object.fromEntries(roster.filter((x) => isGuest(x.id) && used.has(x.id)).map((x) => [x.id, x.name]));
          const extra = { ...(Object.keys(names).length ? { names } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
          onSave(kind === 'transfer'
            ? { kind, label: '已轉賬', payer, amount: n, sharedBy, ...extra }
            : { kind, label: finalLabel, payer, amount: n, sharedBy, all, ...extra });
        }}
      >
        {initial ? (ok ? `儲存 ${money(n)}` : '儲存') : ok ? `新增 ${money(n)}` : '新增'}
      </button>
      {initial && onDelete && <button type="button" className="textbtn loss center-text" disabled={busy} onClick={onDelete}>刪除此開支</button>}
    </Sheet>
  );
}

/** 今日人物：加成員或者訪客（冇打牌但有份開支） */
function AddPersonSheet({ others, busy, error, onClose, onAdd }: { others: Player[]; busy: boolean; error: string; onClose: () => void; onAdd: (p: Player) => void }) {
  const [guest, setGuest] = useState('');
  return (
    <Sheet onClose={onClose} label="加今日有份嘅人">
      <h2>加今日有份嘅人</h2>
      <Hint>冇打牌但有份食飯等開支。加咗之後，揀「全部人」嘅開支會自動計埋佢。</Hint>
      {others.length > 0 && (
        <div className="chips-row">
          {others.map((o) => <button key={o.id} type="button" className="pill" disabled={busy} onClick={() => onAdd(o)}>＋ {o.name}</button>)}
        </div>
      )}
      <div className="row">
        <input className="input grow" value={guest} onChange={(e) => setGuest(clampName(e.target.value))} placeholder="訪客名，例如 阿明" aria-label="訪客名" />
        <button type="button" className="btn" disabled={!guest.trim() || busy} onClick={() => onAdd({ id: guestId(), name: guest.trim() })}>加</button>
      </div>
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

function ConfigSheet({ cfg, canEdit, accounts, busy, error, onClose, onSave }: {
  cfg: SettleConfig; canEdit: boolean; accounts: Player[]; busy: boolean; error: string; onClose: () => void; onSave: (c: SettleConfig) => void;
}) {
  return (
    <Sheet onClose={onClose} label="埋數設定">
      <h2>埋數設定</h2>
      <SettleConfigForm cfg={cfg} canEdit={canEdit} accounts={accounts} busy={busy} error={error} onSave={onSave} />
    </Sheet>
  );
}

/** 埋數設定表格：埋數頁同家規頁共用 */
export function SettleConfigForm({ cfg, canEdit, accounts, busy, error, onSave }: {
  cfg: SettleConfig; canEdit: boolean; accounts: Player[]; busy: boolean; error: string; onSave: (c: SettleConfig) => void;
}) {
  const [per, setPer] = useState(cfg.perUnit);
  const [cur, setCur] = useState(cfg.currency);
  const waterTo = cfg.waterTo;
  void accounts;
  const [rounding, setRounding] = useState<MoneyRounding>(cfg.rounding);
  const n = per;
  const d = !canEdit;
  return (
    <div className="stack">
      {!canEdit && <p className="muted small">只有局主可修改。</p>}
      <div className="field">
        <span>匯率</span>
        <div className="rate-edit-row">
          <NumInput className="input num" big decimal value={per} min={0.01} max={10000} fallback={cfg.perUnit || 6} disabled={d} onChange={setPer} label="幾多番" />
          <span>番 = $1</span>
        </div>
      </div>
      <div className="field">
        <span>貨幣</span>
        <div className="seg" role="group" aria-label="貨幣">
          {CURRENCIES.map((c) => <button key={c} type="button" disabled={d} aria-pressed={cur === c} onClick={() => setCur(c)}>{c}</button>)}
          <input className="seg-input" value={CURRENCIES.includes(cur) ? '' : cur} disabled={d} placeholder="其他" maxLength={6} onChange={(e) => setCur(e.target.value.toUpperCase())} aria-label="其他貨幣" />
        </div>
      </div>
      <div className="field">
        <span>金額取整（差額計入水）</span>
        <div className="seg wide" role="group" aria-label="金額取整">
          {(['up', 'round', 'none'] as const).map((k) => (
            <button key={k} type="button" disabled={d} aria-pressed={rounding === k} onClick={() => setRounding(k)}>{k === 'up' ? '向上' : k === 'round' ? '四捨五入' : '不變'}</button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {canEdit && <button type="button" className="btn big" disabled={busy || !(n > 0) || !cur.trim()} onClick={() => onSave({ perUnit: n, currency: cur.trim(), waterTo, rounding })}>儲存埋數設定</button>}
    </div>
  );
}

function PairSheet({ players, admin, busy, error, onClose, onSave }: { players: Player[]; admin: boolean; busy: boolean; error: string; onClose: () => void; onSave: (a: string, b: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <Sheet onClose={onClose} label="今晚加 Group">
      <h2>今晚加 Group</h2>
      <Hint>{admin ? '超級管理員：揀兩個人，即刻生效，唔使等同意。' : '只計今晚。選兩位，有帳戶的人需要按「同意」才生效。想每次都一齊計，可以設定預設 Group。'}</Hint>
      <div className="choices">
        {players.map((pl) => {
          const on = picked.includes(pl.id);
          return (
            <button key={pl.id} type="button" className="choice" aria-pressed={on} onClick={() => setPicked((s) => (on ? s.filter((x) => x !== pl.id) : s.length < 2 ? [...s, pl.id] : s))}>
              <span className="ellipsis">{pl.name}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy || picked.length !== 2} onClick={() => onSave(picked[0], picked[1])}>新增</button>
    </Sheet>
  );
}

function CloseBar({ c, me, nameOf, busy, run }: {
  c: NonNullable<SettleScreenProps['closing']>; me: string | null; nameOf: (id: string) => string; busy: boolean; run: (t: () => Promise<void>) => Promise<void>;
}) {
  const [ask, setAsk] = useState(false);
  if (c.closed) {
    return (
      <div className="closed-stamp">
        <span className={`stamp${c.allPaid ? ' clear' : ''}`}>{c.allPaid ? '已找清' : '計好數'}</span>
        <span className="muted small">{nameOf(c.closed.by)} · {new Date(c.closed.at).toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    );
  }
  if (c.request) {
    const got = c.needed.filter((id) => c.request!.approvals.includes(id));
    const waiting = c.needed.filter((id) => !c.request!.approvals.includes(id));
    const mine = !!me && waiting.includes(me);
    return (
      <div className="banner calm close-req">
        <span className="grow">{nameOf(c.request.by)} 申請埋數：已同意 {got.length}/{c.needed.length}{waiting.length ? `，等 ${waiting.map(nameOf).join('、')}` : ''}</span>
        {mine && <button type="button" className="btn" disabled={busy} onClick={() => run(c.onApprove)}>同意</button>}
        {c.isHost && <button type="button" className="btn danger" disabled={busy} onClick={() => run(c.onClose)}>直接埋數</button>}
        {(c.isHost || me === c.request.by) && <button type="button" className="textbtn" disabled={busy} onClick={() => run(c.onCancel)}>取消</button>}
      </div>
    );
  }
  return (
    <>
      {c.isHost ? (
        <button type="button" className="btn big close-btn" disabled={busy} onClick={() => setAsk(true)}>埋數（完場並鎖定）</button>
      ) : (
        <p className="banner calm small">埋數要由場主（開大局嘅人）或者局主撳。</p>
      )}
      {ask && (
        <Sheet onClose={() => setAsk(false)} label="埋數">
          <h2>埋數</h2>
          <p className="muted">所有未完場嘅枱會即刻完場，拉住嘅數會找晒，之後唔可以再入數。</p>
          <button type="button" className="btn big danger" disabled={busy} onClick={() => run(async () => { await c.onClose(); setAsk(false); })}>確認埋數</button>
          <button type="button" className="btn plain" onClick={() => setAsk(false)}>取消</button>
        </Sheet>
      )}
    </>
  );
}
