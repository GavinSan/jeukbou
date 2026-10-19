import { useMemo } from 'react';
import type { User } from 'firebase/auth';
import TableScreen from '../components/TableScreen.tsx';
import Incoming from '../components/Incoming.tsx';
import { appendEvent, applySwap, cancelSwap, declineSettle, requestSwap, reseat, rollDice, fanTableOf, settleConfigOf, deleteTable } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { go } from '../lib/router.tsx';
import { useGroup, useManyEvents, useMembers, useRequests, useSession, useTables } from '../lib/live.ts';
import { computeTable, rulesOf, rulesTimeline } from '../lib/score.ts';
import type { Computed } from '../lib/score.ts';
import { Loading, TopBar } from '../ui.tsx';

export default function TablePage({ user, groupId, sessionId, tableId }: { user: User; groupId: string; sessionId: string; tableId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const tables = useTables(groupId, sessionId);
  const members = useMembers(groupId);
  const requests = useRequests(groupId, sessionId);
  const admin = useSuperAdmin(user.uid);
  const events = useManyEvents(groupId, sessionId, tables.data.map((t) => t.id));
  const rules = useMemo(() => rulesOf(group.data, session.data), [session.data, group.data]);
  const timeline = useMemo(() => rulesTimeline(group.data, session.data), [group.data, session.data]);

  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables.data) out[t.id] = computeTable(t, events[t.id] ?? [], timeline);
    return out;
  }, [tables.data, events, timeline]);

  const back = `/g/${groupId}/s/${sessionId}`;
  const table = tables.data.find((t) => t.id === tableId);
  const c = table ? computed[tableId] : null;

  if (tables.error || group.error) return <main className="page"><TopBar back={back} /><p className="error">{tables.error ?? group.error}</p></main>;
  if (!table || !c || events[tableId] === undefined) return <main className="page"><TopBar back={back} /><Loading /></main>;

  const tableEvents = events[tableId] ?? [];
  const seatedAnywhere = new Set<string>();
  for (const x of Object.values(computed)) if (x && !x.state.ended) x.state.seats.forEach((s) => seatedAnywhere.add(s));
  const candidates = members.data.filter((m) => !seatedAnywhere.has(m.uid)).map((m) => ({ id: m.uid, name: m.name }));

  return (
    <TableScreen
      table={table}
      computed={c}
      rules={rules}
      fanTable={fanTableOf(group.data)}
      onDeleteTable={group.data && (group.data.ownerId === user.uid || admin) ? async () => { await deleteTable(groupId, sessionId, tableId); go(back); } : undefined}
      onDecline={(key) => declineSettle(groupId, sessionId, tableId, key)}
      cash={(() => {
        const sc = settleConfigOf(group.data);
        return { perUnit: sc.perUnit, currency: sc.currency, rounding: sc.rounding };
      })()}
      me={user.uid}
      back={back}
      subtitle={session.data?.name}
      rulesHref={`/g/${groupId}/s/${sessionId}/rules`}
      candidates={candidates}
      pendingSwaps={requests.data}
      notice={<Incoming user={user} groupId={groupId} sessionId={sessionId} requests={requests.data} tables={tables.data} computed={computed} />}
      onPush={(event) => appendEvent(groupId, sessionId, tableId, tableEvents.length + 1, user.uid, event)}
      onSwap={async (out, incoming, guest) => {
        if (guest) {
          await applySwap(groupId, sessionId, tableId, user.uid, out, incoming.id, incoming.name);
          return 'done';
        }
        const dup = requests.data.some((r) => r.status === 'pending' && r.in === incoming.id);
        if (dup) throw new Error(`已邀請 ${incoming.name}，請等待回覆`);
        await requestSwap(groupId, sessionId, { tableId, out, in: incoming.id, inName: incoming.name, by: user.uid });
        return 'requested';
      }}
      onCancelSwap={(id) => cancelSwap(groupId, sessionId, id)}
      onReseat={async (seats) => {
        if (tableEvents.length > 0) throw new Error('已開局，不能再掉位');
        await reseat(groupId, sessionId, tableId, seats);
      }}
      onDice={async () => { await rollDice(groupId, sessionId, tableId, user.uid, (table.dice?.n ?? 0) + 1); }}
    />
  );
}

