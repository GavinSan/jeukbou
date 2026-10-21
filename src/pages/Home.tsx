// 首頁：自己嘅戰績（段位、雀力分、場數、勝率、走勢、最近幾場、成就）
import { InstallCard, NotifyCard } from '../components/InstallGuide.tsx';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { displayName, markNudged } from '../lib/data.ts';
import { useProfile, useSession } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { Avatar, TopBar, fmt } from '../ui.tsx';
import { navContext } from '../lib/nav.ts';
import { TIERS, badgesOf, sessionPoints, statsOf, tierOf, useMyHistory } from '../lib/stats.ts';
import type { MySession } from '../lib/stats.ts';
import LiveNow from '../components/LiveHome.tsx';
import { BadgeTile, CountUp, Progress, Ring, TierTile } from '../components/Tier.tsx';
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
            <i style={{ width: `${Math.round(fill * 100)}%`, animationDelay: `${i * 0.08}s` }} />
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
const signed = (n: number) => fmt(Math.round(n));

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

export function DashboardView({ name, photo, joined, groupCount, mine, loading, resume, nudge, live, sessionHref, rankHref = '/rank' }: {
  name: string; photo: string | null; joined: string; groupCount: number; mine: MySession[]; loading: boolean; resume?: ReactNode; nudge?: ReactNode; live?: ReactNode;
  sessionHref: (s: MySession) => string;
  rankHref?: string;
}) {
  const st = statsOf(mine);
  const t = tierOf(st.points);
  const badges = badgesOf(st);
  const got = badges.filter((b) => b.got);
  // 每類攞最高級嗰個已拎到嘅，再加最就快拎到嘅
  const topGot = Object.values(got.reduce((acc, b) => { if (!acc[b.cat] || b.level > acc[b.cat].level) acc[b.cat] = b; return acc; }, {} as Record<string, typeof got[number]>))
    .sort((a, b) => b.level - a.level);
  const nextBadges = badges.filter((b) => !b.got).sort((a, b) => b.progress - a.progress);
  const preview = [...topGot.slice(0, 4), ...nextBadges.slice(0, 4)].slice(0, 8);
  const recent = [...mine].reverse().slice(0, 5);

  return (
    <main className="page dash">
      <TopBar />

      <section className="hero">
        <div className="hero-top">
          <Avatar name={name} photo={photo} size="lg" />
          <div className="grow">
            <h2>{name}</h2>
            <p className="hero-sub">{joined}{groupCount ? ` · ${groupCount} 個牌友圈` : ''}</p>
          </div>
          <TierTile tier={t.tier} size="lg" />
        </div>
        <div className="hero-tier">
          <div className="between">
            <b className="hero-tier-name">{t.tier.name}</b>
            <span className="hero-points"><CountUp value={st.points} /> 分</span>
          </div>
          <Progress value={t.progress} />
          <small>{t.next ? `再 ${t.toNext} 分升「${t.next.name}」` : '已到最高段位'}</small>
          <TierStrip points={st.points} />
        </div>
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
          <section className="tiles">
            <div className="tile-stat">
              <small>{st.rounds ? '打咗幾多圈' : '大局'}</small>
              <b className="num"><CountUp value={st.rounds || st.played} />{st.rounds ? <small className="unit"> 圈</small> : null}</b>
              <span className="muted small">{st.played} 次大局 · 近 30 日 {st.month} 次</span>
            </div>
            <div className="tile-stat ring-tile">
              <Ring value={st.winRate} label={`勝率 ${Math.round(st.winRate * 100)}%`} />
              <span className="ring-text"><b className="num"><CountUp value={st.winRate * 100} format={(n) => `${Math.round(n)}%`} /></b><small>勝率</small></span>
              <span className="muted small">贏 {st.wins} · 輸 {st.losses}</span>
            </div>
            <div className="tile-stat">
              <small>總番數</small>
              <b className={`num ${st.total > 0 ? 'gain' : st.total < 0 ? 'loss' : ''}`}><CountUp value={st.total} format={signed} /></b>
              <span className="muted small">{st.rounds ? `平均每圈 ${st.total / st.rounds > 0 ? '+' : ''}${(st.total / st.rounds).toFixed(1)}` : `平均每次 ${fmt(st.avg)}`}</span>
            </div>
            <div className="tile-stat">
              <small>最好一次</small>
              <b className="num gain"><CountUp value={st.best} format={signed} /></b>
              <span className="muted small">龍頭 {st.tops} 次 · 最長連贏 {st.bestStreak}</span>
            </div>
          </section>

          <section className="stack">
            <h2 className="section-head">打牌日曆</h2>
            <div className="list pad"><MonthCalendar mine={mine} sessionHref={sessionHref} /></div>
          </section>

          <section className="stack">
            <h2 className="section-head">每月輸贏</h2>
            <div className="list pad"><MonthBars months={st.months} /></div>
          </section>

          {st.detailed > 0 && (
            <section className="stack">
              <h2 className="section-head">數據</h2>
              <div className="my-stats">
                <div className="ms ms-gold"><span className="ms-mark">食</span><b className="num"><CountUp value={st.handWins} /></b><small>食糊</small></div>
                <div className="ms ms-green"><span className="ms-mark">摸</span><b className="num"><CountUp value={st.selfDraws} /></b><small>自摸</small></div>
                <div className="ms ms-red"><span className="ms-mark">銃</span><b className="num"><CountUp value={st.dealIns} /></b><small>出銃</small></div>
                <div className="ms ms-purple"><span className="ms-mark">大</span><b className="num"><CountUp value={st.bestFan} /></b><small>最大一鋪</small></div>
              </div>
              {st.rounds > 0 && <p className="muted small">每圈平均：食糊 {(st.handWins / st.rounds).toFixed(1)} 次・自摸 {(st.selfDraws / st.rounds).toFixed(1)} 次・出銃 {(st.dealIns / st.rounds).toFixed(1)} 次（共 {st.rounds} 圈）</p>}
            </section>
          )}

          <section className="stack">
            <div className="section-head">
              <h2>成就</h2>
              <Link to={`${rankHref}#badges`} className="textbtn">已解鎖 {got.length} 個 ›</Link>
            </div>
            <div className="badge-row">{preview.map((b) => <BadgeTile key={b.key} b={b} href={`${rankHref}#badge-${b.cat}`} />)}</div>
          </section>

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
function ProfileNudge({ uid, profile }: { uid: string; profile: { payEmail: string; birthday: string; firstName: string; lastName: string; nudgedAt: number } | null }) {
  const [hidden, setHidden] = useState(false);
  if (!profile || hidden) return null;
  const missing = [!profile.payEmail && 'Interac email', !profile.birthday && '生日', !(profile.firstName || profile.lastName) && '真名'].filter(Boolean) as string[];
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
  return t ? `${t.getFullYear()}年${t.getMonth() + 1}月加入` : '雀簿玩家';
}

export default function Home({ user }: { user: User; refresh?: () => void }) {
  const profile = useProfile(user.uid);
  const groups = profile.data.groups;
  const history = useMyHistory(profile.loading ? null : user.uid, groups);
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
      nudge={<><InstallCard /><NotifyCard uid={user.uid} /><ProfileNudge uid={user.uid} profile={profile.loading ? null : profile.data} /></>}
      live={<LiveNow groupIds={groups} me={user.uid} onLive={onLive} />}
      sessionHref={(s) => `/g/${s.gid}/s/${s.sid}`}
    />
  );
}
