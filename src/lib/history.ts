// 龍虎榜：讀晒牌友圈每個大局，計每人總數（只讀一次，唔即時跟）
import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { LEGACY, fs } from './data.ts';
import type { Group, Session } from './data.ts';
import { toEvent, toTable } from './live.ts';
import { computeTable, rulesOf } from './score.ts';
import type { BoardRow } from '../components/Charts.tsx';

async function sessionTotals(g: Group, s: Session, legacy: Record<string, string>): Promise<{ totals: Record<string, number>; names: Record<string, string> }> {
  // 匯入嘅舊紀錄：直接用總數；配對咗嘅就當係嗰個成員
  if (s.legacy) {
    const totals: Record<string, number> = {};
    const names: Record<string, string> = {};
    for (const [key, v] of Object.entries(s.legacy.totals)) {
      const id = legacy[key] ?? LEGACY + key;
      totals[id] = (totals[id] ?? 0) + Number(v);
      names[id] = g.legacyNames?.[key] ?? key;
    }
    return { totals, names };
  }
  const tablesSnap = await getDocs(query(collection(fs(), 'groups', g.id, 'sessions', s.id, 'tables'), orderBy('order')));
  const tables = tablesSnap.docs.map((d) => toTable(d.id, d.data()));
  const rules = rulesOf(g, s);
  const totals: Record<string, number> = {};
  const names: Record<string, string> = {};
  await Promise.all(
    tables.map(async (t) => {
      const evSnap = await getDocs(query(collection(fs(), 'groups', g.id, 'sessions', s.id, 'tables', t.id, 'events'), orderBy('seq')));
      const c = computeTable(t, evSnap.docs.map((d) => toEvent(d.id, d.data())), rules);
      if (!c) return;
      Object.assign(names, t.names);
      for (const id of Object.keys(c.state.settled)) totals[id] = (totals[id] ?? 0) + (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0);
    }),
  );
  return { totals, names };
}

/** 一個大局嘅結果（龍虎榜用） */
export interface SessionResult {
  id: string;
  name: string;
  at: number;
  totals: Record<string, number>;
}

export interface History {
  sessions: SessionResult[];
  names: Record<string, string>;
  loading: boolean;
}

/** 讀晒牌友圈每個大局（由舊到新）；唔即時跟 */
export function useHistory(group: Group | null, sessions: Session[], memberNames: Record<string, string>, legacy: Record<string, string> = {}): History {
  const key = group ? `${group.id}|${sessions.map((s) => s.id).join(',')}|${JSON.stringify(legacy)}` : '';
  const [state, setState] = useState<History>({ sessions: [], names: {}, loading: true });
  useEffect(() => {
    if (!group) return;
    let alive = true;
    (async () => {
      const ordered = [...sessions].sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
      const results = await Promise.all(ordered.map((s) => sessionTotals(group, s, legacy).catch(() => ({ totals: {} as Record<string, number>, names: {} as Record<string, string> }))));
      const names: Record<string, string> = {};
      const out: SessionResult[] = results.map((r, i) => {
        for (const [id, n] of Object.entries(r.names)) names[id] = names[id] || n;
        return { id: ordered[i].id, name: ordered[i].name, at: ordered[i].createdAt?.toMillis() ?? Date.now(), totals: r.totals };
      });
      for (const [id, n] of Object.entries(memberNames)) names[id] = n;
      if (alive) setState({ sessions: out, names, loading: false });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** 由一堆大局結果計龍虎榜 */
export function boardRows(sessions: SessionResult[], names: Record<string, string>): BoardRow[] {
  const acc = new Map<string, BoardRow>();
  for (const s of sessions) {
    for (const [id, v] of Object.entries(s.totals)) {
      const row = acc.get(id) ?? { id, name: names[id] || '玩家', total: 0, sessions: 0, best: -Infinity, history: [] };
      row.total += v;
      row.sessions += 1;
      row.best = Math.max(row.best, v);
      row.history.push(row.total);
      acc.set(id, row);
    }
  }
  return [...acc.values()].map((r) => ({ ...r, best: Number.isFinite(r.best) ? r.best : 0 })).sort((a, b) => b.total - a.total);
}

/** 舊接口：成個龍虎榜 */
export function useBoard(group: Group | null, sessions: Session[], memberNames: Record<string, string>, legacy: Record<string, string> = {}): { rows: BoardRow[]; loading: boolean } {
  const h = useHistory(group, sessions, memberNames, legacy);
  return { rows: boardRows(h.sessions, h.names), loading: h.loading };
}
