// 首頁：自己嘅戰績（段位、雀力分、場數、勝率、走勢、最近幾場、成就）
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { displayName } from '../lib/data.ts';
import { useProfile, useSession } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { Avatar, TopBar, fmt } from '../ui.tsx';
import { navContext } from '../lib/nav.ts';
import { TIERS, badgesOf, sessionPoints, statsOf, tierOf, useMyHistory } from '../lib/stats.ts';
import type { MySession } from '../lib/stats.ts';
import { BadgeTile, CountUp, Progress, Ring, TierTile } from '../components/Tier.tsx';
import { TrendChart } from '../components/Charts.tsx';

const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

/** 段位梯：八格顏色，去到邊格就亮到邊格 */
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
function Heatmap({ mine }: { mine: MySession[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - 7 * 11);
  const byDay = new Map<number, number>();
  for (const s of mine) {
    const d = new Date(s.at);
    d.setHours(0, 0, 0, 0);
    byDay.set(d.getTime(), (byDay.get(d.getTime()) ?? 0) + s.mine);
  }
  const max = Math.max(1, ...[...byDay.values()].map(Math.abs));
  const days = Array.from({ length: 84 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const played = days.filter((d) => byDay.has(d.getTime())).length;
  return (
    <div className="heat-wrap">
      <div className="heat" role="img" aria-label={`最近 12 個星期打咗 ${played} 日`}>
        {days.map((d) => {
          const v = byDay.get(d.getTime());
          const level = v === undefined ? 0 : Math.min(4, 1 + Math.floor((Math.abs(v) / max) * 3.99));
          const cls = v === undefined ? '' : v >= 0 ? `w${level}` : `l${level}`;
          return <span key={d.getTime()} className={`hc ${cls}${d > today ? ' future' : ''}`} title={v === undefined ? md(d.getTime()) : `${md(d.getTime())}：${fmt(v)}`} />;
        })}
      </div>
      <div className="heat-legend muted small"><span>12 星期前</span><span>打咗 {played} 日</span><span>今日</span></div>
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
            <small className="muted">{m.played ? `${m.played} 場` : '–'}</small>
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

export function DashboardView({ name, photo, joined, groupCount, mine, loading, resume, sessionHref }: {
  name: string; photo: string | null; joined: string; groupCount: number; mine: MySession[]; loading: boolean; resume?: ReactNode;
  sessionHref: (s: MySession) => string;
}) {
  const st = statsOf(mine);
  const t = tierOf(st.points);
  const badges = badgesOf(st);
  const got = badges.filter((b) => b.got);
  const nextBadges = badges.filter((b) => !b.got).sort((a, b) => b.progress - a.progress);
  const preview = [...got.slice(-3), ...nextBadges].slice(0, 4);
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

      {resume}

      {loading && !mine.length ? (
        <div className="dash-skel" aria-label="載入中"><span /><span /><span /><span /></div>
      ) : !mine.length ? (
        <section className="empty">
          <p>打完第一場，就會見到你嘅戰績、段位同成就。</p>
          <Link to="/groups" className="btn">去牌友圈</Link>
        </section>
      ) : (
        <>
          <section className="tiles">
            <div className="tile-stat">
              <small>場數</small>
              <b className="num"><CountUp value={st.played} /></b>
              <span className="muted small">近 30 日 {st.month} 場</span>
            </div>
            <div className="tile-stat ring-tile">
              <Ring value={st.winRate} label={`勝率 ${Math.round(st.winRate * 100)}%`} />
              <span className="ring-text"><b className="num"><CountUp value={st.winRate * 100} format={(n) => `${Math.round(n)}%`} /></b><small>勝率</small></span>
              <span className="muted small">贏 {st.wins} · 輸 {st.losses}</span>
            </div>
            <div className="tile-stat">
              <small>總番數</small>
              <b className={`num ${st.total > 0 ? 'gain' : st.total < 0 ? 'loss' : ''}`}><CountUp value={st.total} format={signed} /></b>
              <span className="muted small">平均每場 {fmt(st.avg)}</span>
            </div>
            <div className="tile-stat">
              <small>最好一場</small>
              <b className="num gain"><CountUp value={st.best} format={signed} /></b>
              <span className="muted small">龍頭 {st.tops} 次 · 最長連贏 {st.bestStreak}</span>
            </div>
          </section>

          {st.detailed > 0 && (
            <section className="stack">
              <h2 className="section-head">我嘅數據</h2>
              <div className="my-stats">
                <div className="ms ms-gold"><span className="ms-mark">食</span><b className="num"><CountUp value={st.handWins} /></b><small>食糊</small></div>
                <div className="ms ms-green"><span className="ms-mark">摸</span><b className="num"><CountUp value={st.selfDraws} /></b><small>自摸</small></div>
                <div className="ms ms-red"><span className="ms-mark">銃</span><b className="num"><CountUp value={st.dealIns} /></b><small>出銃</small></div>
                <div className="ms ms-purple"><span className="ms-mark">大</span><b className="num"><CountUp value={st.bestFan} /></b><small>最大一鋪</small></div>
              </div>
              <p className="muted small">每場平均食糊 {(st.handWins / st.detailed).toFixed(1)} 次、出銃 {(st.dealIns / st.detailed).toFixed(1)} 次（{st.detailed} 場有詳細紀錄）</p>
            </section>
          )}

          <section className="stack">
            <h2 className="section-head">打牌日曆</h2>
            <div className="list pad"><Heatmap mine={mine} /></div>
          </section>

          <section className="stack">
            <h2 className="section-head">每月輸贏</h2>
            <div className="list pad"><MonthBars months={st.months} /></div>
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
            <div className="section-head">
              <h2>成就</h2>
              <Link to="/rank" className="textbtn">全部 {got.length}/{badges.length}</Link>
            </div>
            <div className="badge-row">{preview.map((b) => <BadgeTile key={b.key} b={b} />)}</div>
          </section>

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
                      <small className="muted">+{sessionPoints(s.mine, s.rank, s.players)} 分</small>
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

function joinedText(user: User): string {
  const t = user.metadata.creationTime ? new Date(user.metadata.creationTime) : null;
  return t ? `${t.getFullYear()}年${t.getMonth() + 1}月加入` : '雀簿玩家';
}

export default function Home({ user }: { user: User; refresh?: () => void }) {
  const profile = useProfile(user.uid);
  const groups = profile.data.groups;
  const history = useMyHistory(profile.loading ? null : user.uid, groups);
  const last = navContext('/');
  return (
    <DashboardView
      name={displayName(user)}
      photo={profile.data.avatar ?? user.photoURL}
      joined={joinedText(user)}
      groupCount={groups.length}
      mine={history.mine}
      loading={profile.loading || history.loading}
      resume={last.g && last.s ? <Resume g={last.g} s={last.s} t={last.t} /> : null}
      sessionHref={(s) => `/g/${s.gid}/s/${s.sid}`}
    />
  );
}
