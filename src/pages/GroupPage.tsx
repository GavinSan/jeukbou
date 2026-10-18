import { useState } from 'react';
import type { User } from 'firebase/auth';
import { deleteGroup, deleteSession, removeMember } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { go } from '../lib/router.tsx';
import { useGroup, useMembers, useSessions } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { Avatar, ConfirmDelete, CopyLink, Hint, Loading, TopBar } from '../ui.tsx';
import { SettingsButton } from '../components/Settings.tsx';
import { Leaderboard } from '../components/Charts.tsx';
import { useBoard } from '../lib/history.ts';

export default function GroupPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const sessions = useSessions(groupId);
  const memberNames = Object.fromEntries(members.data.map((m) => [m.uid, m.name]));
  const board = useBoard(group.data, sessions.loading ? [] : sessions.data, memberNames);
  const admin = useSuperAdmin(user.uid);
  const [manage, setManage] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; detail: string; word: string; run: () => Promise<void> }>(null);

  if (group.error) return <main className="page"><TopBar back="/" /><p className="error">{group.error}</p></main>;
  if (!group.data) return <main className="page"><TopBar back="/" /><Loading /></main>;

  const g = group.data;
  const invite = `${window.location.origin}/join/${groupId}/${g.inviteCode}`;
  const list = [...sessions.data].reverse();
  const canManage = g.ownerId === user.uid || admin;

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
        <div className="section-head">
          <h2>大局</h2>
          {canManage && list.length > 0 && <button type="button" className="textbtn" onClick={() => setManage((v) => !v)}>{manage ? '完成' : '管理'}</button>}
        </div>
        {list.length ? (
          <div className="list">
            {list.map((s) => (
              <div key={s.id} className="listrow-wrap">
                <Link to={`/g/${groupId}/s/${s.id}`} className="listrow">
                  <span className="grow">{s.name}</span>
                  <span className="muted small">{s.createdAt ? s.createdAt.toDate().toLocaleDateString('zh-HK') : ''}</span>
                  {!manage && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>}
                </Link>
                {manage && (
                  <button
                    type="button"
                    className="row-del"
                    aria-label={`刪除 ${s.name}`}
                    onClick={() => setConfirm({ title: '刪除大局', detail: `會永久刪除「${s.name}」所有枱、每一鋪、開支同 GP，無法復原。`, word: s.name, run: () => deleteSession(groupId, s.id) })}
                  >刪除</button>
                )}
              </div>
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
              {manage && m.uid !== g.ownerId && (
                <button
                  type="button"
                  className="member-del"
                  aria-label={`移除 ${m.name}`}
                  onClick={() => setConfirm({ title: '移除成員', detail: `${m.name} 會離開牌友圈，佢以前嘅紀錄會保留。`, word: m.name, run: () => removeMember(groupId, m.uid) })}
                >✕</button>
              )}
            </div>
          ))}
        </div>
        <Hint>把連結傳給牌友，登入後會自動加入。</Hint>
        <CopyLink url={invite} />
        {canManage && !manage && <button type="button" className="textbtn" onClick={() => setManage(true)}>管理成員</button>}
      </section>

      {canManage && (
        <section className="danger-zone">
          <h3>危險操作</h3>
          <p className="muted small">{admin && g.ownerId !== user.uid ? '你以超級管理員身份操作。' : '只有局主可以做。'}</p>
          <button
            type="button"
            className="btn danger"
            onClick={() => setConfirm({ title: '刪除牌友圈', detail: `會永久刪除「${g.name}」所有大局、紀錄同成員名單，無法復原。`, word: g.name, run: async () => { await deleteGroup(groupId); go('/'); } })}
          >刪除牌友圈</button>
        </section>
      )}

      {confirm && <ConfirmDelete title={confirm.title} detail={confirm.detail} word={confirm.word} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </main>
  );
}
