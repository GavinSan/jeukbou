import { useMemo } from 'react';
import type { User } from 'firebase/auth';
import SettleScreen from '../components/SettleScreen.tsx';
import { acceptPair, addExpense, deleteExpense, deletePair, proposePair, saveSettleConfig, settleConfigOf } from '../lib/data.ts';
import { useExpenses, useGroup, useManyEvents, useMembers, usePairs, useSession, useTables } from '../lib/live.ts';
import { computeTable, rulesOf } from '../lib/score.ts';
import type { Computed } from '../lib/score.ts';
import { sessionSummary } from '../lib/totals.ts';
import { Loading, TopBar } from '../ui.tsx';

export default function SettlePage({ user, groupId, sessionId }: { user: User; groupId: string; sessionId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const tables = useTables(groupId, sessionId);
  const events = useManyEvents(groupId, sessionId, tables.data.map((t) => t.id));
  const expenses = useExpenses(groupId, sessionId);
  const pairs = usePairs(groupId, sessionId);
  const members = useMembers(groupId);
  const rules = useMemo(() => rulesOf(group.data, session.data), [group.data, session.data]);
  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables.data) out[t.id] = computeTable(t, events[t.id] ?? [], rules);
    return out;
  }, [tables.data, events, rules]);
  const sum = useMemo(() => sessionSummary(tables.data, computed), [tables.data, computed]);

  const back = `/g/${groupId}/s/${sessionId}`;
  if (session.error || group.error) return <main className="page"><TopBar back={back} /><p className="error">{session.error ?? group.error}</p></main>;
  if (!session.data || !group.data) return <main className="page"><TopBar back={back} /><Loading /></main>;

  const accounts = [...members.data.map((m) => ({ id: m.uid, name: m.name }))];
  for (const pl of sum.players) if (!accounts.some((a) => a.id === pl.id)) accounts.push(pl);

  return (
    <SettleScreen
      title={session.data.name}
      back={back}
      players={sum.players}
      fan={sum.fan}
      water={sum.water}
      unfinished={sum.unfinished}
      config={settleConfigOf(group.data)}
      canEdit={group.data.ownerId === user.uid}
      accounts={accounts}
      expenses={expenses.data}
      pairs={pairs.data}
      me={user.uid}
      onSaveConfig={(c) => saveSettleConfig(groupId, c)}
      onAddExpense={(e) => addExpense(groupId, sessionId, { ...e, by: user.uid })}
      onDeleteExpense={(id) => deleteExpense(groupId, sessionId, id)}
      onProposePair={(a, b) => proposePair(groupId, sessionId, { a, b, by: user.uid, accepted: [a, b].filter((x) => x === user.uid) })}
      onAcceptPair={(id) => acceptPair(groupId, sessionId, id, user.uid)}
      onDeletePair={(id) => deletePair(groupId, sessionId, id)}
    />
  );
}
