import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { PERMS, paidState, settleConfigOf, approveJoin, createMeetup, deleteMeetup, rsvpMeetup, canDo, deleteGroup, deleteSession, ensureJoinCode, rejectJoin, removeMember, resetInvite, setJoinMode, setMemberPerms, updateGroupProfile, legacyMap } from '../lib/data.ts';
import type { Perm } from '../lib/data.ts';
import { toAvatar } from '../lib/avatar.ts';
import GroupIcon from '../components/GroupIcon.tsx';
import type { Group, JoinMode, JoinRequest, Member } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { go } from '../lib/router.tsx';
import { useGroup, useJoinRequests, useMeetups, useMembers, useSessions } from '../lib/live.ts';
import { pingMeetup } from '../lib/fns.ts';
import { MeetupsView } from '../components/Meetups.tsx';
import { Link } from '../lib/router.tsx';
import { Avatar, ConfirmDelete, Hint, Loading, Sheet, TopBar, fmt, message } from '../ui.tsx';
import { rulesOf } from '../lib/score.ts';
import { Leaderboard } from '../components/Charts.tsx';
import { boardRows, useHistory } from '../lib/history.ts';
import type { SessionResult } from '../lib/history.ts';
import { money } from '../components/SettleScreen.tsx';
import { PlayerSheet } from '../components/BoardView.tsx';
import { TierChip } from '../components/Tier.tsx';
import { pointsFor, tierOf } from '../lib/stats.ts';

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

/** 複製文字；唔得就俾人自己揀 */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function inviteMessage(g: Pick<Group, 'id' | 'name' | 'inviteCode' | 'joinCode' | 'joinMode'>, origin = window.location.origin): string {
  const link = `${origin}/join/${g.id}/${g.inviteCode}`;
  return [
    '一齊用「雀簿」計麻雀數！',
    `撳連結加入牌友圈「${g.name}」${g.joinMode === 'approve' ? '（要局主批准）' : ''}：`,
    link,
    g.joinCode ? `或者喺雀簿首頁按「新增」，輸入加入碼 ${g.joinCode}` : '',
  ].filter(Boolean).join('\n');
}

