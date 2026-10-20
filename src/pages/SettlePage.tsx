import { useMemo } from 'react';
import type { User } from 'firebase/auth';
import SettleScreen from '../components/SettleScreen.tsx';
import { acceptPair, acceptTeam, addExpense, updateExpense, approveClose, cancelClose, closeSession, deleteExpense, deletePair, isGuest, proposePair, requestClose, saveSettleConfig, setSessionWaterTo, settleConfigOf } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { useExpenses, useGroup, useManyEvents, useMembers, usePairs, useSession, useTables, useTeams } from '../lib/live.ts';
import { computeTable, rulesOf, rulesTimeline } from '../lib/score.ts';
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
  const teams = useTeams(groupId);
  const admin = useSuperAdmin(user.uid);
  const members = useMembers(groupId);
  const rules = useMemo(() => rulesOf(group.data, session.data), [group.data, session.data]);
  const timeline = useMemo(() => rulesTimeline(group.data, session.data), [group.data, session.data]);
  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables.data) out[t.id] = computeTable(t, events[t.id] ?? [], timeline);
    return out;
  }, [tables.data, events, timeline]);
  const sum = useMemo(() => sessionSummary(tables.data, computed), [tables.data, computed]);

  const back = `/g/${groupId}/s/${sessionId}`;
  if (session.error || group.error) return <main className="page"><TopBar back={back} /><p className="error">{session.error ?? group.error}</p></main>;
  if (!session.data || !group.data) return <main className="page"><TopBar back={back} /><Loading /></main>;

  const accounts = [...members.data.map((m) => ({ id: m.uid, name: m.name }))];
  for (const pl of sum.players) if (!accounts.some((a) => a.id === pl.id)) accounts.push(pl);

  const sess = session.data;
  const hostId = sess.createdBy;
  const isOwner = group.data.ownerId === user.uid || admin;
  // 埋數：只有開大局嘅人（場主）同局主撳得
  const isHost = hostId === user.uid || isOwner;
  const waterTo = sess.waterTo || hostId;
  // 水只可以畀局入面嘅人（加埋場主）保管
  const waterOptions = [...sum.players];
  if (!waterOptions.some((x) => x.id === hostId)) waterOptions.unshift({ id: hostId, name: `${members.data.find((m) => m.uid === hostId)?.name ?? '場主'}（場主）` });
  const needed = sum.players.map((x) => x.id).filter((id) => !isGuest(id));
  const openTables = tables.data.filter((t) => computed[t.id] && !computed[t.id]!.state.ended).map((t) => t.id);

  return (
    <SettleScreen
      title={session.data.name}
      back={back}
      players={sum.players}
      fan={sum.fan}
      water={sum.water}
      unfinished={sum.unfinished}
      config={{ ...settleConfigOf(group.data), waterTo }}
      canSetWater={isOwner && !sess.closed}
      waterOptions={waterOptions}
      onSetWaterTo={(uid) => setSessionWaterTo(groupId, sessionId, uid)}
      closing={{
        closed: sess.closed ?? null,
        request: sess.closeReq ?? null,
        needed,
        isHost,
        onClose: () => closeSession(groupId, sessionId, user.uid, openTables),
        onRequest: async () => {
          await requestClose(groupId, sessionId, user.uid);
          if (needed.every((id) => id === user.uid)) await closeSession(groupId, sessionId, user.uid, openTables);
        },
        onApprove: async () => {
          await approveClose(groupId, sessionId, user.uid);
          const got = new Set([...(sess.closeReq?.approvals ?? []), user.uid]);
          if (needed.every((id) => got.has(id))) await closeSession(groupId, sessionId, user.uid, openTables);
        },
        onCancel: () => cancelClose(groupId, sessionId),
      }}
      canEdit={group.data.ownerId === user.uid}
      accounts={accounts}
      expenses={expenses.data}
      pairs={pairs.data}
      teams={teams.data}
      onAcceptTeam={(id) => acceptTeam(groupId, id, user.uid)}
      teamsHref={`/g/${groupId}/rules#settle`}
      me={user.uid}
      onSaveConfig={(c) => saveSettleConfig(groupId, c)}
      settingsHref={`/g/${groupId}/s/${sessionId}/rules#settle`}
      onAddExpense={(e) => addExpense(groupId, sessionId, { ...e, by: user.uid })}
      onDeleteExpense={(id) => deleteExpense(groupId, sessionId, id)}
      onUpdateExpense={(id, e) => updateExpense(groupId, sessionId, id, e)}
      onProposePair={(a, b) => proposePair(groupId, sessionId, { a, b, by: user.uid, accepted: [a, b].filter((x) => x === user.uid) })}
      onAcceptPair={(id) => acceptPair(groupId, sessionId, id, user.uid)}
      onDeletePair={(id) => deletePair(groupId, sessionId, id)}
    />
  );
}
