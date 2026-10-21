import { useEffect, useMemo } from 'react';
import { rememberTable } from '../lib/nav.ts';
import type { User } from 'firebase/auth';
import SessionScreen from '../components/SessionScreen.tsx';
import Incoming from '../components/Incoming.tsx';
import { applyDraw, approveDraw, autoDeal, cancelDraw, canDo, addTable, deleteSession, findTodaySession, pickTile, setSessionNoWater, startDraw, tableNameUpper } from '../lib/data.ts';
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
            {(() => {
              const ts = session.data.payout?.transfers ?? [];
              const done = ts.filter((t) => session.data!.paid?.[`${t.from}>${t.to}`]).length;
              const clear = done >= ts.length;
              return (
                <>
                  <span className={`stamp small-stamp${clear ? ' clear' : ''}`}>{clear ? '已找清' : '計好數'}</span>
                  <span className="grow"><b>轉賬詳情</b><small>{clear ? '全部人已經轉晒數' : '邊個俾邊個、已轉未轉'}</small></span>
                  {!clear && <span className="pay-status">待找數 {done}/{ts.length}</span>}
                </>
              );
            })()}
            <span className="chev" aria-hidden="true">›</span>
          </Link>
        )
        : session.data.closeReq
          ? <Link to={`/g/${groupId}/s/${sessionId}/settle`} className="banner"><span className="grow">有人申請埋數，撳入去同意</span></Link>
          : null}
      onDeleteSession={canDo(group.data, members.data.find((m) => m.uid === user.uid), user.uid, admin, 'records') ? async () => { await deleteSession(groupId, sessionId); go(`/g/${groupId}`); } : undefined}
      notice={<Incoming user={user} groupId={groupId} sessionId={sessionId} requests={requests.data} tables={tables.data} computed={computed} />}
      candidates={candidates}
      me={user.uid}
      regroup={session.data.closed ? undefined : {
        draw: session.data.draw ?? null,
        canForce: session.data.createdBy === user.uid || group.data.ownerId === user.uid || admin,
        candidates: [
          ...members.data.filter((m) => !seated.has(m.uid)).map((m) => ({ id: m.uid, name: m.name })),
          ...(session.data.people ?? []).filter((p) => !seated.has(p.id) && !members.data.some((m) => m.uid === p.id)),
        ],
        onStart: async (d) => {
          await startDraw(groupId, sessionId, d);
          // 電腦派：等洗牌動畫轉完先派
          if (d.mode === 'auto' && d.status === 'picking') setTimeout(() => { autoDeal(groupId, sessionId).catch(() => undefined); }, 1400);
        },
        onApprove: () => {
          const seatsOf: Record<string, string[]> = {};
          for (const t of tables.data) { const c = computed[t.id]; if (c) seatsOf[t.id] = c.state.seats; }
          const force = session.data!.createdBy === user.uid || group.data!.ownerId === user.uid || admin;
          return force ? startDraw(groupId, sessionId, { ...session.data!.draw!, status: 'picking', approvals: [...new Set([...(session.data!.draw?.approvals ?? []), user.uid])] }) : approveDraw(groupId, sessionId, user.uid, seatsOf);
        },
        onPick: (tile, player) => pickTile(groupId, sessionId, tile, player),
        onAuto: () => autoDeal(groupId, sessionId),
        onCancel: () => cancelDraw(groupId, sessionId),
        onApply: (plan, endTables) => applyDraw(groupId, sessionId, user.uid, plan, endTables, tables.data.length),
      }}
      onClosedAdd={async () => {
        const id = await findTodaySession(groupId).catch(() => null);
        go(id && id !== sessionId ? `/g/${groupId}/s/${id}#add-table` : `/g/${groupId}/new`);
      }}
      onAddTable={session.data.closed ? undefined : async (people) => {
        const names: Record<string, string> = {};
        for (const p of people) names[p.id] = p.name;
        await addTable(groupId, sessionId, tables.data.length, { name: tableNameUpper(tables.data.length), seats: people.map((p) => p.id), names });
      }}
    />
  );
}
