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

/** 開支：俾錢嗰個 +，有份分嘅人平分 −（貨幣單位，計到仙） */
export function applyExpenses(balances: Record<string, number>, expenses: Expense[]): Record<string, number> {
  const cents: Record<string, number> = {};
  for (const [k, v] of Object.entries(balances)) cents[k] = toCents(v);
  for (const e of expenses) {
    if (e.sharedBy.length === 0) throw new Error(`「${e.label}」要揀邊個分`);
    const total = toCents(e.amount);
    const each = Math.floor(total / e.sharedBy.length);
    let rest = total - each * e.sharedBy.length;
    cents[e.payer] = (cents[e.payer] ?? 0) + total;
    for (const p of e.sharedBy) {
      const share = each + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
      cents[p] = (cents[p] ?? 0) - share;
    }
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cents)) out[k] = fromCents(v);
  return out;
}

/** 一 pair 一齊計：合埋做一個戶口，名叫「A + B」 */
export function mergePairs(balances: Record<string, number>, pairs: [PlayerId, PlayerId][]): Record<string, number> {
  const owner: Record<string, string> = {};
  for (const [a, b] of pairs) {
    if (owner[a] || owner[b]) throw new Error(`${owner[a] ? a : b} 已經喺第二個 pair`);
    const name = `${a} + ${b}`;
    owner[a] = name;
    owner[b] = name;
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
  /** 每人金額向上取整（輸家多付、贏家多收），差額由水戶口吸收 */
  roundUp: boolean;
  /** 開支（晚餐等），同麻雀數分開計 */
  expenses: Expense[];
  players: PlayerId[];
  pairs: [PlayerId, PlayerId][];
}

export interface Ledger {
  /** 每個戶口（已合 pair） */
  accounts: Record<string, number>;
  transfers: Transfer[];
}

export interface SettleResult {
  /** 麻雀輸贏（貨幣，已取整） */
  game: Record<PlayerId, number>;
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

function ledger(balances: Record<string, number>, pairs: [PlayerId, PlayerId][]): Ledger {
  const accounts = mergePairs(balances, pairs);
  return { accounts, transfers: minimalTransfers(accounts) };
}

/** 埋數：麻雀數（連水）同開支分開計，亦可以合埋 */
export function settleSession(input: SettleInput): SettleResult {
  const { players } = input;
  const fanAll: Record<string, number> = {};
  for (const p of players) fanAll[p] = input.fan[p] ?? 0;
  fanAll[WATER] = input.water;
  const money = toMoney(fanAll, input.perUnit);

  // 每人取整；水戶口吸收差額，令總數保持 0
  const gameCents: Record<string, number> = {};
  for (const p of players) {
    const c = toCents(money[p] ?? 0);
    gameCents[p] = input.roundUp ? ceilAbs(c) : c;
  }
  const rawWater = toCents(money[WATER] ?? 0);
  const waterTotal = -Object.values(gameCents).reduce((a, b) => a + b, 0);

  const game: Record<string, number> = {};
  for (const p of players) game[p] = fromCents(gameCents[p]);

  const gameBal: Record<string, number> = { ...game };
  gameBal[input.waterTo] = fromCents(toCents(gameBal[input.waterTo] ?? 0) + waterTotal);

  const zero: Record<string, number> = {};
  for (const p of players) zero[p] = 0;
  const expense = applyExpenses(zero, input.expenses);

  const both: Record<string, number> = {};
  for (const [k, v] of Object.entries(gameBal)) both[k] = toCents(v);
  for (const [k, v] of Object.entries(expense)) both[k] = (both[k] ?? 0) + toCents(v);
  const combined: Record<string, number> = {};
  for (const [k, v] of Object.entries(both)) combined[k] = fromCents(v);

  return {
    game,
    water: { raw: fromCents(rawWater), rounding: fromCents(waterTotal - rawWater), total: fromCents(waterTotal), to: input.waterTo },
    expense,
    gameLedger: ledger(gameBal, input.pairs),
    expenseLedger: ledger(expense, input.pairs),
    combined: ledger(combined, input.pairs),
  };
}
