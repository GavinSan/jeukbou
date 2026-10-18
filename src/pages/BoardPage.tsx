import type { User } from 'firebase/auth';
import BoardView from '../components/BoardView.tsx';
import { useHistory } from '../lib/history.ts';
import { useGroup, useMembers, useSessions } from '../lib/live.ts';
import { Loading, TopBar } from '../ui.tsx';

export default function BoardPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const sessions = useSessions(groupId);
  const memberNames = Object.fromEntries(members.data.map((m) => [m.uid, m.name]));
  const h = useHistory(group.data, sessions.loading ? [] : sessions.data, memberNames);
  const back = `/g/${groupId}`;
  if (group.error) return <main className="page"><TopBar back={back} /><p className="error">{group.error}</p></main>;
  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>龍虎榜</h1><span className="muted small">{group.data?.name ?? ''}</span></div>} />
      {h.loading ? <Loading /> : h.sessions.length ? (
        <BoardView key={h.sessions.length} sessions={h.sessions} names={h.names} me={user.uid} sessionHref={(s) => `/g/${groupId}/s/${s}`} />
      ) : <p className="muted">未有紀錄。</p>}
    </main>
  );
}
