// 龍虎榜：讀晒牌友圈每個大局，計每人總數（只讀一次，唔即時跟）
import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { fs } from './data.ts';
import type { Group, Session } from './data.ts';
import { toEvent, toTable } from './live.ts';
import { computeTable, rulesOf } from './score.ts';
import type { BoardRow } from '../components/Charts.tsx';

async function sessionTotals(g: Group, s: Session): Promise<{ totals: Record<string, number>; names: Record<string, string> }> {
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

export function useBoard(group: Group | null, sessions: Session[], memberNames: Record<string, string>): { rows: BoardRow[]; loading: boolean } {
  const key = group ? `${group.id}|${sessions.map((s) => s.id).join(',')}` : '';
  const [state, setState] = useState<{ rows: BoardRow[]; loading: boolean }>({ rows: [], loading: true });
  useEffect(() => {
    if (!group) return;
    let alive = true;
    (async () => {
      // 由舊到新
      const ordered = [...sessions].sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
      const results = await Promise.all(ordered.map((s) => sessionTotals(group, s).catch(() => ({ totals: {} as Record<string, number>, names: {} as Record<string, string> }))));
      const acc = new Map<string, BoardRow>();
      results.forEach(({ totals, names }: { totals: Record<string, number>; names: Record<string, string> }, idx) => {
        for (const [id, v] of Object.entries(totals)) {
          const row = acc.get(id) ?? { id, name: '', total: 0, sessions: 0, best: -Infinity, history: [] };
          row.name = memberNames[id] || names[id] || row.name || '玩家';
          row.total += v;
          row.sessions += 1;
          row.best = Math.max(row.best, v);
          row.history.push(row.total);
          acc.set(id, row);
        }
        void idx;
      });
      const rows = [...acc.values()].map((r) => ({ ...r, best: Number.isFinite(r.best) ? r.best : 0 })).sort((a, b) => b.total - a.total);
      if (alive) setState({ rows, loading: false });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
