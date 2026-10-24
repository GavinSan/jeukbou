// 主頁 Live：自己牌友圈入面打緊嘅大局；每張枱用最少嘅嘢顯示四家分數（高至低）同打到邊
import { useEffect } from 'react';
import { useGroup, useRecentSessions } from '../lib/live.ts';
import type { Group, Session } from '../lib/data.ts';
import { lastActivity, roundLabel, useSessionLive } from '../lib/sessionData.ts';
import { Link } from '../lib/router.tsx';
import { fmt } from '../ui.tsx';
import { seatWind } from '../engine/table.ts';
import GroupIcon from './GroupIcon.tsx';

const LIVE_HOURS = 8;

export interface LiveTableView {
  id: string;
  name: string;
  round: string;
  /** 跟東南西北排；wind = 門風（莊 = 東） */
  players: { id: string; name: string; v: number; wind?: string }[];
  dealer?: string | null;
  streak?: number;
}

/** 純顯示（示範都用） */
export function LiveCardView({ groupName, icon, sessionName, href, tvHref, tables, me }: {
  groupName: string; icon?: string; sessionName: string; href: string; tvHref: string; tables: LiveTableView[]; me?: string | null;
}) {
  return (
    <section className="live-card">
      <div className="live-head">
        <span className="live-pill"><i className="live-dot" aria-hidden="true" />LIVE</span>
        <GroupIcon icon={icon} name={groupName} size={26} />
        <Link to={href} className="grow live-title"><b>{groupName}</b><small>{sessionName} · {tables.length} 張枱</small></Link>
        <Link to={tvHref} className="textbtn small" ariaLabel="電視直播">📺</Link>
      </div>
      <Link to={href} className="live-tables">
        {tables.map((t) => (
          <span key={t.id} className="live-table">
            <span className="live-table-top"><b>{t.name}</b><small>{t.round}</small></span>
            <span className="live-scores">
              {t.players.map((p) => (
                <span key={p.id} className={`live-score${p.id === me ? ' me' : ''}${p.id === t.dealer ? ' dealer' : ''}`}>
                  <span className="live-name">{p.wind && <i className="live-wind">{p.wind}</i>}<span className="ellipsis">{p.name}</span></span>
                  <span className="live-v"><b className={`num ${p.v > 0 ? 'gain' : p.v < 0 ? 'loss' : ''}`}>{fmt(p.v)}</b>{p.id === t.dealer && <i className="live-dealer">莊{t.streak ? `冧${t.streak}` : ''}</i>}</span>
                </span>
              ))}
            </span>
          </span>
        ))}
      </Link>
    </section>
  );
}

type OnLive = (k: string, on: boolean, info?: { label: string }) => void;

/** 置頂條（示範都用） */
export function MyTableBar({ href, table, where, v }: { href: string; table: string; where: string; v: number }) {
  return (
    <Link to={href} className="my-table-now">
      <span className="my-table-dot" aria-hidden="true" />
      <span className="grow">
        <b>你打緊：{table}</b>
        <small>{where}</small>
      </span>
      <b className={`num ${v > 0 ? 'gain' : v < 0 ? 'loss' : ''}`}>{fmt(v)}</b>
      <span className="my-table-go">入數 ›</span>
    </Link>
  );
}

function LiveSession({ group, session, me, onLive, hidden, mineOnly }: { group: Group; session: Session; me: string; onLive: OnLive; hidden?: boolean; mineOnly?: boolean }) {
  const live = useSessionLive(group.id, session.id, group, session);
  const open = live.tables.filter((t) => { const c = live.computed[t.id]; return c && !c.state.ended; });
  const recent = Math.max(session.createdAt?.toMillis() ?? 0, ...live.tables.map((t) => lastActivity(live.computed[t.id])));
  const isLive = !session.closed && !session.legacy && open.length > 0 && Date.now() - recent < LIVE_HOURS * 3600000;
  const key = `${group.id}/${session.id}`;
  const label = `${group.name}・${session.name}`;
  useEffect(() => { if (mineOnly) return; onLive(key, isLive, { label }); return () => onLive(key, false); }, [key, isLive, onLive, label, mineOnly]);
  if (!isLive || hidden) return null;
  if (mineOnly) {
    // 置頂：自己坐緊嘅枱，一撳返去入數（唔小心閂咗 app 都唔使逐頁撳入去）
    const t = open.find((x) => live.computed[x.id]!.state.seats.includes(me));
    if (!t) return null;
    const c = live.computed[t.id]!;
    const v = c.state.settled[me] ?? 0;
    return <MyTableBar href={`/g/${group.id}/s/${session.id}/t/${t.id}`} table={t.name} where={`${group.name}・${roundLabel(c)}`} v={v} />;
  }
  const tables: LiveTableView[] = open.map((t) => {
    const c = live.computed[t.id]!;
    // 跟座位排；wind = 而家嘅門風（莊 = 東）
    const players = c.state.seats.map((id) => ({ id, name: t.names[id] ?? '玩家', v: (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0), wind: seatWind(c.state, id) }));
    return { id: t.id, name: t.name, round: roundLabel(c), players, dealer: c.info.dealer ?? null, streak: c.state.streak };
  });
  return (
    <LiveCardView
      groupName={group.name}
      icon={group.icon}
      sessionName={session.name}
      href={`/g/${group.id}/s/${session.id}`}
      tvHref={`/live/${group.id}/${session.id}`}
      tables={tables}
      me={me}
    />
  );
}

function LiveGroup({ gid, me, onLive, hidden, mineOnly }: { gid: string; me: string; onLive: OnLive; hidden?: boolean; mineOnly?: boolean }) {
  const group = useGroup(gid);
  const sessions = useRecentSessions(gid, 2);
  if (!group.data) return null;
  return <>{sessions.data.filter((s) => !s.closed && !s.legacy).map((s) => <LiveSession key={s.id} group={group.data!} session={s} me={me} onLive={onLive} hidden={hidden} mineOnly={mineOnly} />)}</>;
}

const noop: OnLive = () => undefined;
/** 主頁最頂：自己而家坐緊嘅枱（冇就乜都唔顯示） */
export function MyTableNow({ groupIds, me }: { groupIds: string[]; me: string }) {
  return <>{groupIds.map((g) => <LiveGroup key={g} gid={g} me={me} onLive={noop} mineOnly />)}</>;
}

/** 自己所有牌友圈入面打緊嘅大局；hidden = 唔顯示，淨係報返有邊幾個（電視直播轉台用） */
export default function LiveNow({ groupIds, me, onLive, hidden }: { groupIds: string[]; me: string; onLive: OnLive; hidden?: boolean }) {
  return <>{groupIds.map((g) => <LiveGroup key={g} gid={g} me={me} onLive={onLive} hidden={hidden} />)}</>;
}
