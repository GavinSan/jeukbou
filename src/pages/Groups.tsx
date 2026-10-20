// 牌友圈：搜尋、新增（用加入碼加入／開新牌友圈）、等緊批准嘅申請
import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { cancelJoinRequest, createGroup, joinGroup, lookupJoinCode, settlePending } from '../lib/data.ts';
import { useGroup, useJoinRequests, useMyJoinRequest, useMyMember, useProfile } from '../lib/live.ts';
import { Link, go } from '../lib/router.tsx';
import { Sheet, TopBar, message } from '../ui.tsx';
import { seenAt } from '../lib/notify.ts';
import { useSuperAdmin } from '../lib/admin.ts';

const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

function OwnerBadge({ id }: { id: string }) {
  const reqs = useJoinRequests(id);
  return reqs.data.length ? <span className="tag ask">{reqs.data.length} 人申請</span> : null;
}

export function GroupRowView({ href, name, fresh, badge }: { href: string; name: string; fresh?: boolean; badge?: ReactNode }) {
  return (
    <Link to={href} className="listrow">
      <span className="grow">{name}</span>
      {fresh && <span className="tag new">番數表更新</span>}
      {badge}
      <Chevron />
    </Link>
  );
}

function GroupRow({ id, q, uid }: { id: string; q: string; uid: string }) {
  const { data } = useGroup(id);
  if (!data) return null;
  if (q && !data.name.toLowerCase().includes(q.toLowerCase())) return null;
  const log = data.fanTableLog;
  const fresh = !!log?.at && log.by !== uid && log.at > seenAt(id);
  return <GroupRowView href={`/g/${id}`} name={data.name} fresh={fresh} badge={data.ownerId === uid ? <OwnerBadge id={id} /> : null} />;
}

export function SearchAdd({ q, onQ, onAdd }: { q: string; onQ: (v: string) => void; onAdd: () => void }) {
  return (
    <div className="home-search">
      <svg className="home-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input className="input" type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="搜尋我的牌友圈" aria-label="搜尋我的牌友圈" />
      <button type="button" className="iconbtn add-btn" aria-label="新增" onClick={onAdd}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

/** 等緊批准嘅牌友圈：批咗自動搬去「我的牌友圈」 */
function PendingRow({ g, name, uid }: { g: string; name: string; uid: string }) {
  const member = useMyMember(g, uid);
  const req = useMyJoinRequest(g, uid);
  const joined = !!member.data;
  useEffect(() => { if (joined) settlePending(uid, g, true).catch(() => undefined); }, [joined, uid, g]);
  if (joined || member.loading || req.loading) return null;
  const rejected = !req.data;
  return (
    <div className="listrow pending-row">
      <span className="grow">{name}<small className="muted">{rejected ? '　申請未獲批准' : '　等待局主批准'}</small></span>
      <button type="button" className="textbtn" onClick={() => cancelJoinRequest(uid, g).catch(() => undefined)}>{rejected ? '移除' : '取消申請'}</button>
    </div>
  );
}

export function AddSheet({ user, photo, groups, onClose }: { user: User | null; photo: string | null; groups: string[]; onClose: () => void }) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) { setError('示範模式不會儲存'); return; }
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        if (!name.trim()) return;
        const id = await createGroup(user, name.trim(), photo);
        go(`/g/${id}`);
        return;
      }
      const found = await lookupJoinCode(code);
      if (!found) { setError('找不到此加入碼，請檢查後再試'); return; }
      if (groups.includes(found.g)) { go(`/g/${found.g}`); return; }
      const res = await joinGroup(user, found.g, found.invite, photo, found.name);
      if (res === 'joined') go(`/g/${found.g}`);
      else setDone(`已向「${found.name}」送出申請，局主批准後會出現在你的牌友圈。`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} label="新增牌友圈">
      <div className="seg wide" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'join'} aria-pressed={mode === 'join'} onClick={() => { setMode('join'); setError(''); }}>用加入碼</button>
        <button type="button" role="tab" aria-selected={mode === 'create'} aria-pressed={mode === 'create'} onClick={() => { setMode('create'); setError(''); }}>開新牌友圈</button>
      </div>
      {done ? (
        <>
          <p className="ok">{done}</p>
          <button type="button" className="btn big" onClick={onClose}>好</button>
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          {mode === 'join' ? (
            <label className="field">
              <span>加入碼</span>
              <input
                className="code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="6 位，例如 K7PQ2M"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="加入碼"
              />
              <small className="muted">向局主或者牌友索取，在牌友圈頁面「成員」下面可以見到。</small>
            </label>
          ) : (
            <label className="field">
              <span>名稱</span>
              <input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：不打不相識" maxLength={30} />
            </label>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn big" disabled={busy || (mode === 'join' ? code.length !== 6 : !name.trim())}>
            {busy ? '請稍候…' : mode === 'join' ? '加入' : '建立'}
          </button>
        </form>
      )}
    </Sheet>
  );
}

export default function GroupsPage({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const groups = profile.data.groups;
  const pending = Object.entries(profile.data.pending).filter(([g]) => !groups.includes(g));
  const photo = profile.data.avatar ?? user.photoURL;
  const [adding, setAdding] = useState(() => new URLSearchParams(location.search).has('add'));
  const [q, setQ] = useState('');
  const admin = useSuperAdmin(user.uid);

  return (
    <main className="page">
      <TopBar title="牌友圈" />
      <section className="stack">
        <SearchAdd q={q} onQ={setQ} onAdd={() => setAdding(true)} />
        {pending.length > 0 && (
          <div className="list">{pending.map(([g, n]) => <PendingRow key={g} g={g} name={n} uid={user.uid} />)}</div>
        )}
        {groups.length > 0 ? (
          <div className="list">{groups.map((g) => <GroupRow key={g} id={g} q={q.trim()} uid={user.uid} />)}</div>
        ) : (
          !profile.loading && !pending.length && (
            <div className="empty">
              <p>未有牌友圈。</p>
              <button type="button" className="btn" onClick={() => setAdding(true)}>用加入碼加入或開新牌友圈</button>
            </div>
          )
        )}
      </section>
      {admin && <Link to="/admin" className="listrow list"><span className="grow">超級管理員</span><span className="muted small">所有牌友圈</span></Link>}
      {adding && <AddSheet user={user} photo={photo} groups={groups} onClose={() => setAdding(false)} />}
    </main>
  );
}
