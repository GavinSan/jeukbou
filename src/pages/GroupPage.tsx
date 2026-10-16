import type { User } from 'firebase/auth';
import { useGroup, useMembers, useSessions } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { Avatar, CopyLink, Loading, TopBar } from '../ui.tsx';

export default function GroupPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const sessions = useSessions(groupId);

  if (group.error) return <main className="page"><TopBar back="/" /><p className="error">{group.error}</p></main>;
  if (!group.data) return <main className="page"><TopBar back="/" /><Loading /></main>;

  const g = group.data;
  const invite = `${window.location.origin}/join/${groupId}/${g.inviteCode}`;
  const list = [...sessions.data].reverse();

  return (
    <main className="page">
      <TopBar back="/" title={g.name} />

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
          !sessions.loading && <p className="muted">未有大局。撳「開大局」揀枱同位就開始。</p>
        )}
      </section>

      <section className="panel">
        <div className="between">
          <h2>成員（{members.data.length}）</h2>
          {g.ownerId === user.uid && <span className="muted small">你係局主</span>}
        </div>
        <div className="member-grid">
          {members.data.map((m) => (
            <div key={m.uid} className="member">
              <Avatar name={m.name} photo={m.photoURL} size="sm" />
              <span className="ellipsis">{m.name}</span>
            </div>
          ))}
        </div>
        <p className="muted small">將連結 send 俾牌友，佢哋登入之後就會自動加入。</p>
        <CopyLink url={invite} />
      </section>
    </main>
  );
}
