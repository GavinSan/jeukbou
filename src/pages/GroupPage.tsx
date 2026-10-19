import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { approveJoin, deleteGroup, deleteSession, ensureJoinCode, rejectJoin, removeMember, resetInvite, setJoinMode, legacyMap } from '../lib/data.ts';
import type { Group, JoinMode, JoinRequest } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { go } from '../lib/router.tsx';
import { useGroup, useJoinRequests, useMembers, useSessions } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { Avatar, ConfirmDelete, CopyLink, Hint, Loading, TopBar, message } from '../ui.tsx';
import { SettingsButton } from '../components/Settings.tsx';
import { Leaderboard } from '../components/Charts.tsx';
import { useBoard } from '../lib/history.ts';

const MODES: { key: JoinMode; label: string; note: string }[] = [
  { key: 'auto', label: '自動加入', note: '有加入碼或連結就可以直接加入' },
  { key: 'approve', label: '要批准', note: '申請後要局主批准' },
  { key: 'closed', label: '不收新人', note: '暫停接收新成員' },
];

/** 加入申請（局主先見到） */
function JoinRequests({ groupId }: { groupId: string }) {
  const reqs = useJoinRequests(groupId);
  return <JoinRequestsView reqs={reqs.data} onApprove={(r) => approveJoin(groupId, r)} onReject={(r) => rejectJoin(groupId, r.uid)} />;
}

export function JoinRequestsView({ reqs, onApprove, onReject }: { reqs: JoinRequest[]; onApprove: (r: JoinRequest) => Promise<void>; onReject: (r: JoinRequest) => Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!reqs.length) return null;
  const run = async (id: string, task: () => Promise<void>) => {
    setBusy(id); setError('');
    try { await task(); } catch (err) { setError(message(err)); } finally { setBusy(''); }
  };
  return (
    <section className="panel join-reqs" aria-label="加入申請">
      <h2>加入申請（{reqs.length}）</h2>
      {reqs.map((r) => (
        <div key={r.uid} className="row join-req">
          <Avatar name={r.name} photo={r.photoURL} size="sm" />
          <span className="grow ellipsis">{r.name}</span>
          <button type="button" className="btn plain small-btn" disabled={!!busy} onClick={() => run(r.uid, () => onReject(r))}>拒絕</button>
          <button type="button" className="btn small-btn" disabled={!!busy} onClick={() => run(r.uid, () => onApprove(r))}>{busy === r.uid ? '…' : '批准'}</button>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** 邀請：加入碼、連結、加入方式 */
export function Invite({ g, canManage, onMode }: { g: Group; canManage: boolean; onMode?: (m: JoinMode) => void }) {
  const [error, setError] = useState('');
  const [resetArmed, setResetArmed] = useState(false);
  const mode = g.joinMode ?? 'auto';
  useEffect(() => {
    if (canManage && !g.joinCode) ensureJoinCode(g, g.name).catch((err) => setError(message(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, g.joinCode, g.inviteCode]);
  const invite = `${window.location.origin}/join/${g.id}/${g.inviteCode}`;
  const share = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    ? () => navigator.share({ title: '雀簿', text: `加入我的雀簿牌友圈「${g.name}」${g.joinCode ? `，加入碼 ${g.joinCode}` : ''}`, url: invite }).catch(() => undefined)
    : null;
  return (
    <div className="stack invite">
      {mode === 'closed' ? (
        <p className="muted small">此牌友圈暫停接收新成員。</p>
      ) : (
        <>
          <div className="join-code">
            <span className="muted small">加入碼</span>
            <b className="code num" aria-label={`加入碼 ${g.joinCode ?? ''}`}>{g.joinCode ?? '······'}</b>
          </div>
          <Hint>{mode === 'approve' ? '牌友在首頁按「新增」輸入加入碼，或打開連結申請；局主批准後加入。' : '牌友在首頁按「新增」輸入加入碼，或打開連結，即可加入。'}</Hint>
          <div className="row invite-btns">
            {g.joinCode && <CopyLink url={g.joinCode} label="複製加入碼" />}
            <CopyLink url={invite} />
            {share && <button type="button" className="btn plain" onClick={share}>分享</button>}
          </div>
        </>
      )}
      {canManage && (
        <div className="stack tight">
          <span className="small muted">加入方式</span>
          <div className="seg wide" role="radiogroup" aria-label="加入方式">
            {MODES.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} aria-pressed={mode === m.key} onClick={() => (onMode ? onMode(m.key) : setJoinMode(g.id, m.key).catch((err) => setError(message(err))))}>{m.label}</button>
            ))}
          </div>
          <Hint>{MODES.find((m) => m.key === mode)?.note}</Hint>
          <button
            type="button"
            className="textbtn loss"
            onClick={() => {
              if (!resetArmed) { setResetArmed(true); setTimeout(() => setResetArmed(false), 4000); return; }
              setResetArmed(false);
              resetInvite(g).catch((err) => setError(message(err)));
            }}
          >{resetArmed ? '再按一次確認：舊連結和加入碼會即時失效' : '重設連結及加入碼'}</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function GroupPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const sessions = useSessions(groupId);
  const memberNames = Object.fromEntries(members.data.map((m) => [m.uid, m.name]));
  const board = useBoard(group.data, sessions.loading ? [] : sessions.data, memberNames, legacyMap(group.data, members.data));
  const admin = useSuperAdmin(user.uid);
  const [manage, setManage] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; detail: string; word: string; run: () => Promise<void> }>(null);

  if (group.error) return <main className="page"><TopBar back="/" /><p className="error">{group.error}</p></main>;
  if (!group.data) return <main className="page"><TopBar back="/" /><Loading /></main>;

  const g = group.data;
  const list = [...sessions.data].reverse();
  const shown = showAllSessions ? list : list.slice(0, 8);
  const hasLegacy = !!g.legacyNames && Object.keys(g.legacyNames).length > 0;
  const lmap = legacyMap(g, members.data);
  const claimed = Object.values(lmap).includes(user.uid);
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

      {canManage && <JoinRequests groupId={groupId} />}

      {hasLegacy && !claimed && (
        <Link to={`/g/${groupId}/players`} className="banner calm">
          <span className="grow">已匯入舊紀錄：按此選擇你的名字，以前的數會計入你的帳戶。</span>
        </Link>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>大局</h2>
          {canManage && list.length > 0 && <button type="button" className="textbtn" onClick={() => setManage((v) => !v)}>{manage ? '完成' : '管理'}</button>}
        </div>
        {list.length ? (
          <div className="list">
            {shown.map((s) => (
              <div key={s.id} className="listrow-wrap">
                <Link to={`/g/${groupId}/s/${s.id}`} className="listrow">
                  <span className="grow">{s.name}{s.legacy && <span className="tag instant">舊</span>}</span>
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
        {list.length > 8 && <button type="button" className="textbtn" onClick={() => setShowAllSessions((v) => !v)}>{showAllSessions ? '收起' : `顯示全部 ${list.length} 個大局`}</button>}
      </section>

      {board.rows.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2>龍虎榜</h2>
            <Link to={`/g/${groupId}/board`} className="textbtn">按日／週／月查看</Link>
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
        <Invite g={g} canManage={canManage} />
        {canManage && !manage && <button type="button" className="textbtn" onClick={() => setManage(true)}>管理成員</button>}
        {hasLegacy && <Link to={`/g/${groupId}/players`} className="textbtn">對應舊紀錄玩家</Link>}
        {canManage && <Link to={`/g/${groupId}/import`} className="textbtn">匯入舊紀錄</Link>}
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
