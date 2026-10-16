// 用計分引擎由事件計出一張枱嘅狀態
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
}

export interface Computed {
  state: TableState;
  steps: Step[];
  skipped: { seq: number; message: string }[];
  pending: Record<string, number>;
  info: ReturnType<typeof roundInfo>;
  error: string | null;
}

export const rulesOf = (group: Group | null): Rules => withRules(group?.rules ?? {});

export function computeTable(table: TableDoc, stored: StoredEvent[], rules: Rules): Computed | null {
  let state: TableState;
  try {
    state = createTable(table.seats);
  } catch (err) {
    return null;
  }
  const steps: Step[] = [];
  const skipped: { seq: number; message: string }[] = [];
  for (const { seq, event } of activeEvents(stored)) {
    try {
      const result = applyEvent(state, event, rules);
      steps.push({ seq, event, result });
      state = result.state;
    } catch (err) {
      skipped.push({ seq, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { state, steps, skipped, pending: pending(state), info: roundInfo(state), error: null };
}

export function describe(event: TableEvent, name: (id: string) => string): string {
  switch (event.type) {
    case 'win': {
      const w = event.winners.map((x) => name(x.player)).join('、');
      const fans = event.winners.map((x) => `${x.fan} 番`).join(' / ');
      if (event.loser === null) return `${w} 自摸 · ${fans}`;
      const tag = event.winners.length === 2 ? '（雙響）' : event.winners.length === 3 ? '（三響）' : '';
      return `${w} 食 ${name(event.loser)}${tag} · ${fans}`;
    }
    case 'special':
      return `${name(event.player)} ${event.label} · ${event.direction === 'collect' ? '收' : '俾'}每家 ${event.amount}`;
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
