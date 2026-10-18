import type { User } from 'firebase/auth';
import { Leaderboard } from '../components/Charts.tsx';
import { useBoard } from '../lib/history.ts';
import { useGroup, useMembers, useSessions } from '../lib/live.ts';
import { Loading, TopBar } from '../ui.tsx';

export default function BoardPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const sessions = useSessions(groupId);
  const memberNames = Object.fromEntries(members.data.map((m) => [m.uid, m.name]));
  const board = useBoard(group.data, sessions.loading ? [] : sessions.data, memberNames);
  const back = `/g/${groupId}`;
  if (group.error) return <main className="page"><TopBar back={back} /><p className="error">{group.error}</p></main>;
  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>龍虎榜</h1><span className="muted small">{group.data?.name ?? ''}</span></div>} />
      {board.loading ? <Loading /> : board.rows.length ? (
        <section className="stack">
          <div className="section-head"><h2>總排名</h2><span className="muted small">所有大局合計（番）</span></div>
          <div className="list pad"><Leaderboard rows={board.rows} me={user.uid} /></div>
        </section>
      ) : <p className="muted">未有紀錄。</p>}
    </main>
  );
}