/** 邀請（局主）：撳加入碼即複製；一個掣複製成段邀請訊息；加入方式 */
export function Invite({ g, canManage, onMode }: { g: Group; canManage: boolean; onMode?: (m: JoinMode) => void }) {
  const [error, setError] = useState('');
  const [resetArmed, setResetArmed] = useState(false);
  const [copied, setCopied] = useState<'' | 'code' | 'msg'>('');
  const [manual, setManual] = useState('');
  const mode = g.joinMode ?? 'auto';
  useEffect(() => {
    if (canManage && !g.joinCode) ensureJoinCode(g, g.name).catch((err) => setError(message(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, g.joinCode, g.inviteCode]);

  async function copy(kind: 'code' | 'msg', text: string) {
    if (await copyText(text)) {
      setManual('');
      setCopied(kind);
      setTimeout(() => setCopied(''), 1800);
    } else setManual(text);
  }

  return (
    <div className="stack invite">
      {mode === 'closed' ? (
        <p className="muted small">暫停接收新成員。</p>
      ) : (
        <>
          <button type="button" className="join-code" disabled={!g.joinCode} onClick={() => g.joinCode && copy('code', g.joinCode)} aria-label={`加入碼 ${g.joinCode ?? ''}，撳一下複製`}>
            <span className="join-code-label">加入碼<small>撳一下複製</small></span>
            <b className="code num">{g.joinCode ?? '······'}</b>
            <span className={`copied-flag${copied === 'code' ? ' on' : ''}`} aria-hidden={copied !== 'code'}>已複製</span>
          </button>
          <button type="button" className={`btn plain invite-copy${copied === 'msg' ? ' done' : ''}`} onClick={() => copy('msg', inviteMessage(g))}>
            {copied === 'msg' ? '已複製邀請訊息' : '複製邀請訊息'}
          </button>
          <Hint>訊息有連結同加入碼，貼去 WhatsApp 就得。</Hint>
          {manual && <textarea className="input copybox" readOnly rows={4} value={manual} onFocus={(e) => e.currentTarget.select()} aria-label="邀請訊息" />}
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

const ICONS = ['🀄', '🀅', '🎲', '🐉', '🐯', '🍵', '🏮', '🧧', '💰', '🔥', '🌸', '⭐', '🐼', '🍀', '🌙', '🎯'];

/** 冇寫簡介：由家規自動出一句（例如「用水：25 抽 1」） */
export function autoDescription(g: Group): string {
  const w = rulesOf(g, null).water;
  return w.enabled && w.per > 0 && w.take > 0 ? `用水：${w.per} 抽 ${w.take}` : '唔抽水';
}

/** 牌友圈頂：icon、名、簡介（冇就用家規自動出）、公開／私人；改就撳右上角齒輪 */
function GroupHeader({ g, memberCount }: { g: Group; memberCount: number }) {
  return (
    <section className="group-head">
      <GroupIcon icon={g.icon} name={g.name} size={52} />
      <span className="grow">
        <span className="group-head-tags">
          <span className={`tag ${g.visibility === 'public' ? 'new' : 'instant'}`}>{g.visibility === 'public' ? '公開' : '私人'}</span>
          <span className="muted small">{memberCount} 個成員</span>
        </span>
        <p className={`group-desc${g.description ? '' : ' auto'}`}>{g.description || autoDescription(g)}</p>
      </span>
    </section>
  );
}

export interface WaterRow { id: string; name: string; fan: number; n: number }

/** 抽水：每個保管水嘅人收咗幾多（已埋數嘅大局）；未埋數嘅另外講 */
export function waterRowsOf(sessions: SessionResult[], name: (id: string) => string): { rows: WaterRow[]; pending: number } {
  const acc = new Map<string, WaterRow>();
  let pending = 0;
  for (const s of sessions) {
    if (!s.water || !s.waterTo) continue;
    if (!s.closed) { pending += s.water; continue; }
    const r = acc.get(s.waterTo) ?? { id: s.waterTo, name: name(s.waterTo), fan: 0, n: 0 };
    r.fan += s.water;
    r.n += 1;
    acc.set(s.waterTo, r);
  }
  return { rows: [...acc.values()].sort((a, b) => b.fan - a.fan), pending };
}

export function WaterBox({ rows, pending, me, perUnit }: { rows: WaterRow[]; pending: number; me: string; perUnit: number }) {
  const cash = (fan: number) => (perUnit > 0 ? ` ≈ ${money(fan / perUnit)}` : '');
  return (
    <section className="water-box" aria-label="抽水">
      <b>水（抽水）</b>
      {rows.length ? (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className={`listrow${r.id === me ? ' me' : ''}`}>
              <span className="grow">{r.id === me ? '你' : r.name} 保管<small className="muted">　{r.n} 場</small></span>
              <b className="num">{r.fan} 番</b><small className="muted">{cash(r.fan)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="muted small">已埋數嘅大局未有抽水。</p>}
      {pending > 0 && <small className="muted">未埋數嘅大局仲有 {pending} 番水，埋咗數先計入。</small>}
    </section>
  );
}

/** 牌友圈設定：名、icon、簡介、公開／私人、家規；局主改得，其他人睇 */
function GroupSettingsSheet({ g, canEdit, memberCount, onClose, water }: { g: Group; canEdit: boolean; memberCount: number; onClose: () => void; water?: ReactNode }) {
  const [name, setName] = useState(g.name);
  const [icon, setIcon] = useState(g.icon ?? '');
  const [desc, setDesc] = useState(g.description ?? '');
  const [vis, setVis] = useState<'public' | 'private'>(g.visibility === 'public' ? 'public' : 'private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const links = (
    <div className="list">
      <Link to={`/g/${g.id}/rules`} className="listrow"><span className="grow">家規<small className="muted">　番數表、抽水、拉、埋數</small></span><span className="chev" aria-hidden="true">›</span></Link>
      <Link to={`/g/${g.id}/board`} className="listrow"><span className="grow">龍虎榜</span><span className="chev" aria-hidden="true">›</span></Link>
      <Link to={`/g/${g.id}/pay`} className="listrow"><span className="grow">埋數（所有大局）</span><span className="chev" aria-hidden="true">›</span></Link>
      <Link to="/settings" className="listrow"><span className="grow">我嘅設定<small className="muted">　頭像、名、聲效、通知</small></span><span className="chev" aria-hidden="true">›</span></Link>
    </div>
  );
  if (!canEdit) {
    return (
      <Sheet onClose={onClose} label="牌友圈設定">
        <div className="row"><GroupIcon icon={g.icon} name={g.name} size={44} /><h2 className="grow">{g.name}</h2></div>
        <p className="muted">{g.description || autoDescription(g)}・{g.visibility === 'public' ? '公開' : '私人'}・{memberCount} 個成員</p>
        <Hint>淨係局主改得牌友圈資料。</Hint>
        {water}
        {links}
      </Sheet>
    );
  }
  return (
    <Sheet onClose={onClose} label="牌友圈設定">
      <h2>牌友圈設定</h2>
      <label className="field">
        <span>名</span>
        <input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>Icon</span>
        <div className="icon-pick">
          {ICONS.map((x) => <button key={x} type="button" className="icon-opt" aria-pressed={icon === x} onClick={() => setIcon(x)}>{x}</button>)}
          <label className="icon-opt upload" title="用相">
            {icon.startsWith('data:') ? <img src={icon} alt="" /> : '📷'}
            <input type="file" accept="image/*" className="visually-hidden" aria-label="上載 icon 相" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { setIcon(await toAvatar(f)); } catch (err) { setError(message(err)); } } }} />
          </label>
          {icon && <button type="button" className="textbtn" onClick={() => setIcon('')}>用名</button>}
        </div>
      </div>
      <label className="field">
        <span>簡介</span>
        <textarea className="input" rows={3} maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={`唔寫就自動顯示「${autoDescription(g)}」`} />
      </label>
      <div className="field">
        <span>邊個搵得到</span>
        <div className="seg wide" role="radiogroup" aria-label="公開定私人">
          <button type="button" role="radio" aria-checked={vis === 'private'} aria-pressed={vis === 'private'} onClick={() => setVis('private')}>私人</button>
          <button type="button" role="radio" aria-checked={vis === 'public'} aria-pressed={vis === 'public'} onClick={() => setVis('public')}>公開</button>
        </div>
        <Hint>{vis === 'public' ? '其他人喺「牌友圈」搜尋得到；入唔入到仍然跟加入方式（自動／要批准／不收新人）。' : '要有邀請連結或者加入碼先加入到。'}</Hint>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true); setError('');
        try { await updateGroupProfile(g, { name, icon, description: desc, visibility: vis }, memberCount); onClose(); } catch (err) { setError(message(err)); setBusy(false); }
      }}>儲存</button>
      {water}
      {links}
    </Sheet>
  );
}

/** 局主分配成員權限 */
function PermsSheet({ groupId, m, onClose }: { groupId: string; m: Member; onClose: () => void }) {
  const [perms, setPerms] = useState<Perm[]>(m.perms ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Sheet onClose={onClose} label="成員權限">
      <h2>{m.name} 嘅權限</h2>
      <div className="list flat">
        {PERMS.map((p) => (
          <div key={p.key} className="rule-row">
            <span className="grow">{p.label}<small>{p.note}</small></span>
            <button type="button" role="switch" className="switch" aria-checked={perms.includes(p.key)} aria-label={p.label} onClick={() => setPerms((l) => (l.includes(p.key) ? l.filter((x) => x !== p.key) : [...l, p.key]))} />
          </div>
        ))}
      </div>
      <Hint>局主一定乜都做得。開大局、入數、埋數、開支所有成員都做得。</Hint>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await setMemberPerms(groupId, m.uid, perms); onClose(); } catch (err) { setError(message(err)); setBusy(false); }
      }}>儲存</button>
    </Sheet>
  );
}

