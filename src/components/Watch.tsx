// 背景睇住自己所有牌友圈：番數表有新版本就提示（畫面頂）同埋（app 喺背景時）彈系統通知
import { useEffect } from 'react';
import { useGroup, useMeetups, useProfile } from '../lib/live.ts';
import { meetupWhen } from './Meetups.tsx';
import { markSeen, pushNotice, seenAt, systemNotify, useNotices } from '../lib/notify.ts';
import { go } from '../lib/router.tsx';

function FanWatch({ g, uid }: { g: string; uid: string }) {
  const { data } = useGroup(g);
  const log = data?.fanTableLog;
  useEffect(() => {
    if (!data || !log?.at || log.by === uid || log.at <= seenAt(g)) return;
    const shown = log.changes.slice(0, 3).join('、');
    const more = log.changes.length > 3 ? ` 等 ${log.changes.length} 項` : '';
    const n = {
      g,
      at: log.at,
      title: `「${data.name}」番數表已更新`,
      body: `${log.byName || '局主'}：${shown || '有修改'}${more}`,
      url: `/g/${g}/rules#fans`,
    };
    pushNotice(n);
    systemNotify(n);
  }, [g, uid, data, log?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** 約局：有人約新局、或者三缺一而你未應，就提你（鬼馬少少） */
function MeetupWatch({ g, uid }: { g: string; uid: string }) {
  const group = useGroup(g);
  const { data } = useMeetups(g);
  useEffect(() => {
    const name = group.data?.name;
    if (!name) return;
    for (const m of data) {
      if (m.at < Date.now()) continue;
      const answered = m.going.includes(uid) || m.maybe.includes(uid) || m.no.includes(uid);
      if (answered) continue;
      const n = m.going.length;
      const key = `${g}:meetup:${m.id}`;
      // 三缺一用另一個版本號，咁之前睇過「新約局」都會再提一次
      const at = n % 4 === 3 ? m.createdAt + n : m.createdAt;
      if (m.by === uid || at <= seenAt(key)) continue;
      const line = n % 4 === 3 ? '三缺一！就差你 🔥' : n === 2 ? '二缺二，快啲應' : n === 1 ? '一缺三，嚟撐場' : n >= 4 ? '已經夠腳，仲可以開多枱' : '有人約局';
      const notice = {
        g: key,
        at,
        title: `「${name}」${line}`,
        body: `${m.byName || '有人'} 約 ${meetupWhen(m.at)}${m.place ? `・${m.place}` : ''}`,
        url: `/g/${g}#meetups`,
      };
      pushNotice(notice);
      systemNotify(notice);
    }
  }, [g, uid, group.data?.name, data]);
  return null;
}

export function GroupWatchers({ uid }: { uid: string }) {
  const profile = useProfile(uid);
  return <>{profile.data.groups.map((g) => <FanWatch key={g} g={g} uid={uid} />)}{profile.data.groups.map((g) => <MeetupWatch key={`m-${g}`} g={g} uid={uid} />)}</>;
}

export function NoticeBar() {
  const list = useNotices();
  const n = list[list.length - 1];
  if (!n) return null;
  return (
    <div className="notice" role="status">
      <div className="grow">
        <b>{n.title}</b>
        <small>{n.body}</small>
      </div>
      <button type="button" className="btn small-btn" onClick={() => { markSeen(n.g, n.at); go(n.url); }}>查看</button>
      <button type="button" className="iconbtn small" aria-label="關閉" onClick={() => markSeen(n.g, n.at)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}
