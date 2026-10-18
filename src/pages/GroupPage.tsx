import type { User } from 'firebase/auth';
import { useGroup, useMembers, useSessions } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { Avatar, CopyLink, Hint, Loading, TopBar } from '../ui.tsx';
import { SettingsButton } from '../components/Settings.tsx';
import { Leaderboard } from '../components/Charts.tsx';
import { useBoard } from '../lib/history.ts';

export default function GroupPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const sessions = useSessions(groupId);
  const memberNames = Object.fromEntries(members.data.map((m) => [m.uid, m.name]));
  const board = useBoard(group.data, sessions.loading ? [] : sessions.data, memberNames);

  if (group.error) return <main className="page"><TopBar back="/" /><p className="error">{group.error}</p></main>;
  if (!group.data) return <main className="page"><TopBar back="/" /><Loading /></main>;

  const g = group.data;
  const invite = `${window.location.origin}/join/${groupId}/${g.inviteCode}`;
  const list = [...sessions.data].reverse();

  return (
    <main className="page">
      <TopBar back="/" title={g.name} right={<SettingsButton />} />

      <section className="stack">
        <Link to={`/g/${groupId}/new`} className="btn big">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          開大局
        </Link>
      </section>

      <section className="stack">
        <h2 className="section-head">大局</h2>
        {list.length ? (
          <div className="list">
            {list.map((s) => (
              <Link key={s.id} to={`/g/${groupId}/s/${s.id}`} className="listrow">
                <span className="grow">{s.name}</span>
                <span className="muted small">{s.createdAt ? s.createdAt.toDate().toLocaleDateString('zh-HK') : ''}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </Link>
            ))}
          </div>
        ) : (
          !sessions.loading && <p className="muted">未有大局。</p>
        )}
      </section>

      {board.rows.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2>龍虎榜</h2>
            <span className="muted small">所有大局合計（番）</span>
          </div>
          <div className="list pad">
            <Leaderboard rows={board.rows} me={user.uid} />
          </div>
        </section>
      )}

      <Link to={`/g/${groupId}/rules`} className="listrow list">
        <span className="grow">家規<span className="muted small">　底、莊、雙響、拉、抽水</span></span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </Link>

      <section className="panel">
        <div className="between">
          <h2>成員（{members.data.length}）</h2>
          {g.ownerId === user.uid && <span className="muted small">你是局主</span>}
        </div>
        <div className="member-grid">
          {members.data.map((m) => (
            <div key={m.uid} className="member">
              <Avatar name={m.name} photo={m.photoURL} size="sm" />
              <span className="ellipsis">{m.name}</span>
            </div>
          ))}
        </div>
        <Hint>把連結傳給牌友，登入後會自動加入。</Hint>
        <CopyLink url={invite} />
      </section>
    </main>
  );
}
