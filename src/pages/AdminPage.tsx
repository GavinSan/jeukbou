// 超級管理員：睇晒所有牌友圈，可以入去或者刪除
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { deleteGroup, listAllGroups } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { Link } from '../lib/router.tsx';
import { ConfirmDelete, Loading, TopBar, message } from '../ui.tsx';

export default function AdminPage({ user }: { user: User }) {
  const admin = useSuperAdmin(user.uid);
  const [groups, setGroups] = useState<{ id: string; name: string; ownerId: string }[] | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!admin) return;
    listAllGroups().then(setGroups).catch((e) => setError(message(e)));
  }, [admin, tick]);

  return (
    <main className="page">
      <TopBar back="/" title="管理員" />
      {!admin ? <p className="muted">只有超級管理員可以使用此頁。</p> : !groups ? <Loading /> : (
        <section className="stack">
          <h2>所有牌友圈（{groups.length}）</h2>
          <div className="list">
            {groups.map((g) => (
              <div key={g.id} className="listrow-wrap">
                <Link to={`/g/${g.id}`} className="listrow"><span className="grow">{g.name || '（未命名）'}</span><span className="muted small">{g.id.slice(0, 6)}</span></Link>
                <button type="button" className="row-del" onClick={() => setConfirm(g)}>刪除</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      {confirm && (
        <ConfirmDelete
          title="刪除牌友圈"
          detail={`會永久刪除「${confirm.name}」所有大局、紀錄同成員名單。`}
          word={confirm.name || confirm.id.slice(0, 6)}
          onConfirm={async () => { await deleteGroup(confirm.id); setTick((t) => t + 1); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </main>
  );
}
