import { useMemo } from 'react';
import type { User } from 'firebase/auth';
import TableScreen from '../components/TableScreen.tsx';
import { appendEvent } from '../lib/data.ts';
import { useEvents, useGroup, useSession, useTable } from '../lib/live.ts';
import { computeTable, rulesOf } from '../lib/score.ts';
import { Loading, TopBar } from '../ui.tsx';

export default function TablePage({ user, groupId, sessionId, tableId }: { user: User; groupId: string; sessionId: string; tableId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const table = useTable(groupId, sessionId, tableId);
  const events = useEvents(groupId, sessionId, tableId);
  const rules = useMemo(() => rulesOf(group.data), [group.data]);
  const computed = useMemo(() => (table.data ? computeTable(table.data, events.data, rules) : null), [table.data, events.data, rules]);

  const back = `/g/${groupId}/s/${sessionId}`;
  if (table.error || group.error) return <main className="page"><TopBar back={back} /><p className="error">{table.error ?? group.error}</p></main>;
  if (!table.data || !computed || events.loading) return <main className="page"><TopBar back={back} /><Loading /></main>;

  return (
    <TableScreen
      table={table.data}
      computed={computed}
      rules={rules}
      me={user.uid}
      back={back}
      subtitle={session.data?.name}
      onPush={(event) => appendEvent(groupId, sessionId, tableId, events.data.length + 1, user.uid, event)}
    />
  );
}
