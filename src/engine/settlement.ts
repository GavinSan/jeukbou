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

/** 水剩落嚟（或者唔夠）點處理：平分俾所有玩家，或者全部歸一個人 */
export type WaterTo = 'split' | PlayerId;

export interface SettleInput {
  /** 每人番數（已找 + 枱面） */
  fan: Record<PlayerId, number>;
  /** 抽咗幾多番水 */
  water: number;
  /** 幾多番 = 1 個貨幣單位 */
  perUnit: number;
  expenses: Expense[];
  waterTo: WaterTo;
  /** 有份嘅人（水平分用） */
  players: PlayerId[];
  pairs: [PlayerId, PlayerId][];
}

export interface SettleResult {
  /** 打牌輸贏（貨幣） */
  game: Record<PlayerId, number>;
  /** 開支淨額：俾咗錢 +，要分 − */
  expense: Record<PlayerId, number>;
  /** 分到（或者要補）嘅水 */
  waterShare: Record<PlayerId, number>;
  water: { collected: number; spent: number; left: number };
  /** 每人最後 */
  net: Record<PlayerId, number>;
  /** 合埋 pair 之後嘅戶口 */
  accounts: Record<string, number>;
  transfers: Transfer[];
}

/** 成個大局埋數：番 → 錢 → 加開支 → 處理水 → 合 pair → 最少轉賬 */
export function settleSession(input: SettleInput): SettleResult {
  const { players } = input;
  const fanAll: Record<string, number> = {};
  for (const p of players) fanAll[p] = input.fan[p] ?? 0;
  fanAll[WATER] = input.water;
  const money = toMoney(fanAll, input.perUnit);

  const afterExp = applyExpenses(money, input.expenses);
  const cents: Record<string, number> = {};
  for (const [k, v] of Object.entries(afterExp)) cents[k] = toCents(v);
  for (const p of players) cents[p] = cents[p] ?? 0;

  const collected = toCents(money[WATER] ?? 0);
  const left = cents[WATER] ?? 0;
  delete cents[WATER];

  const waterCents: Record<string, number> = {};
  for (const p of players) waterCents[p] = 0;
  if (left !== 0) {
    if (input.waterTo === 'split' || !players.includes(input.waterTo)) {
      const sign = Math.sign(left);
      const abs = Math.abs(left);
      const each = Math.floor(abs / players.length);
      let rest = abs - each * players.length;
      // 零頭由排頭嗰幾個人負責，順序固定
      for (const p of players) {
        const share = each + (rest > 0 ? 1 : 0);
        if (rest > 0) rest -= 1;
        waterCents[p] = sign * share;
      }
    } else {
      waterCents[input.waterTo] = left;
    }
  }

  const game: Record<string, number> = {};
  const expense: Record<string, number> = {};
  const waterShare: Record<string, number> = {};
  const net: Record<string, number> = {};
  for (const p of Object.keys(cents)) {
    const g = toCents(money[p] ?? 0);
    game[p] = fromCents(g);
    expense[p] = fromCents(cents[p] - g);
    waterShare[p] = fromCents(waterCents[p] ?? 0);
    net[p] = fromCents(cents[p] + (waterCents[p] ?? 0));
  }

  const accounts = mergePairs(net, input.pairs);
  return {
    game,
    expense,
    waterShare,
    water: { collected: fromCents(collected), spent: fromCents(collected - left), left: fromCents(left) },
    net,
    accounts,
    transfers: minimalTransfers(accounts),
  };
}
