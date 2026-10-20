// 埋數：成個大局（幾張枱）加埋、換貨幣、加開支、一 pair 一齊計、最少轉賬。

import type { PlayerId, TableState } from './table.ts';

export const WATER = '水';

export interface Expense {
  label: string;
  /** 邊個俾咗錢 */
  payer: string;
  amount: number;
  /** 邊幾個人分；[WATER] = 由水支付 */
  sharedBy: string[];
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** 幾張枱加埋：每人已找數同埋水（單位：番） */
export function sessionTotals(tables: TableState[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    for (const [p, v] of Object.entries(t.settled)) out[p] = (out[p] ?? 0) + v;
    out[WATER] = (out[WATER] ?? 0) + t.water;
  }
  return out;
}

const toCents = (x: number) => Math.round(x * 100);
const fromCents = (c: number) => c / 100;

/** 番 → 貨幣（perUnit = 幾多番 = 1 個貨幣單位，例如 CAD 6、HKD 1），計到仙，總數保持 0 */
export function toMoney(fan: Record<string, number>, perUnit: number): Record<string, number> {
  if (!(perUnit > 0)) throw new Error('換算要大過 0');
  const keys = Object.keys(fan);
  const cents: Record<string, number> = {};
  for (const k of keys) cents[k] = toCents(fan[k] / perUnit);
  balanceCents(cents);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = fromCents(cents[k]);
  return out;
}

/**
 * 開支：俾錢嗰個 +，有份分嘅人平分 −（貨幣單位）。
 * 先逐個人加埋精確數（唔逐項取整），最後每人先四捨五入到仙；差幾仙就由數最大嗰個吸收，總數保持 0。
 * 例如 $23.92 六個人分：每人 −3.99，唔會因為逐項計變成 −4.02。
 */
export function applyExpenses(balances: Record<string, number>, expenses: Expense[]): Record<string, number> {
  const exact: Record<string, number> = {};
  for (const [k, v] of Object.entries(balances)) exact[k] = toCents(v);
  for (const e of expenses) {
    if (e.sharedBy.length === 0) throw new Error(`「${e.label}」要揀邊個分`);
    const total = toCents(e.amount);
    const each = total / e.sharedBy.length;
    exact[e.payer] = (exact[e.payer] ?? 0) + total;
    for (const p of e.sharedBy) exact[p] = (exact[p] ?? 0) - each;
  }
  const cents: Record<string, number> = {};
  for (const [k, v] of Object.entries(exact)) cents[k] = Math.round(v + 1e-9);
  balanceCents(cents);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cents)) out[k] = fromCents(v);
  return out;
}

/** 一個 Group 一齊計：合埋做一個戶口，名叫「A + B + C」 */
export function mergePairs(balances: Record<string, number>, pairs: PlayerId[][]): Record<string, number> {
  const owner: Record<string, string> = {};
  for (const grp of pairs) {
    const clash = grp.find((x) => owner[x]);
    if (clash) throw new Error(`${clash} 已經喺第二個 Group`);
    const name = grp.join(' + ');
    for (const x of grp) owner[x] = name;
  }
  const cents: Record<string, number> = {};
  for (const [k, v] of Object.entries(balances)) {
    const key = owner[k] ?? k;
    cents[key] = (cents[key] ?? 0) + toCents(v);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cents)) out[k] = fromCents(v);
  return out;
}

/**
 * 今晚實際生效嘅 Group：
 * 預設 Group（牌友圈層面）同今晚臨時加嘅合埋；只計今晚有份嘅人（present），
 * 得返一個人就唔使合；同一個人唔會入兩個 Group（先到先得，預設優先）。
 */
export function effectiveGroups(defaults: PlayerId[][], extra: PlayerId[][], present: PlayerId[]): PlayerId[][] {
  const here = new Set(present);
  const used = new Set<PlayerId>();
  const out: PlayerId[][] = [];
  for (const grp of [...defaults, ...extra]) {
    const members = [...new Set(grp)].filter((x) => here.has(x) && !used.has(x));
    if (members.length < 2) continue;
    members.forEach((x) => used.add(x));
    out.push(members);
  }
  return out;
}

