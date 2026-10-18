import { useState } from 'react';
import type { FormEvent } from 'react';
import { signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth } from '../firebase.ts';
import { createGroup, displayName, syncMemberName } from '../lib/data.ts';
import { useGroup, useUserGroups } from '../lib/live.ts';
import { Link, go } from '../lib/router.tsx';
import { Avatar, NameForm, TopBar, message } from '../ui.tsx';
import { SettingsButton } from '../components/Settings.tsx';
import { useSuperAdmin } from '../lib/admin.ts';

function GroupRow({ id }: { id: string }) {
  const { data } = useGroup(id);
  if (!data) return null;
  return (
    <Link to={`/g/${id}`} className="listrow">
      <span className="grow">{data.name}</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </Link>
  );
}

export default function Home({ user, refresh }: { user: User; refresh: () => void }) {
  const groups = useUserGroups(user.uid);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = displayName(user);
  const admin = useSuperAdmin(user.uid);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const id = await createGroup(user, newName.trim());
      go(`/g/${id}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <TopBar right={<><SettingsButton /><button type="button" className="btn plain" onClick={() => auth && signOut(auth)}>登出</button></>} />

      <section className="panel">
        <div className="row">
          <Avatar name={name} photo={user.photoURL} size="lg" />
          <div className="grow">
            <h2>{name}</h2>
            <p className="muted small">{user.email}</p>
          </div>
          {!editing && <button type="button" className="btn plain" onClick={() => setEditing(true)}>改名</button>}
        </div>
        {editing && (
          <NameForm
            user={user}
            initial={name}
            onDone={() => { setEditing(false); refresh(); syncMemberName(user, groups.data).catch(() => undefined); }}
            onCancel={() => setEditing(false)}
          />
        )}
      </section>

      <section className="stack">
        <h2 className="section-head">我的牌友圈</h2>
        {groups.data.length > 0 ? (
          <div className="list">{groups.data.map((g) => <GroupRow key={g} id={g} />)}</div>
        ) : (
          !groups.loading && <p className="muted">未有牌友圈。</p>
        )}
      </section>

      <section className="panel">
        <h2>開新牌友圈</h2>
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={create}>
          <label className="field grow">
            <span>名稱</span>
            <input id="group-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：不打不相識" maxLength={30} />
          </label>
          <button type="submit" className="btn" disabled={busy || !newName.trim()}>建立</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {admin && <Link to="/admin" className="listrow list"><span className="grow">超級管理員</span><span className="muted small">所有牌友圈</span></Link>}
    </main>
  );
}
