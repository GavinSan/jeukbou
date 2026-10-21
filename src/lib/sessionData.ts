// 一個大局嘅即時數：枱、每鋪、每張枱計好嘅狀態（主頁 Live、電視直播用）
import { useMemo } from 'react';
import type { Group, Session, TableDoc } from './data.ts';
import { useManyEvents, useTables } from './live.ts';
import { computeTable, rulesTimeline } from './score.ts';
import type { Computed } from './score.ts';

export interface SessionLive {
  tables: TableDoc[];
  computed: Record<string, Computed | null>;
  loading: boolean;
}

export function useSessionLive(g: string, s: string, group: Group | null, session: Session | null): SessionLive {
  const tables = useTables(g, s);
  const events = useManyEvents(g, s, tables.data.map((t) => t.id));
  const timeline = useMemo(() => rulesTimeline(group, session), [group, session]);
  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables.data) out[t.id] = computeTable(t, events[t.id] ?? [], timeline);
    return out;
  }, [tables.data, events, timeline]);
  return { tables: tables.data, computed, loading: tables.loading };
}

/** 最後一鋪幾時（冇就開局時間） */
export function lastActivity(c: Computed | null): number {
  if (!c) return 0;
  return Math.max(0, ...c.steps.map((st) => st.at ?? 0));
}

const WINDS = ['東', '南', '西', '北'];
export const roundLabel = (c: Computed) => (c.state.ended ? '已完場' : `${c.info.roundWind}圈${WINDS[c.state.dealerTurns % 4]}位 第 ${c.info.hand} 鋪`);
