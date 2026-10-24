// 首頁：段位、Live、約局、打牌日曆、每月輸贏、走勢、最近幾場（數據同成就喺段位頁）
import { HomeMeetups } from '../components/Meetups.tsx';
import { InstallCard, NotifyCard } from '../components/InstallGuide.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { NameTakenError, claimName, displayName, markNudged, syncMemberName } from '../lib/data.ts';
import { useProfile, useSession } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { Avatar, NameForm, TopBar, fmt } from '../ui.tsx';
import { navContext } from '../lib/nav.ts';
import { TIERS, badgesOf, sessionPoints, statsOf, tierOf, useMyHistory, useTierSync } from '../lib/stats.ts';
import type { MySession } from '../lib/stats.ts';
import LiveNow, { MyTableNow } from '../components/LiveHome.tsx';
import { CountUp, Progress, TierTile } from '../components/Tier.tsx';
import { TrendChart } from '../components/Charts.tsx';

const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

/** 段位梯：十格顏色，去到邊格就亮到邊格 */
function TierStrip({ points }: { points: number }) {
  return (
    <div className="tier-strip" aria-hidden="true">
      {TIERS.map((t, i) => {
        const next = TIERS[i + 1];
        const fill = points >= (next?.min ?? Infinity) ? 1 : points >= t.min ? (next ? (points - t.min) / (next.min - t.min) : 1) : 0;
        return (
          <span key={t.name} className={`ts-seg ${t.cls}`} title={`${t.name} ${t.min} 分`}>
            <i style={{ width: `${Math.round(fill * 100)}%` }} />
          </span>
        );
      })}
    </div>
  );
}

