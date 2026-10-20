// 超級管理員 Dashboard：總覽、牌友圈、用家（重設密碼、改名、加減牌友圈）、資料（任何文件睇／改／刪）
// 手機同電腦都用到：闊屏左邊係分頁，窄屏上面係分頁
import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { deleteGroup, deleteSession, setJoinMode } from '../lib/data.ts';
import type { JoinMode } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import {
  addToGroup, childCollections, listCollection, loadAllGroups, loadAllUsers, readDoc, removeDoc, removeFromGroup,
  renameGroup, renameUser, reopenSession, sendReset, setOwner, writeDoc,
} from '../lib/adminData.ts';
import type { AdminGroup, AdminUser } from '../lib/adminData.ts';
import { Link } from '../lib/router.tsx';
import { ConfirmDelete, Loading, TopBar, message } from '../ui.tsx';

type Tab = 'overview' | 'groups' | 'users' | 'data';
const TABS: [Tab, string][] = [['overview', '總覽'], ['groups', '牌友圈'], ['users', '用家'], ['data', '資料']];
const md = (t: number) => (t ? new Date(t).toLocaleDateString('zh-HK', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '—');

function useAdminData(on: boolean, tick: number) {
  const [groups, setGroups] = useState<AdminGroup[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!on) return;
    Promise.all([loadAllGroups(), loadAllUsers()]).then(([g, u]) => { setGroups(g); setUsers(u); }).catch((e) => setError(message(e)));
  }, [on, tick]);
  return { groups, users, error };
}

export default function AdminPage({ user }: { user: User }) {
  const admin = useSuperAdmin(user.uid);
  const [tick, setTick] = useState(0);
  const { groups, users, error } = useAdminData(admin, tick);
  if (!admin) {
    return <main className="page"><TopBar back="/settings" title="超級管理員" /><p className="muted">只有超級管理員可以使用此頁。</p></main>;
  }
  return <AdminView me={user.uid} groups={groups} users={users} error={error} onRefresh={() => setTick((t) => t + 1)} />;
}

