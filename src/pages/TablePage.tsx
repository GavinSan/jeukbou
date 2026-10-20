import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import TableScreen from '../components/TableScreen.tsx';
import Incoming from '../components/Incoming.tsx';
import { appendEvent, applySwap, cancelSwap, declineSettle, requestSwap, reseat, rollDice, fanTableOf, settleConfigOf, deleteTable, isGuest } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { go } from '../lib/router.tsx';
import { useEvents, useGroup, useManyEvents, useMembers, useRequests, useSession, useTables } from '../lib/live.ts';
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
  // 自己張枱嘅紀錄單獨聽（快啲出）；其他枱喺背景聽，用嚟知道邊個未坐低
  const own = useEvents(groupId, sessionId, tableId);
  const others = useManyEvents(groupId, sessionId, tables.data.map((t) => t.id).filter((t) => t !== tableId));
  const events = useMemo(() => (own.loading ? others : { ...others, [tableId]: own.data }), [own.loading, own.data, others, tableId]);
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 7000); return () => clearTimeout(t); }, []);
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
  if (!table || !c || own.loading) {
    return (
      <main className="page">
        <TopBar back={back} />
        <Loading />
        {(slow || own.error) && (
          <section className="panel">
            <p className="muted">{own.error ?? '載入得比較慢，可能係網絡問題。'}</p>
            <button type="button" className="btn" onClick={() => window.location.reload()}>重新載入</button>
          </section>
        )}
      </main>
    );
  }

  const tableEvents = events[tableId] ?? [];
  const seatedAnywhere = new Set<string>();
  for (const x of Object.values(computed)) if (x && !x.state.ended) x.state.seats.forEach((s) => seatedAnywhere.add(s));
  // 換人：今晚大局入面嘅人（其他枱打緊、打完枱、今日有份）排先，再加其他成員同訪客
  const tonight = new Set<string>();
  for (const t of tables.data) { const x = computed[t.id]; if (x) Object.keys(x.state.settled).forEach((id) => tonight.add(id)); }
  for (const pl of session.data?.people ?? []) tonight.add(pl.id);
  const candidates: { id: string; name: string; table?: { id: string; name: string }; tonight?: boolean }[] = [];
  for (const t of tables.data) {
    if (t.id === tableId) continue;
    const x = computed[t.id];
    if (!x) continue;
    for (const s of x.state.seats) {
      if (candidates.some((k) => k.id === s)) continue;
      if (!x.state.ended) candidates.push({ id: s, name: t.names[s] ?? '玩家', table: { id: t.id, name: t.name }, tonight: true });
      else if (!seatedAnywhere.has(s)) candidates.push({ id: s, name: t.names[s] ?? (isGuest(s) ? '訪客' : '玩家'), tonight: true });
    }
  }
  for (const pl of session.data?.people ?? []) {
    if (!seatedAnywhere.has(pl.id) && !candidates.some((k) => k.id === pl.id)) candidates.push({ id: pl.id, name: pl.name, tonight: true });
  }
  for (const m of members.data) {
    if (!seatedAnywhere.has(m.uid) && !candidates.some((k) => k.id === m.uid)) candidates.push({ id: m.uid, name: m.name, tonight: tonight.has(m.uid) });
  }

  // 只有坐喺呢張枱嘅人（同場主、局主）先可以入數；其他人只可以睇
  const owner = !!group.data && (group.data.ownerId === user.uid || admin);
  const canEnter = c.state.seats.includes(user.uid) || session.data?.createdBy === user.uid || owner;

  return (
    <TableScreen
      table={table}
      canEnter={canEnter}
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
        const outName = table.names[out] ?? '玩家';
        // 訪客冇帳戶：即刻換（喺其他枱就兩邊對調）
        if (guest || isGuest(incoming.id)) {
          await applySwap(groupId, sessionId, tableId, user.uid, out, incoming.id, incoming.name);
          if (incoming.table) await applySwap(groupId, sessionId, incoming.table.id, user.uid, incoming.id, out, outName);
          return 'done';
        }
        const dup = requests.data.some((r) => r.status === 'pending' && r.in === incoming.id);
        if (dup) throw new Error(`已邀請 ${incoming.name}，請等待回覆`);
        await requestSwap(groupId, sessionId, { tableId, out, in: incoming.id, inName: incoming.name, by: user.uid, ...(incoming.table ? { fromTable: incoming.table.id, outName } : {}) });
        return 'requested';
      }}
      onCancelSwap={(id) => cancelSwap(groupId, sessionId, id)}
      onReseat={async (seats) => {
        // 未開局：直接改座位；開咗局（例如打完四圈換位）：入一條「換位」紀錄，之前嘅數唔變
        if (tableEvents.length === 0) await reseat(groupId, sessionId, tableId, seats);
        else await appendEvent(groupId, sessionId, tableId, tableEvents.length + 1, user.uid, { type: 'reseat', seats });
      }}
      onDice={async () => { await rollDice(groupId, sessionId, tableId, user.uid, (table.dice?.n ?? 0) + 1); }}
    />
  );
}