/** 最近 12 個星期：每日一格，贏綠輸紅，越深越多 */
/** 打牌日曆：一個月嘅日曆，前後月份嘅日子淡色顯示；撳標題揀年同月 */
function MonthCalendar({ mine, sessionHref }: { mine: MySession[]; sessionHref: (s: MySession) => string }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [picking, setPicking] = useState(false);
  const [py, setPy] = useState(ym.y);
  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() + 6) % 7; // 星期一開始
  const start = new Date(ym.y, ym.m, 1 - lead);
  const cells = Math.ceil((lead + new Date(ym.y, ym.m + 1, 0).getDate()) / 7) * 7;
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byDay = new Map<string, MySession[]>();
  for (const x of mine) { const k = key(new Date(x.at)); byDay.set(k, [...(byDay.get(k) ?? []), x]); }
  const inMonth = mine.filter((x) => { const d = new Date(x.at); return d.getFullYear() === ym.y && d.getMonth() === ym.m; });
  const days = new Set(inMonth.map((x) => key(new Date(x.at)))).size;
  const total = inMonth.reduce((a, x) => a + x.mine, 0);
  const shift = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const playedMonths = new Set(mine.map((x) => { const d = new Date(x.at); return `${d.getFullYear()}-${d.getMonth()}`; }));
  return (
    <div className="mcal">
      <div className="mcal-head">
        <button type="button" className="iconbtn" aria-label="上個月" onClick={() => shift(-1)}>‹</button>
        <button type="button" className="mcal-title" aria-expanded={picking} onClick={() => { setPy(ym.y); setPicking((v) => !v); }}>
          <b>{ym.y}年{ym.m + 1}月</b>
          <span className="mcal-sub">{days ? <>打咗 {days} 日 · <span className={total > 0 ? 'gain' : total < 0 ? 'loss' : ''}>{fmt(total)}</span></> : '未打過'}</span>
          <span className="mcal-caret" aria-hidden="true">{picking ? '⌃' : '⌄'}</span>
        </button>
        <button type="button" className="iconbtn" aria-label="下個月" onClick={() => shift(1)}>›</button>
      </div>
      {picking ? (
        <div className="mcal-pick">
          <div className="mcal-year">
            <button type="button" className="iconbtn" aria-label="上一年" onClick={() => setPy((y) => y - 1)}>‹</button>
            <b>{py}年</b>
            <button type="button" className="iconbtn" aria-label="下一年" onClick={() => setPy((y) => y + 1)}>›</button>
          </div>
          <div className="mcal-months">
            {Array.from({ length: 12 }, (_, i) => (
              <button key={i} type="button" className={`mcal-m${py === ym.y && i === ym.m ? ' on' : ''}${playedMonths.has(`${py}-${i}`) ? ' played' : ''}`} onClick={() => { setYm({ y: py, m: i }); setPicking(false); }}>{i + 1}月</button>
            ))}
          </div>
          <button type="button" className="textbtn" onClick={() => { setYm({ y: now.getFullYear(), m: now.getMonth() }); setPicking(false); }}>返今個月</button>
        </div>
      ) : (
        <div className="mcal-grid">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w} className="mcal-w">{w}</span>)}
          {Array.from({ length: cells }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const list = byDay.get(key(d));
            const v = list?.reduce((a, x) => a + x.mine, 0) ?? 0;
            const other = d.getMonth() !== ym.m;
            const today = key(d) === key(now);
            const cls = `mcal-d${list ? (v > 0 ? ' win' : v < 0 ? ' lose' : ' even') : ''}${today ? ' today' : ''}${other ? ' other' : ''}`;
            if (!list) return <span key={i} className={cls}><span>{d.getDate()}</span></span>;
            return (
              <Link key={i} to={sessionHref(list[list.length - 1])} className={cls} ariaLabel={`${d.getMonth() + 1}月${d.getDate()}日 ${fmt(v)}`}>
                <span>{d.getDate()}</span>
                <small className="num">{fmt(v)}</small>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 最近六個月：每月輸贏 */
function MonthBars({ months }: { months: { label: string; total: number; played: number }[] }) {
  const max = Math.max(1, ...months.map((m) => Math.abs(m.total)));
  return (
    <div className="mbars">
      {months.map((m, i) => {
        const h = (Math.abs(m.total) / max) * 46;
        return (
          <div key={m.label} className="mbar">
            <span className={`mbar-val num ${m.total > 0 ? 'gain' : m.total < 0 ? 'loss' : 'muted'}`}>{m.played ? fmt(m.total) : ''}</span>
            <span className="mbar-track">
              <i className={m.total >= 0 ? 'up' : 'down'} style={{ height: `${Math.max(m.played ? 3 : 0, h)}px`, animationDelay: `${i * 0.06}s` }} />
            </span>
            <small>{m.label}</small>
            <small className="muted">{m.played ? `${m.played} 次` : '–'}</small>
          </div>
        );
      })}
    </div>
  );
}

/** 上次去開嘅大局（未埋數先顯示） */
function Resume({ g, s, t }: { g: string; s: string; t?: string }) {
  const { data } = useSession(g, s);
  if (!data || data.closed || data.legacy) return null;
  return <ResumeRow href={t ? `/g/${g}/s/${s}/t/${t}` : `/g/${g}/s/${s}`} name={data.name} />;
}

export function ResumeRow({ href, name }: { href: string; name: string }) {
  return (
    <Link to={href} className="listrow list resume">
      <span className="resume-dot" aria-hidden="true" />
      <span className="grow">繼續：{name}</span>
      <Chevron />
    </Link>
  );
}

export function DashboardView({ name, photo, joined, groupCount, mine, loading, resume, nudge, live, pinned, sessionHref, rankHref = '/rank', settingsHref = '/settings' }: {
  name: string; photo: string | null; joined: string; groupCount: number; mine: MySession[]; loading: boolean; resume?: ReactNode; nudge?: ReactNode; live?: ReactNode;
  /** 置頂：自己而家坐緊嘅枱 */
  pinned?: ReactNode;
  sessionHref: (s: MySession) => string;
  rankHref?: string;
  /** 撳自己個名／頭像去設定 */
  settingsHref?: string;
}) {
  const st = statsOf(mine);
  const t = tierOf(st.points);
  const badges = badgesOf(st);
  const got = badges.filter((b) => b.got);
  const recent = [...mine].reverse().slice(0, 5);

  return (
    <main className="page dash">
      <TopBar />
      {pinned}

      <section className="hero">
        <div className="hero-top">
          <Link to={settingsHref} className="hero-me" aria-label="去設定改個人資料">
            <Avatar name={name} photo={photo} size="lg" />
            <div className="grow">
              <h2>{name}</h2>
              <p className="hero-sub">{joined}{groupCount ? ` · ${groupCount} 個牌友圈` : ''}</p>
            </div>
          </Link>
          <TierTile tier={t.tier} size="lg" />
        </div>
        <Link to={rankHref} className="hero-tier" aria-label="睇段位同成就">
          <div className="between">
            <b className="hero-tier-name">{t.tier.name}</b>
            <span className="hero-points"><CountUp value={st.points} /> 分</span>
          </div>
          <Progress value={t.progress} />
          <small>{t.next ? `再 ${t.toNext} 分升「${t.next.name}」` : '已到最高段位'}</small>
          <TierStrip points={st.points} />
        </Link>
      </section>

      {live}
      {nudge}
      {resume}

      {loading && !mine.length ? (
        <div className="dash-skel" aria-label="載入中"><span /><span /><span /><span /></div>
      ) : !mine.length ? (
        <section className="empty">
          <p>打完第一個大局，就會見到你嘅戰績、段位同成就。</p>
          <Link to="/groups" className="btn">去牌友圈</Link>
        </section>
      ) : (
        <>
          <section className="stack">
            <h2 className="section-head">打牌日曆</h2>
            <div className="list pad"><MonthCalendar mine={mine} sessionHref={sessionHref} /></div>
          </section>

          <section className="stack">
            <h2 className="section-head">每月輸贏</h2>
            <div className="list pad"><MonthBars months={st.months} /></div>
          </section>

          <Link to={rankHref} className="listrow list dash-more">
            <span className="grow"><b>數據同成就</b><small className="muted">食糊、自摸、勝率、已解鎖 {got.length} 個成就</small></span>
            <Chevron />
          </Link>

          {st.curve.length > 2 && (
            <section className="stack">
              <h2 className="section-head">累計走勢</h2>
              <div className="list pad">
                <TrendChart series={[{ id: 'me', name: '累計番數', values: st.curve }]} labels={['開始', ...mine.map((s) => md(s.at))]} me="me" />
              </div>
            </section>
          )}

          <section className="stack">
            <h2 className="section-head">最近</h2>
            <ul className="list recent">
              {recent.map((s) => (
                <li key={s.gid + s.sid}>
                  <Link to={sessionHref(s)} className="listrow">
                    <span className={`rank-dot${s.rank === 1 && s.mine > 0 ? ' top' : ''}`}>{s.rank === 1 && s.mine > 0 ? '龍' : s.rank}</span>
                    <span className="grow exp-text">
                      <span className="ellipsis">{s.name}</span>
                      <small className="muted">{s.gname} · {md(s.at)}</small>
                    </span>
                    <span className="recent-right">
                      <b className={`num ${s.mine > 0 ? 'gain' : s.mine < 0 ? 'loss' : ''}`}>{fmt(s.mine)}</b>
                      <small className="muted">+{sessionPoints(s)} 分</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

/** 溫和咁提用家補資料（Interac email、生日、真名）；可以略過，兩個禮拜先再提 */
function ProfileNudge({ uid, profile }: { uid: string; profile: { payEmail: string; payMethods?: unknown[]; birthday: string; firstName: string; lastName: string; nudgedAt: number } | null }) {
  const [hidden, setHidden] = useState(false);
  if (!profile || hidden) return null;
  const missing = [!profile.payEmail && !profile.payMethods?.length && '收款資料', !profile.birthday && '生日', !(profile.firstName || profile.lastName) && '名'].filter(Boolean) as string[];
  if (!missing.length || Date.now() - profile.nudgedAt < 14 * 86400000) return null;
  const later = () => { setHidden(true); markNudged(uid).catch(() => undefined); };
  return (
    <section className="nudge" role="status">
      <span className="nudge-icon" aria-hidden="true">✍️</span>
      <span className="grow">
        <b>補返少少資料？</b>
        <small>{missing.join('、')}：方便人哋找數俾你、一齊慶祝生日。唔填都用得。</small>
      </span>
      <span className="nudge-acts">
        <Link to="/settings" className="btn small-btn" ariaLabel="去設定補資料">而家填</Link>
        <button type="button" className="textbtn" onClick={later}>遲啲先</button>
      </span>
    </section>
  );
}

function joinedText(user: User): string {
  const t = user.metadata.creationTime ? new Date(user.metadata.creationTime) : null;
  return t ? `${t.getFullYear()}年${t.getMonth() + 1}月加入` : '玩家';
}

/** 舊用家：自動認領而家個雀壇名；撞咗名就叫佢改一個（免費） */
function NameClaim({ user, claimed, ready, groups }: { user: User; claimed: boolean; ready: boolean; groups: string[] }) {
  const [clash, setClash] = useState(false);
  const [done, setDone] = useState(false);
  const tried = useRef(false);
  useEffect(() => {
    if (!ready || claimed || tried.current) return;
    tried.current = true;
    claimName(user, displayName(user)).catch((err) => { if (err instanceof NameTakenError) setClash(true); });
  }, [ready, claimed, user]);
  if (!clash || done) return null;
  return (
    <section className="panel name-clash">
      <h3>你個雀壇名撞咗名</h3>
      <p className="muted small">「{displayName(user)}」已經有其他人用緊。雀壇名全 app 唯一，請改一個（今次免費）。</p>
      <NameForm user={user} initial="" onDone={() => { setDone(true); syncMemberName(user, groups).catch(() => undefined); window.dispatchEvent(new Event('jeukbou-nav')); }} />
    </section>
  );
}

export default function Home({ user }: { user: User; refresh?: () => void }) {
  const profile = useProfile(user.uid);
  const groups = profile.data.groups;
  const history = useMyHistory(profile.loading ? null : user.uid, groups);
  useTierSync(history, !profile.loading);
  const last = navContext('/');
  const onLive = useCallback(() => undefined, []);
  return (
    <DashboardView
      name={displayName(user)}
      photo={profile.data.avatar ?? user.photoURL}
      joined={joinedText(user)}
      groupCount={groups.length}
      mine={history.mine}
      loading={profile.loading || history.loading}
      resume={last.g && last.s ? <Resume g={last.g} s={last.s} t={last.t} /> : null}
      nudge={<><NameClaim user={user} claimed={!!profile.data.nameKey} ready={!profile.loading} groups={groups} /><InstallCard /><NotifyCard uid={user.uid} /><ProfileNudge uid={user.uid} profile={profile.loading ? null : profile.data} /></>}
      live={<><LiveNow groupIds={groups} me={user.uid} onLive={onLive} /><HomeMeetups groupIds={groups} me={user.uid} /></>}
      pinned={<MyTableNow groupIds={groups} me={user.uid} />}
      sessionHref={(s) => `/g/${s.gid}/s/${s.sid}`}
    />
  );
}