/** 今個月生日：同一個星期嘅標出嚟，方便一齊慶祝 */
export function Birthdays({ members }: { members: Member[] }) {
  const now = new Date();
  const m = now.getMonth() + 1;
  const list = members
    .filter((x) => x.birthday && Number(x.birthday.slice(0, 2)) === m)
    .map((x) => ({ ...x, d: Number(x.birthday!.slice(3, 5)) }))
    .sort((a, b) => a.d - b.d);
  if (!list.length) return null;
  const week = (d: number) => {
    const day = new Date(now.getFullYear(), m - 1, d);
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return day >= start && day < end;
  };
  return (
    <section className="stack">
      <h2 className="section-head">{m} 月生日 🎂</h2>
      <div className="bday-row">
        {list.map((x) => (
          <span key={x.uid} className={`bday-chip${week(x.d) ? ' week' : ''}`}>
            <b>{x.name}</b><small>{m}月{x.d}日{week(x.d) ? '・今個星期' : ''}</small>
          </span>
        ))}
      </div>
    </section>
  );
}

export interface MemberStat {
  played: number;
  total: number;
  points: number;
  /** 最近一次打牌（毫秒） */
  last?: number;
}

const lastTxt = (t: number) => {
  const d = new Date(t);
  const days = Math.floor((Date.now() - t) / 86400000);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return days <= 0 ? '今日' : days === 1 ? '琴日' : days < 7 ? `${days} 日前` : d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`;
};

/** 每個人喺呢堆大局入面：場數、總數、雀力分、最近一次 */
export function memberStatsOf(sessions: { at: number; totals: Record<string, number> }[], points: (id: string) => number): Record<string, MemberStat> {
  const out: Record<string, MemberStat> = {};
  for (const s of sessions) {
    for (const [id, v] of Object.entries(s.totals)) {
      const row = out[id] ?? { played: 0, total: 0, points: 0, last: 0 };
      row.played += 1;
      row.total += v;
      row.last = Math.max(row.last ?? 0, s.at);
      out[id] = row;
    }
  }
  for (const id of Object.keys(out)) out[id].points = points(id);
  return out;
}

/** 成員：一行一個，有場數、段位、總數；撳入去睇佢喺呢個牌友圈嘅統計 */
export function MemberList({ members, ownerId, stats, manage, onPick, onRemove, onPerms }: {
  members: Member[]; ownerId: string; stats: Record<string, MemberStat>; manage: boolean;
  onPick: (uid: string) => void; onRemove?: (m: Member) => void; onPerms?: (m: Member) => void;
}) {
  // 最近有打嘅排前，之後按雀力分
  const sorted = [...members].sort((a, b) => (stats[b.uid]?.last ?? 0) - (stats[a.uid]?.last ?? 0) || (stats[b.uid]?.points ?? 0) - (stats[a.uid]?.points ?? 0) || a.name.localeCompare(b.name));
  return (
    <ul className="list member-list">
      {sorted.map((m) => {
        const st = stats[m.uid];
        return (
          <li key={m.uid} className="member-row">
            <button type="button" className="member-main" onClick={() => onPick(m.uid)} disabled={!st?.played} aria-label={`${m.name} 統計`}>
              <Avatar name={m.name} photo={m.photoURL} size="md" />
              <span className="grow member-text">
                <span className="ellipsis">{m.name}{m.uid === ownerId ? <span className="tag instant">局主</span> : m.perms?.length ? <span className="tag stay" title={m.perms.map((p) => PERMS.find((x) => x.key === p)?.label).join('、')}>管理</span> : null}</span>
                <small className="muted member-meta">
                  {st?.played ? <><TierChip tier={tierOf(st.points).tier} /><span className="num">{st.points} 分</span><span>・打咗 {st.played} 次</span>{st.last ? <span>・{lastTxt(st.last)}</span> : null}</> : '未有紀錄'}
                </small>
              </span>
              {st?.played ? <b className={`num member-total ${st.total > 0 ? 'gain' : st.total < 0 ? 'loss' : ''}`}>{fmt(st.total)}</b> : null}
            </button>
            {manage && m.uid !== ownerId && onPerms && (
              <button type="button" className="btn plain small-btn" onClick={() => onPerms(m)}>權限{m.perms?.length ? `（${m.perms.length}）` : ''}</button>
            )}
            {manage && m.uid !== ownerId && onRemove && (
              <button type="button" className="btn plain small-btn remove-btn" onClick={() => onRemove(m)}>移除</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function GroupPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const sessions = useSessions(groupId);
  const meetups = useMeetups(groupId);
  const memberNames = Object.fromEntries(members.data.map((m) => [m.uid, m.name]));
  const history = useHistory(group.data, sessions.loading ? [] : sessions.data, memberNames, legacyMap(group.data, members.data));
  const board = { rows: boardRows(history.sessions, history.names) };
  const admin = useSuperAdmin(user.uid);
  const [manage, setManage] = useState(false);
  const [manageMembers, setManageMembers] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; detail: string; word: string; run: () => Promise<void> }>(null);
  const [permFor, setPermFor] = useState<Member | null>(null);
  const [groupSettings, setGroupSettings] = useState(false);

  if (group.error) return <main className="page"><TopBar back="/groups" /><p className="error">{group.error}</p></main>;
  if (!group.data) return <main className="page"><TopBar back="/groups" /><Loading /></main>;

  const g = group.data;
  const list = [...sessions.data].reverse();
  const shown = showAllSessions ? list : list.slice(0, 8);
  const hasLegacy = !!g.legacyNames && Object.keys(g.legacyNames).length > 0;
  const lmap = legacyMap(g, members.data);
  const claimed = Object.values(lmap).includes(user.uid);
  const canManage = g.ownerId === user.uid || admin;
  const meM = members.data.find((m) => m.uid === user.uid);
  const canApprove = canDo(g, meM, user.uid, admin, 'approve');
  const canRemove = canDo(g, meM, user.uid, admin, 'remove');
  const canRecords = canDo(g, meM, user.uid, admin, 'records');
  const memberStats = memberStatsOf(history.sessions, (id) => pointsFor(id, history.sessions));

  return (
    <main className="page">
      <TopBar back="/groups" title={g.name} right={(
        <button type="button" className="iconbtn" aria-label="牌友圈設定" onClick={() => setGroupSettings(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      )} />
      <GroupHeader g={g} memberCount={members.data.length} />
      {groupSettings && (
        <GroupSettingsSheet
          g={g}
          canEdit={canManage}
          memberCount={members.data.length}
          onClose={() => setGroupSettings(false)}
          water={(() => {
            // 淨係局主、超級管理員睇晒；保管水嘅人睇到自己嗰份；其他人唔顯示
            const w = waterRowsOf(history.sessions, (id) => memberNames[id] ?? history.names[id] ?? '玩家');
            const rows = canManage ? w.rows : w.rows.filter((r) => r.id === user.uid);
            if (!rows.length && !canManage) return null;
            return <WaterBox rows={rows} pending={canManage ? w.pending : 0} me={user.uid} perUnit={settleConfigOf(g).perUnit} />;
          })()}
        />
      )}

      <section className="stack">
        <Link to={`/g/${groupId}/new`} className="btn big">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          開大局
        </Link>
      </section>

      {canApprove && <JoinRequests groupId={groupId} />}

      <MeetupsView
        list={meetups.data}
        me={user.uid}
        ownerOrAdmin={canManage}
        onCreate={(m) => createMeetup(groupId, user, m)}
        onRsvp={(id, st) => rsvpMeetup(groupId, id, user, st)}
        onDelete={(id) => deleteMeetup(groupId, id)}
        onPing={async (id) => { const r = await pingMeetup(groupId, id); return r.people ? `已經通知 ${r.people} 個未應嘅人` : '全部人都應咗，冇人要問'; }}
      />

      {hasLegacy && !claimed && (
        <Link to={`/g/${groupId}/players`} className="banner calm">
          <span className="grow">已匯入舊紀錄：按此選擇你的名字，以前的數會計入你的帳戶。</span>
        </Link>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>大局</h2>
          {canRecords && list.length > 0 && <button type="button" className="textbtn" onClick={() => setManage((v) => !v)}>{manage ? '完成' : '管理'}</button>}
        </div>
        {list.length ? (
          <div className="list">
            {shown.map((s) => (
              <div key={s.id} className="listrow-wrap">
                <Link to={`/g/${groupId}/s/${s.id}`} className="listrow">
                  <span className="grow">{s.name}{s.legacy && <span className="tag instant">舊</span>}{(() => {
                    if (!s.closed) return <span className="pay-status live">進行中</span>;
                    const ts = s.payout?.transfers ?? [];
                    if (!ts.length) return null;
                    const done = ts.filter((t) => paidState(s.paid?.[`${t.from}>${t.to}`]) === 'done').length;
                    return done >= ts.length ? <span className="pay-status done">已找清</span> : <span className="pay-status">待找數 {done}/{ts.length}</span>;
                  })()}</span>
                  <span className="muted small">{s.createdAt ? s.createdAt.toDate().toLocaleDateString('zh-HK') : ''}</span>
                  {!manage && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>}
                </Link>
                {manage && (
                  <button
                    type="button"
                    className="row-del"
                    aria-label={`刪除 ${s.name}`}
                    onClick={() => setConfirm({ title: '刪除大局', detail: `會永久刪除「${s.name}」所有枱、每一鋪、開支同 Group，無法復原。`, word: s.name, run: () => deleteSession(groupId, s.id) })}
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
            <Link to={`/g/${groupId}/board`} className="textbtn">按日／月／季／年查看</Link>
          </div>
          <div className="list pad">
            <Leaderboard rows={board.rows} me={user.uid} />
          </div>
        </section>
      )}


      <Birthdays members={members.data} />

      <section className="stack">
        <div className="section-head">
          <h2>成員（{members.data.length}）</h2>
          {(canManage || canRemove) && <button type="button" className="textbtn" onClick={() => setManageMembers((v) => !v)}>{manageMembers ? '完成' : '管理'}</button>}
        </div>
        <MemberList
          members={members.data}
          ownerId={g.ownerId}
          stats={memberStats}
          manage={manageMembers}
          onPick={setPick}
          onRemove={canRemove ? (m) => setConfirm({ title: '移除成員', detail: `${m.name} 會離開牌友圈，佢以前嘅紀錄會保留。`, word: m.name, run: () => removeMember(groupId, m.uid) }) : undefined}
          onPerms={canManage ? setPermFor : undefined}
        />
        {permFor && <PermsSheet groupId={groupId} m={permFor} onClose={() => setPermFor(null)} />}
      </section>

      {canManage && (
        <section className="panel">
          <h2>邀請牌友</h2>
          <Invite g={g} canManage={canManage} />
          <div className="row wrap-row">
            {hasLegacy && <Link to={`/g/${groupId}/players`} className="textbtn">對應舊紀錄玩家</Link>}
            <Link to={`/g/${groupId}/import`} className="textbtn">匯入舊紀錄</Link>
          </div>
        </section>
      )}

      {canManage && (
        <section className="danger-zone">
          <h3>危險操作</h3>
          <p className="muted small">{admin && g.ownerId !== user.uid ? '你以超級管理員身份操作。' : '只有局主可以做。'}</p>
          <button
            type="button"
            className="btn danger"
            onClick={() => setConfirm({ title: '刪除牌友圈', detail: `會永久刪除「${g.name}」所有大局、紀錄同成員名單，無法復原。`, word: g.name, run: async () => { await deleteGroup(groupId); go('/groups'); } })}
          >刪除牌友圈</button>
        </section>
      )}

      {pick && (
        <PlayerSheet
          id={pick}
          name={history.names[pick] || members.data.find((m) => m.uid === pick)?.name || '玩家'}
          sessions={history.sessions.filter((x) => pick in x.totals)}
          all={history.sessions.filter((x) => pick in x.totals)}
          scope={g.name}
          sessionHref={(sid) => `/g/${groupId}/s/${sid}`}
          onClose={() => setPick(null)}
        />
      )}
      {confirm && <ConfirmDelete title={confirm.title} detail={confirm.detail} word={confirm.word} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </main>
  );
}