/** 最少轉賬：最大嘅欠款人俾最大嘅收款人，直到清晒 */
export function minimalTransfers(balances: Record<string, number>): Transfer[] {
  const cents: Record<string, number> = {};
  for (const [k, v] of Object.entries(balances)) cents[k] = toCents(v);
  balanceCents(cents);
  const debtors = Object.entries(cents).filter(([, v]) => v < 0).map(([k, v]) => ({ k, v: -v }));
  const creditors = Object.entries(cents).filter(([, v]) => v > 0).map(([k, v]) => ({ k, v }));
  const out: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
    creditors.sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
    const d = debtors[0];
    const c = creditors[0];
    const amt = Math.min(d.v, c.v);
    out.push({ from: d.k, to: c.k, amount: fromCents(amt) });
    d.v -= amt;
    c.v -= amt;
    if (d.v === 0) debtors.shift();
    if (c.v === 0) creditors.shift();
  }
  return out;
}

/** 四捨五入之後總數唔係 0，就將差額放落絕對值最大嗰個 */
function balanceCents(cents: Record<string, number>) {
  const keys = Object.keys(cents);
  if (!keys.length) return;
  const diff = keys.reduce((a, k) => a + cents[k], 0);
  if (diff === 0) return;
  const biggest = keys.reduce((a, k) => (Math.abs(cents[k]) > Math.abs(cents[a]) ? k : a), keys[0]);
  cents[biggest] -= diff;
}

export interface SettleInput {
  /** 每人番數（已找 + 枱面，已扣水） */
  fan: Record<PlayerId, number>;
  /** 抽咗幾多番水 */
  water: number;
  /** 水歸邊個戶口（場主揀）；可以唔係今晚玩家 */
  waterTo: PlayerId;
  /** 幾多番 = 1 個貨幣單位 */
  perUnit: number;
  /** 每人金額點取整：up = 向上（絕對值）、round = 四捨五入、none = 計到仙；差額由水戶口吸收 */
  rounding: MoneyRounding;
  /** 開支（晚餐等），同麻雀數分開計 */
  expenses: Expense[];
  players: PlayerId[];
  /** 一齊計數嘅 Group（每組兩人或以上） */
  pairs: PlayerId[][];
}

export type MoneyRounding = 'up' | 'round' | 'none';

export interface Ledger {
  /** 每個戶口（已合 pair） */
  accounts: Record<string, number>;
  transfers: Transfer[];
}

export interface SettleResult {
  /** 麻雀輸贏（貨幣）；自己一個嘅已取整，Group 成員係未取整嘅份數 */
  game: Record<PlayerId, number>;
  /** 每個戶口嘅麻雀輸贏（已取整，未加水）；Group 嘅 key 係「A + B」 */
  gameAccounts: Record<string, number>;
  /** 水：原本幾多、取整差額、最後歸水戶口幾多 */
  water: { raw: number; rounding: number; total: number; to: PlayerId };
  /** 開支淨額：付了 +，要分 − */
  expense: Record<PlayerId, number>;
  /** 麻雀 + 水 */
  gameLedger: Ledger;
  /** 晚餐等開支 */
  expenseLedger: Ledger;
  /** 兩樣合埋一次過轉 */
  combined: Ledger;
}

const ceilAbs = (cents: number) => Math.sign(cents) * Math.ceil(Math.abs(cents) / 100 - 1e-9) * 100;
const roundAbs = (cents: number) => Math.sign(cents) * Math.round(Math.abs(cents) / 100) * 100;

function ledger(balances: Record<string, number>, pairs: PlayerId[][]): Ledger {
  const accounts = mergePairs(balances, pairs);
  return { accounts, transfers: minimalTransfers(accounts) };
}

