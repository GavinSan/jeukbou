// 用計分引擎由事件計出一張枱嘅狀態同統計
import { applyEvent, createTable, pending, roundInfo } from '../engine/table.ts';
import type { StepResult, TableEvent, TableState } from '../engine/table.ts';
import { withRules } from '../engine/rules.ts';
import type { Rules } from '../engine/rules.ts';
import { activeEvents } from './data.ts';
import type { Group, Session, StoredEvent, TableDoc } from './data.ts';

export interface Step {
  seq: number;
  event: TableEvent;
  result: StepResult;
  at: number | null;
  edited: boolean;
  /** 呢鋪令每個人嘅數變幾多：settled = 實數（找咗），pending = 擺低未找 */
  delta: { settled: Record<string, number>; pending: Record<string, number> };
}

export interface TableStats {
  /** 打咗幾多鋪（食糊 + 流局） */
  hands: number;
  /** 最大一鋪：邊個、幾多番 */
  biggest: { player: string; fan: number } | null;
  selfDraws: number;
  wins: Record<string, number>;
  dealIns: Record<string, number>;
}

export interface Computed {
  state: TableState;
  steps: Step[];
  skipped: { seq: number; message: string }[];
  pending: Record<string, number>;
  info: ReturnType<typeof roundInfo>;
  stats: TableStats;
}

export const rulesOf = (group: Group | null, session?: Session | null): Rules => withRules(session?.rules ?? group?.rules ?? {});

export function computeTable(table: TableDoc, stored: StoredEvent[], rules: Rules): Computed | null {
  let state: TableState;
  try {
    state = createTable(table.seats);
  } catch {
    return null;
  }
  const steps: Step[] = [];
  const skipped: { seq: number; message: string }[] = [];
  for (const { seq, event, at, edited } of activeEvents(stored)) {
    try {
      const result = applyEvent(state, event, rules);
      steps.push({ seq, event, result, at, edited, delta: diff(state, result.state) });
      state = result.state;
    } catch (err) {
      skipped.push({ seq, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { state, steps, skipped, pending: pending(state), info: roundInfo(state), stats: statsOf(steps) };
}

function diff(a: TableState, b: TableState): Step['delta'] {
  const pa = pending(a);
  const pb = pending(b);
  const settled: Record<string, number> = {};
  const pend: Record<string, number> = {};
  for (const id of new Set([...Object.keys(a.settled), ...Object.keys(b.settled), ...Object.keys(pa), ...Object.keys(pb)])) {
    const ds = (b.settled[id] ?? 0) - (a.settled[id] ?? 0);
    const dp = (pb[id] ?? 0) - (pa[id] ?? 0);
    if (ds) settled[id] = ds;
    if (dp) pend[id] = dp;
  }
  return { settled, pending: pend };
}

/** 一鋪嘅淨變化（實數 + 擺低）；淨數全部係 0（例如找數）就用實數，除非 fallback = false */
export function netOf(d: Step['delta'], fallback = true): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(d.settled), ...Object.keys(d.pending)])) {
    const v = (d.settled[id] ?? 0) + (d.pending[id] ?? 0);
    if (v) out[id] = v;
  }
  return Object.keys(out).length || !fallback ? out : { ...d.settled };
}

function statsOf(steps: Step[]): TableStats {
  const s: TableStats = { hands: 0, biggest: null, selfDraws: 0, wins: {}, dealIns: {} };
  for (const { event } of steps) {
    if (event.type === 'draw') s.hands += 1;
    if (event.type !== 'win') continue;
    s.hands += 1;
    if (event.loser === null) s.selfDraws += 1;
    else s.dealIns[event.loser] = (s.dealIns[event.loser] ?? 0) + 1;
    for (const w of event.winners) {
      s.wins[w.player] = (s.wins[w.player] ?? 0) + 1;
      if (!s.biggest || w.fan > s.biggest.fan) s.biggest = { player: w.player, fan: w.fan };
    }
  }
  return s;
}

/** 人哋睇得明嘅一句：「Gavin 食 Ivan 19 番」 */
export function describe(event: TableEvent, name: (id: string) => string): string {
  switch (event.type) {
    case 'win': {
      const w = event.winners.map((x) => name(x.player)).join('、');
      const fans = event.winners.map((x) => `${x.fan}`).join(' / ');
      if (event.loser === null) return `${w} 自摸 ${fans} 番`;
      const tag = event.winners.length === 2 ? '雙響，' : event.winners.length === 3 ? '三響，' : '';
      return `${w} 食 ${name(event.loser)}（${tag}${fans} 番）`;
    }
    case 'special':
      return `${name(event.player)} ${event.label}，${event.direction === 'collect' ? '收' : '付'}每家 ${event.amount}`;
    case 'falseWin':
      return `${name(event.player)} 詐糊`;
    case 'draw':
      return '流局';
    case 'settle':
      return `${name(event.pulled)} 向 ${name(event.puller)} 找數`;
    case 'swap':
      return `${name(event.out)} 換 ${name(event.in)}`;
    case 'end':
      return '完場';
  }
}

export function ago(at: number | null, now: number): string {
  if (at === null) return '剛剛';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return '剛剛';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  return `${h} 小時前`;
}

/** 每鋪之後各人累計（找咗 + 枱面），第 0 個係開局 */
export function trendOf(c: Computed, ids: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const id of ids) out[id] = [0];
  for (const st of c.steps) {
    const pend = pending(st.result.state);
    for (const id of ids) out[id].push((st.result.state.settled[id] ?? 0) + (pend[id] ?? 0));
  }
  return out;
}
