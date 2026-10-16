import { useMemo } from 'react';
import SessionScreen from '../components/SessionScreen.tsx';
import { useGroup, useManyEvents, useSession, useTables } from '../lib/live.ts';
import { computeTable, rulesOf } from '../lib/score.ts';
import type { Computed } from '../lib/score.ts';
import { Loading, TopBar } from '../ui.tsx';

export default function SessionPage({ groupId, sessionId }: { groupId: string; sessionId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const tables = useTables(groupId, sessionId);
  const events = useManyEvents(groupId, sessionId, tables.data.map((t) => t.id));
  const rules = useMemo(() => rulesOf(group.data), [group.data]);

  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables.data) out[t.id] = computeTable(t, events[t.id] ?? [], rules);
    return out;
  }, [tables.data, events, rules]);

  const back = `/g/${groupId}`;
  if (session.error || group.error) return <main className="page"><TopBar back={back} /><p className="error">{session.error ?? group.error}</p></main>;
  if (!session.data || !group.data) return <main className="page"><TopBar back={back} /><Loading /></main>;

  return (
    <SessionScreen
      title={session.data.name}
      back={back}
      tables={tables.data}
      computed={computed}
      tableHref={(t) => `/g/${groupId}/s/${sessionId}/t/${t}`}
      invite={`${window.location.origin}/join/${groupId}/${group.data.inviteCode}/s/${sessionId}`}
    />
  );
}