/** Dashboard 本體（demo 都用） */
export function AdminView({ me, groups, users, error, onRefresh }: {
  me: string; groups: AdminGroup[] | null; users: AdminUser[] | null; error: string; onRefresh: () => void;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1) as Tab;
    return TABS.some(([k]) => k === h) ? h : 'overview';
  });
  const [dataPath, setDataPath] = useState('groups');
  const pick = (t: Tab) => { setTab(t); try { history.replaceState(null, '', `#${t}`); } catch { /* 唔緊要 */ } };
  const toData = (p: string) => { setDataPath(p); pick('data'); };
  return (
    <main className="page admin">
      <TopBar back="/settings" title="超級管理員" right={<button type="button" className="textbtn" onClick={onRefresh}>重新載入</button>} />
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="管理分頁">
          {TABS.map(([k, t]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => pick(k)}>{t}</button>
          ))}
        </nav>
        <div className="admin-main">
          {error && <p className="error">{error}</p>}
          {!groups || !users ? <Loading /> : (
            <>
              {tab === 'overview' && <Overview groups={groups} users={users} onGo={pick} />}
              {tab === 'groups' && <Groups groups={groups} users={users} me={me} onChanged={onRefresh} onData={toData} />}
              {tab === 'users' && <Users users={users} groups={groups} onChanged={onRefresh} onData={toData} />}
              {tab === 'data' && <DataBrowser path={dataPath} setPath={setDataPath} />}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Overview({ groups, users, onGo }: { groups: AdminGroup[]; users: AdminUser[]; onGo: (t: Tab) => void }) {
  const sessions = groups.reduce((a, g) => a + g.sessions.length, 0);
  const open = groups.reduce((a, g) => a + g.sessions.filter((s) => !s.closed && !s.legacy).length, 0);
  const week = Date.now() - 7 * 86400000;
  const recent = groups.flatMap((g) => g.sessions.filter((s) => s.at > week).map((s) => ({ ...s, g })));
  const noEmail = users.filter((u) => !u.email).length;
  return (
    <div className="stack">
      <div className="admin-cards">
        <button type="button" className="admin-card" onClick={() => onGo('groups')}><small>牌友圈</small><b className="num">{groups.length}</b></button>
        <button type="button" className="admin-card" onClick={() => onGo('users')}><small>用家</small><b className="num">{users.length}</b></button>
        <div className="admin-card"><small>大局</small><b className="num">{sessions}</b><span>{open} 個未埋數</span></div>
        <div className="admin-card"><small>近 7 日</small><b className="num">{recent.length}</b><span>個大局</span></div>
      </div>
      {noEmail > 0 && <p className="muted small">有 {noEmail} 個用家未有 email 紀錄（佢哋下次登入會自動補返）。</p>}
      <h2 className="section-head">最近大局</h2>
      <div className="list">
        {recent.sort((a, b) => b.at - a.at).slice(0, 10).map((s) => (
          <Link key={s.id} to={`/g/${s.g.id}/s/${s.id}`} className="listrow">
            <span className="grow exp-text"><span>{s.name}</span><small className="muted">{s.g.name} · {md(s.at)}</small></span>
            <span className={`tag ${s.closed ? 'settle' : 'pending'}`}>{s.closed ? '已埋數' : '進行中'}</span>
            <span className="chev" aria-hidden="true">›</span>
          </Link>
        ))}
        {!recent.length && <p className="muted pad">近 7 日冇大局。</p>}
      </div>
    </div>
  );
}

function Groups({ groups, users, me, onChanged, onData }: { groups: AdminGroup[]; users: AdminUser[]; me: string; onChanged: () => void; onData: (p: string) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<null | { title: string; detail: string; word: string; run: () => Promise<void> }>(null);
  const [newName, setNewName] = useState('');
  const g = groups.find((x) => x.id === sel) ?? null;
  const shown = groups.filter((x) => !q || x.name.includes(q) || x.id.includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (uid: string) => users.find((u) => u.uid === uid)?.name || g?.members.find((m) => m.uid === uid)?.name || uid.slice(0, 6);
  const emailOf = (uid: string) => users.find((u) => u.uid === uid)?.email ?? '';
  async function run(t: () => Promise<void>) {
    setBusy(true); setErr('');
    try { await t(); onChanged(); } catch (e) { setErr(message(e)); } finally { setBusy(false); }
  }
  return (
    <div className="admin-split">
      <div className="stack admin-list">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋牌友圈名或 id" aria-label="搜尋牌友圈" />
        <div className="list">
          {shown.map((x) => (
            <button key={x.id} type="button" className={`listrow admin-row${sel === x.id ? ' on' : ''}`} onClick={() => { setSel(x.id); setNewName(x.name); setErr(''); }}>
              <span className="grow exp-text"><span>{x.name || '（未命名）'}</span><small className="muted">局主 {nameOf(x.ownerId)} · {x.members.length} 人 · {x.sessions.length} 局</small></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
      <div className="stack admin-detail">
        {!g ? <p className="muted">揀一個牌友圈睇詳情。</p> : (
          <>
            <div className="panel">
              <div className="between"><h2>{g.name || '（未命名）'}</h2><Link to={`/g/${g.id}`} className="textbtn">打開 ›</Link></div>
              <p className="muted small">id {g.id} · 加入碼 {g.joinCode || '—'}</p>
              <label className="field"><span>改名</span>
                <div className="row"><input className="input grow" value={newName} onChange={(e) => setNewName(e.target.value)} /><button type="button" className="btn small-btn" disabled={busy || !newName.trim() || newName === g.name} onClick={() => run(() => renameGroup(g.id, newName.trim()))}>儲存</button></div>
              </label>
              <label className="field"><span>局主</span>
                <select className="input" value={g.ownerId} disabled={busy} onChange={(e) => run(() => setOwner(g.id, e.target.value))}>
                  {g.members.map((m) => <option key={m.uid} value={m.uid}>{m.name}{emailOf(m.uid) ? `（${emailOf(m.uid)}）` : ''}</option>)}
                </select>
              </label>
              <div className="field"><span>加入方式</span>
                <div className="seg wide">
                  {(['auto', 'approve', 'closed'] as JoinMode[]).map((m) => (
                    <button key={m} type="button" aria-pressed={g.joinMode === m} disabled={busy} onClick={() => run(() => setJoinMode(g.id, m))}>{m === 'auto' ? '自動加入' : m === 'approve' ? '要批准' : '不收新人'}</button>
                  ))}
                </div>
              </div>
              <button type="button" className="textbtn" onClick={() => onData(`groups/${g.id}`)}>喺「資料」睇原始資料 ›</button>
            </div>
            <h3>成員（{g.members.length}）</h3>
            <div className="list">
              {g.members.map((m) => (
                <div key={m.uid} className="listrow">
                  <span className="grow exp-text"><span>{m.name}{m.uid === g.ownerId && <span className="tag instant">局主</span>}</span><small className="muted">{emailOf(m.uid) || m.uid}</small></span>
                  {m.uid !== g.ownerId && (
                    <button type="button" className="btn plain small-btn remove-btn" disabled={busy} onClick={() => setConfirm({ title: '移除成員', detail: `將 ${m.name} 移出「${g.name}」。紀錄會保留。`, word: m.name, run: () => removeFromGroup(m.uid, g.id, users.find((u) => u.uid === m.uid)?.groups ?? []).then(onChanged) })}>移除</button>
                  )}
                </div>
              ))}
            </div>
            <h3>大局（{g.sessions.length}）</h3>
            <div className="list">
              {g.sessions.slice(0, 50).map((s) => (
                <div key={s.id} className="listrow">
                  <Link to={`/g/${g.id}/s/${s.id}`} className="grow exp-text admin-link"><span>{s.name}{s.legacy && <span className="tag instant">舊</span>}</span><small className="muted">{md(s.at)} · {s.closed ? '已埋數' : '未埋數'}</small></Link>
                  {s.closed && !s.legacy && <button type="button" className="textbtn" disabled={busy} onClick={() => run(() => reopenSession(g.id, s.id))}>重開</button>}
                  <button type="button" className="textbtn loss" disabled={busy} onClick={() => setConfirm({ title: '刪除大局', detail: `永久刪除「${s.name}」所有紀錄。`, word: s.name, run: () => deleteSession(g.id, s.id).then(onChanged) })}>刪除</button>
                </div>
              ))}
            </div>
            <section className="danger-zone">
              <h3>危險操作</h3>
              <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirm({ title: '刪除牌友圈', detail: `永久刪除「${g.name}」所有大局、紀錄同成員。`, word: g.name || g.id.slice(0, 6), run: async () => { await deleteGroup(g.id); setSel(null); onChanged(); } })}>刪除牌友圈</button>
            </section>
          </>
        )}
        {err && <p className="error">{err}</p>}
        {me && null}
      </div>
      {confirm && <ConfirmDelete title={confirm.title} detail={confirm.detail} word={confirm.word} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function Users({ users, groups, onChanged, onData }: { users: AdminUser[]; groups: AdminGroup[]; onChanged: () => void; onData: (p: string) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [addG, setAddG] = useState('');
  const u = users.find((x) => x.uid === sel) ?? null;
  const shown = users.filter((x) => !q || `${x.name} ${x.email} ${x.uid}`.toLowerCase().includes(q.toLowerCase()));
  const gName = (id: string) => groups.find((g) => g.id === id)?.name ?? id.slice(0, 6);
  async function run(t: () => Promise<void>, done = '') {
    setBusy(true); setErr(''); setMsg('');
    try { await t(); if (done) setMsg(done); onChanged(); } catch (e) { setErr(message(e)); } finally { setBusy(false); }
  }
  return (
    <div className="admin-split">
      <div className="stack admin-list">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋名、email 或 uid" aria-label="搜尋用家" />
        <div className="list">
          {shown.map((x) => (
            <button key={x.uid} type="button" className={`listrow admin-row${sel === x.uid ? ' on' : ''}`} onClick={() => { setSel(x.uid); setName(x.name); setResetEmail(x.email); setErr(''); setMsg(''); }}>
              <span className="grow exp-text"><span>{x.name || '（未改名）'}</span><small className="muted">{x.email || '未有 email 紀錄'} · {x.groups.length} 個圈</small></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
      <div className="stack admin-detail">
        <div className="panel">
          <h3>重設密碼</h3>
          <p className="muted small">寄重設密碼 email 去用家個郵箱（只適用 Email 登入；Google 登入唔使密碼）。</p>
          <div className="row">
            <input className="input grow" type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="用家 email" aria-label="用家 email" />
            <button type="button" className="btn small-btn" disabled={busy || !resetEmail.includes('@')} onClick={() => run(() => sendReset(resetEmail), `已寄重設密碼 email 去 ${resetEmail}`)}>寄出</button>
          </div>
        </div>
        {u && (
          <div className="panel">
            <div className="between"><h2>{u.name || '（未改名）'}</h2><button type="button" className="textbtn" onClick={() => onData(`users/${u.uid}`)}>原始資料 ›</button></div>
            <p className="muted small">uid {u.uid}<br />登入 email：{u.email || '—'}<br />收款 email：{u.payEmail || '—'}<br />最後更新：{md(u.updatedAt)}</p>
            <label className="field"><span>改顯示名（會同步去所有牌友圈）</span>
              <div className="row"><input className="input grow" value={name} onChange={(e) => setName(e.target.value)} /><button type="button" className="btn small-btn" disabled={busy || !name.trim() || name === u.name} onClick={() => run(() => renameUser(u, name.trim()), '已改名')}>儲存</button></div>
            </label>
            <div className="field"><span>牌友圈</span>
              <div className="list">
                {u.groups.map((g) => (
                  <div key={g} className="listrow">
                    <span className="grow">{gName(g)}</span>
                    <button type="button" className="btn plain small-btn remove-btn" disabled={busy} onClick={() => run(() => removeFromGroup(u.uid, g, u.groups), '已移出')}>移出</button>
                  </div>
                ))}
                {!u.groups.length && <p className="muted pad">未有牌友圈。</p>}
              </div>
              <div className="row">
                <select className="input grow" value={addG} onChange={(e) => setAddG(e.target.value)} aria-label="加入牌友圈">
                  <option value="">加入牌友圈…</option>
                  {groups.filter((g) => !u.groups.includes(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button type="button" className="btn small-btn" disabled={busy || !addG} onClick={() => run(() => addToGroup(u, addG), '已加入')}>加入</button>
              </div>
            </div>
          </div>
        )}
        {msg && <p className="ok">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}

function DataBrowser({ path, setPath }: { path: string; setPath: (p: string) => void }) {
  const segs = path.split('/').filter(Boolean);
  const isDoc = segs.length > 0 && segs.length % 2 === 0;
  const [input, setInput] = useState(path);
  const [list, setList] = useState<{ id: string; preview: string }[] | null>(null);
  const [json, setJson] = useState('');
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [newId, setNewId] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { setInput(path); }, [path]);
  useEffect(() => {
    let alive = true;
    setErr(''); setMsg(''); setList(null);
    if (!segs.length) return;
    (isDoc
      ? readDoc(path).then((d) => { if (!alive) return; setExists(!!d); setJson(JSON.stringify(d ?? {}, null, 2)); })
      : listCollection(path).then((l) => { if (alive) setList(l); })
    ).catch((e) => alive && setErr(message(e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);
  const crumbs = useMemo(() => segs.map((s, i) => ({ label: s, path: segs.slice(0, i + 1).join('/') })), [segs]);
  const kids = isDoc ? childCollections(path) : [];
  let valid = true;
  try { JSON.parse(json || '{}'); } catch { valid = false; }
  async function run(t: () => Promise<void>, done: string) {
    setBusy(true); setErr(''); setMsg('');
    try { await t(); setMsg(done); setTick((x) => x + 1); } catch (e) { setErr(message(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); setPath(input.trim().replace(/^\/+|\/+$/g, '')); }}>
        <input className="input grow mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="路徑，例如 groups 或 groups/ID/sessions" aria-label="路徑" />
        <button type="submit" className="btn small-btn">開</button>
      </form>
      <div className="crumbs">
        <button type="button" className="textbtn" onClick={() => setPath('groups')}>groups</button>
        <button type="button" className="textbtn" onClick={() => setPath('users')}>users</button>
        <button type="button" className="textbtn" onClick={() => setPath('codes')}>codes</button>
        <span className="muted">｜</span>
        {crumbs.map((c) => <button key={c.path} type="button" className="textbtn mono" onClick={() => setPath(c.path)}>{c.label}/</button>)}
      </div>
      {err && <p className="error">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      {!isDoc && list && (
        <>
          <div className="list">
            {list.map((d) => (
              <button key={d.id} type="button" className="listrow admin-row" onClick={() => setPath(`${path}/${d.id}`)}>
                <span className="grow exp-text"><span className="mono">{d.id}</span>{d.preview && <small className="muted">{d.preview}</small>}</span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            ))}
            {!list.length && <p className="muted pad">呢個集合係空嘅。</p>}
          </div>
          <div className="row">
            <input className="input grow mono" value={newId} onChange={(e) => setNewId(e.target.value.replace(/[/\s]/g, ''))} placeholder="新文件 id" aria-label="新文件 id" />
            <button type="button" className="btn small-btn" disabled={!newId} onClick={() => { setPath(`${path}/${newId}`); setNewId(''); }}>新增</button>
          </div>
        </>
      )}
      {isDoc && (
        <>
          {kids.length > 0 && (
            <div className="crumbs">
              <span className="muted small">下面嘅集合：</span>
              {kids.map((k) => <button key={k} type="button" className="pill" onClick={() => setPath(`${path}/${k}`)}>{k}</button>)}
            </div>
          )}
          {!exists && <p className="muted small">呢份文件未有，儲存就會新增。</p>}
          <textarea className="input mono json-edit" rows={18} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label="文件內容 JSON" />
          <p className="muted small">時間寫做 {'{"__time": 毫秒}'}。儲存會成份文件換晒。</p>
          <div className="row">
            <button type="button" className="btn grow" disabled={busy || !valid} onClick={() => run(() => writeDoc(path, json), '已儲存')}>{valid ? '儲存' : 'JSON 格式唔啱'}</button>
            {exists && <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirmDel(true)}>刪除</button>}
          </div>
        </>
      )}
      {confirmDel && (
        <ConfirmDelete
          title="刪除文件"
          detail={`永久刪除 ${path}（下面嘅集合唔會自動刪）。`}
          word={segs[segs.length - 1]}
          onConfirm={async () => { await removeDoc(path); setPath(segs.slice(0, -1).join('/')); }}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </div>
  );
}
