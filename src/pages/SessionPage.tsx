import { useEffect, useMemo } from 'react';
import { rememberTable } from '../lib/nav.ts';
import type { User } from 'firebase/auth';
import SessionScreen from '../components/SessionScreen.tsx';
import Incoming from '../components/Incoming.tsx';
import { addTable, deleteSession, setSessionNoWater } from '../lib/data.ts';
import { Link } from '../lib/router.tsx';
import { useSuperAdmin } from '../lib/admin.ts';
import { go } from '../lib/router.tsx';
import { useGroup, useManyEvents, useMembers, useRequests, useSession, useTables } from '../lib/live.ts';
import { computeTable, rulesOf, rulesTimeline } from '../lib/score.ts';
import type { Computed } from '../lib/score.ts';
import { Loading, TopBar } from '../ui.tsx';
import LegacySession from '../components/LegacySession.tsx';

export default function SessionPage({ user, groupId, sessionId }: { user: User; groupId: string; sessionId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const tables = useTables(groupId, sessionId);
  const members = useMembers(groupId);
  const requests = useRequests(groupId, sessionId);
  const admin = useSuperAdmin(user.uid);
  const events = useManyEvents(groupId, sessionId, tables.data.map((t) => t.id));
  const rules = useMemo(() => rulesOf(group.data, session.data), [group.data, session.data]);
  const timeline = useMemo(() => rulesTimeline(group.data, session.data), [group.data, session.data]);

  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables.data) out[t.id] = computeTable(t, events[t.id] ?? [], timeline);
    return out;
  }, [tables.data, events, timeline]);

  // 記低我坐緊邊張枱，底部「枱」tab 用
  const myTable = tables.data.find((t) => { const c = computed[t.id]; return c && !c.state.ended && c.state.seats.includes(user.uid); })?.id ?? null;
  useEffect(() => { rememberTable(groupId, sessionId, myTable); }, [groupId, sessionId, myTable]);

  const back = `/g/${groupId}`;
  if (session.error || group.error) return <main className="page"><TopBar back={back} /><p className="error">{session.error ?? group.error}</p></main>;
  if (!session.data || !group.data) return <main className="page"><TopBar back={back} /><Loading /></main>;
  if (session.data.legacy) return <LegacySession group={group.data} session={session.data} members={members.data} back={back} me={user.uid} />;

  const seated = new Set<string>();
  for (const x of Object.values(computed)) if (x && !x.state.ended) x.state.seats.forEach((s) => seated.add(s));
  const candidates = members.data.filter((m) => !seated.has(m.uid)).map((m) => ({ id: m.uid, name: m.name }));

  return (
    <SessionScreen
      title={session.data.name}
      back={back}
      tables={tables.data}
      computed={computed}
      tableHref={(t) => `/g/${groupId}/s/${sessionId}/t/${t}`}
      invite={`${window.location.origin}/join/${groupId}/${group.data.inviteCode}/s/${sessionId}`}
      rulesHref={`/g/${groupId}/s/${sessionId}/rules`}
      settleHref={`/g/${groupId}/s/${sessionId}/settle`}
      water={session.data.closed ? undefined : { on: !session.data.noWater, onToggle: (on) => setSessionNoWater(groupId, sessionId, !on) }}
      closedNote={session.data.closed
        ? (
          <Link to={`/g/${groupId}/s/${sessionId}/pay`} className="link-card closed-card">
            <span className="stamp small-stamp">已埋數</span>
            <span className="grow"><b>轉賬詳情</b><small>邊個俾邊個、已轉未轉</small></span>
            <span className="chev" aria-hidden="true">›</span>
          </Link>
        )
        : session.data.closeReq
          ? <Link to={`/g/${groupId}/s/${sessionId}/settle`} className="banner"><span className="grow">有人申請埋數，撳入去同意</span></Link>
          : null}
      onDeleteSession={group.data.ownerId === user.uid || admin ? async () => { await deleteSession(groupId, sessionId); go(`/g/${groupId}`); } : undefined}
      notice={<Incoming user={user} groupId={groupId} sessionId={sessionId} requests={requests.data} tables={tables.data} computed={computed} />}
      candidates={candidates}
      me={user.uid}
      onAddTable={session.data.closed ? undefined : async (people) => {
        const names: Record<string, string> = {};
        for (const p of people) names[p.id] = p.name;
        await addTable(groupId, sessionId, tables.data.length, { name: `第 ${tables.data.length + 1} 枱`, seats: people.map((p) => p.id), names });
      }}
    />
  );
}
