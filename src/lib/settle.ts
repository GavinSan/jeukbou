// 埋數計法（純函數）：埋數頁、轉賬頁、找數頁都用同一套，確保數一樣
import { WATER, effectiveGroups, settleSession } from '../engine/settlement.ts';
import type { Expense, SettleResult } from '../engine/settlement.ts';
import { pairActive, teamActive } from './data.ts';
import type { ExpenseDoc, PairDoc, Payout, SettleConfig, TeamDoc } from './data.ts';

export interface Person {
  id: string;
  name: string;
}

export interface SettleInputs {
  /** 打過牌嘅人 */
  players: Person[];
  /** 今日有份但冇打牌嘅人 */
  people: Person[];
  fan: Record<string, number>;
  water: number;
  cfg: SettleConfig;
  expenses: ExpenseDoc[];
  pairs: PairDoc[];
  teams: TeamDoc[];
}

export interface SettleBuilt {
  r: SettleResult | null;
  error: string;
  activePairs: string[][];
  /** 今日全部有份嘅人：玩家 + 今日人物 + 開支入面出現過嘅人 */
  attendees: string[];
  /** 每項開支實際邊個有份 */
  shares: Record<string, string[]>;
  /** 每項開支係咪「全部人」 */
  isAll: Record<string, boolean>;
}

/** 「全部人」：新紀錄有 all；舊紀錄揀晒全部玩家就當係全部人（之後加入嘅人都計埋） */
export function isAllShare(e: ExpenseDoc, playerIds: string[]): boolean {
  if (e.kind === 'transfer') return false;
  if (typeof e.all === 'boolean') return e.all;
  return playerIds.length > 0 && playerIds.every((id) => e.sharedBy.includes(id));
}

export function attendeesOf(players: Person[], people: Person[], expenses: ExpenseDoc[]): string[] {
  const out: string[] = [];
  const add = (id: string) => { if (id && id !== WATER && !out.includes(id)) out.push(id); };
  players.forEach((p) => add(p.id));
  people.forEach((p) => add(p.id));
  for (const e of expenses) { add(e.payer); e.sharedBy.forEach(add); }
  return out;
}

export function sharesOf(e: ExpenseDoc, playerIds: string[], attendees: string[]): string[] {
  if (e.kind === 'transfer') return e.sharedBy;
  if (!isAllShare(e, playerIds)) return e.sharedBy;
  return [...new Set([...attendees, ...e.sharedBy])];
}

export function buildSettle(x: SettleInputs): SettleBuilt {
  const ids = x.players.map((p) => p.id);
  const attendees = attendeesOf(x.players, x.people, x.expenses);
  const shares: Record<string, string[]> = {};
  const isAll: Record<string, boolean> = {};
  for (const e of x.expenses) {
    shares[e.id] = sharesOf(e, ids, attendees);
    isAll[e.id] = isAllShare(e, ids);
  }
  const defaults = x.teams.filter(teamActive).map((t) => t.members);
  const activePairs = effectiveGroups(defaults, x.pairs.filter(pairActive).map((p) => [p.a, p.b]), [...attendees, x.cfg.waterTo]);
  const expenses: Expense[] = x.expenses.map((e) => ({ label: e.label, payer: e.payer, amount: e.amount, sharedBy: shares[e.id] }));
  try {
    const r = settleSession({
      fan: x.fan, water: x.water, waterTo: x.cfg.waterTo, perUnit: x.cfg.perUnit, rounding: x.cfg.rounding,
      expenses, players: ids, pairs: activePairs,
    });
    return { r, error: '', activePairs, attendees, shares, isAll };
  } catch (err) {
    return { r: null, error: err instanceof Error ? err.message : String(err), activePairs, attendees, shares, isAll };
  }
}

/** 埋數快照：合併（麻雀＋水＋開支）嘅轉賬，連埋名 */
export function payoutOf(r: SettleResult, currency: string, nameOf: (id: string) => string): Payout {
  const ids = new Set<string>();
  for (const t of r.combined.transfers) for (const k of [t.from, t.to]) k.split(' + ').forEach((id) => ids.add(id));
  return { at: Date.now(), currency, transfers: r.combined.transfers, names: Object.fromEntries([...ids].map((id) => [id, nameOf(id)])) };
}

/** 兩個快照嘅轉賬係咪一樣（唔理時間） */
export function samePayout(a: Payout | null | undefined, b: Payout | null | undefined): boolean {
  if (!a || !b) return false;
  const key = (p: Payout) => JSON.stringify(p.transfers.map((t) => [t.from, t.to, Math.round(t.amount * 100)]));
  return key(a) === key(b) && a.currency === b.currency;
}
