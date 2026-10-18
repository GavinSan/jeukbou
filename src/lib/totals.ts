// 大局合計：每人番數（已找 + 枱面）、總水、未完場枱數、玩家名單
import type { TableDoc } from './data.ts';
import type { Computed } from './score.ts';

export function sessionSummary(tables: TableDoc[], computed: Record<string, Computed | null>) {
  const fan: Record<string, number> = {};
  const names: Record<string, string> = {};
  const order: string[] = [];
  let water = 0;
  let unfinished = 0;
  for (const t of tables) {
    const c = computed[t.id];
    if (!c) continue;
    water += c.state.water;
    if (!c.state.ended) unfinished += 1;
    for (const id of Object.keys(c.state.settled)) {
      if (!order.includes(id)) order.push(id);
      names[id] = t.names[id] ?? names[id] ?? '玩家';
      fan[id] = (fan[id] ?? 0) + (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0);
    }
  }
  return { fan, water, unfinished, players: order.map((id) => ({ id, name: names[id] })) };
}