/** 埋數：麻雀數（連水）同開支分開計，亦可以合埋。Group 先合埋番數再取整（當一個戶口計）。 */
export function settleSession(input: SettleInput): SettleResult {
  const { players } = input;
  const fanAll: Record<string, number> = {};
  for (const p of players) fanAll[p] = input.fan[p] ?? 0;
  fanAll[WATER] = input.water;
  const money = toMoney(fanAll, input.perUnit);

  // 每個人屬於邊個戶口（Group 合埋做一個）
  const owner: Record<string, string> = {};
  const firstOf: Record<string, string> = {};
  for (const grp of input.pairs) {
    const key = grp.join(' + ');
    for (const x of grp) owner[x] = key;
    firstOf[key] = grp.find((x) => players.includes(x)) ?? grp[0];
  }
  const acct = (p: string) => owner[p] ?? p;
  const roundC = (c: number) => (input.rounding === 'up' ? ceilAbs(c) : input.rounding === 'round' ? roundAbs(c) : c);

  /** 按戶口取整：Group 成員先保留原數，取整差額放喺 Group 第一個人度，合埋就啱 */
  function roundByAccount(raw: Record<string, number>): Record<string, number> {
    const sum: Record<string, number> = {};
    for (const [p, c] of Object.entries(raw)) sum[acct(p)] = (sum[acct(p)] ?? 0) + c;
    const out: Record<string, number> = {};
    for (const [p, c] of Object.entries(raw)) out[p] = owner[p] ? c : roundC(c);
    for (const key of Object.keys(firstOf)) {
      if (sum[key] === undefined) continue;
      const first = firstOf[key];
      out[first] = (out[first] ?? 0) + roundC(sum[key]) - sum[key];
    }
    return out;
  }

  // 每個戶口取整；水戶口吸收差額，令總數保持 0
  const rawGame: Record<string, number> = {};
  for (const p of players) rawGame[p] = toCents(money[p] ?? 0);
  const gameCents = roundByAccount(rawGame);
  const rawWater = toCents(money[WATER] ?? 0);
  const waterTotal = 0 - Object.values(gameCents).reduce((a, b) => a + b, 0) || 0;

  const game: Record<string, number> = {};
  for (const p of players) game[p] = fromCents(owner[p] ? rawGame[p] : gameCents[p]);

  const gameBal: Record<string, number> = {};
  for (const p of players) gameBal[p] = fromCents(gameCents[p]);
  gameBal[input.waterTo] = fromCents(toCents(gameBal[input.waterTo] ?? 0) + waterTotal);

  const zero: Record<string, number> = {};
  for (const p of players) zero[p] = 0;
  const rawExpense = applyExpenses(zero, input.expenses);
  // 開支都跟同一個取整（Group 一樣先合埋）；差額同樣計入保管水嗰個
  const expense: Record<string, number> = {};
  const expenseBal: Record<string, number> = {};
  if (input.rounding === 'none' || !input.expenses.length) {
    Object.assign(expense, rawExpense);
    Object.assign(expenseBal, rawExpense);
  } else {
    const rawC: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawExpense)) rawC[k] = toCents(v);
    const rounded = roundByAccount(rawC);
    const resid = Object.values(rounded).reduce((a, b) => a + b, 0);
    if (resid) rounded[input.waterTo] = (rounded[input.waterTo] ?? 0) - resid;
    for (const [k, c] of Object.entries(rounded)) expenseBal[k] = fromCents(c);
    for (const k of Object.keys(rounded)) expense[k] = owner[k] && k !== input.waterTo ? fromCents(rawC[k] ?? 0) : fromCents(rounded[k]);
  }

  const both: Record<string, number> = {};
  for (const [k, v] of Object.entries(gameBal)) both[k] = toCents(v);
  for (const [k, v] of Object.entries(expenseBal)) both[k] = (both[k] ?? 0) + toCents(v);
  const combined: Record<string, number> = {};
  for (const [k, v] of Object.entries(both)) combined[k] = fromCents(v);

  const gameAccounts: Record<string, number> = {};
  for (const p of players) gameAccounts[acct(p)] = fromCents(toCents(gameAccounts[acct(p)] ?? 0) + gameCents[p]);

  return {
    game,
    gameAccounts,
    water: { raw: fromCents(rawWater), rounding: fromCents(waterTotal - rawWater), total: fromCents(waterTotal), to: input.waterTo },
    expense,
    gameLedger: ledger(gameBal, input.pairs),
    expenseLedger: ledger(expenseBal, input.pairs),
    combined: ledger(combined, input.pairs),
  };
}
