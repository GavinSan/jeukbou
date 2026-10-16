// 用計分引擎由事件計出一張枱嘅狀態同統計
import { applyEvent, createTable, pending, roundInfo } from '../engine/table.ts';
import type { StepResult, TableEvent, TableState } from '../engine/table.ts';
import { withRules } from '../engine/rules.ts';
import type { Rules } from '../engine/rules.ts';
import { activeEvents } from './data.ts';
import type { Group, StoredEvent, TableDoc } from './data.ts';

export interface Step {
  seq: number;
  event: TableEvent;
  result: StepResult;
  at: number | null;
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

export const rulesOf = (group: Group | null): Rules => withRules(group?.rules ?? {});

export function computeTable(table: TableDoc, stored: StoredEvent[], rules: Rules): Computed | null {
  let state: TableState;
  try {
    state = createTable(table.seats);
  } catch {
    return null;
  }
  const steps: Step[] = [];
  const skipped: { seq: number; message: string }[] = [];
  for (const { seq, event, at } of activeEvents(stored)) {
    try {
      const result = applyEvent(state, event, rules);
      steps.push({ seq, event, result, at });
      state = result.state;
    } catch (err) {
      skipped.push({ seq, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { state, steps, skipped, pending: pending(state), info: roundInfo(state), stats: statsOf(steps) };
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
      return `${name(event.player)} ${event.label}，${event.direction === 'collect' ? '收' : '俾'}每家 ${event.amount}`;
    case 'falseWin':
      return `${name(event.player)} 詐糊`;
    case 'draw':
      return '流局';
    case 'settle':
      return `${name(event.pulled)} 找數俾 ${name(event.puller)}`;
    case 'swap':
      return `${name(event.out)} 換 ${name(event.in)}`;
    case 'end':
      return '完場';
  }
}

export function ago(at: number | null, now: number): string {
  if (at === null) return '啱啱';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return '啱啱';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  return `${h} 個鐘前`;
}
