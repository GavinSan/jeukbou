// 段位頁：自己段位（其他段位撳先展開）、數據、全部成就、點樣攞分（最底）。雀力排行喺各個牌友圈入面。
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { useProfile } from '../lib/live.ts';
import { POINT_RULES, TIERS, badgesOf, statsOf, tierOf, useMyHistory, useTierSync } from '../lib/stats.ts';
import type { MySession, Stats } from '../lib/stats.ts';
import { BadgeCats, CountUp, Progress, Ring, TierTile } from '../components/Tier.tsx';
import { TopBar, fmt } from '../ui.tsx';

const signed = (n: number) => fmt(Math.round(n));
/** 展開／收埋嘅細箭咀（SVG，唔用字符） */
const Chevron = ({ up }: { up: boolean }) => (
  <svg className={`chev-svg${up ? ' up' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
);

/** 自己嘅數據（由主頁搬嚟）：圈數、勝率、總番數、最好一次；有詳細紀錄就加食糊／自摸／出銃／最大一鋪 */
function MyStats({ st }: { st: Stats }) {
  return (
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
      {st.detailed > 0 && (
        <>
          <div className="my-stats">
            <div className="ms ms-gold"><span className="ms-mark">食</span><b className="num"><CountUp value={st.handWins} /></b><small>食糊</small></div>
            <div className="ms ms-green"><span className="ms-mark">摸</span><b className="num"><CountUp value={st.selfDraws} /></b><small>自摸</small></div>
            <div className="ms ms-red"><span className="ms-mark">銃</span><b className="num"><CountUp value={st.dealIns} /></b><small>出銃</small></div>
            <div className="ms ms-purple"><span className="ms-mark">大</span><b className="num"><CountUp value={st.bestFan} /></b><small>最大一鋪</small></div>
          </div>
          {st.rounds > 0 && <p className="muted small">每圈平均：食糊 {(st.handWins / st.rounds).toFixed(1)} 次・自摸 {(st.selfDraws / st.rounds).toFixed(1)} 次・出銃 {(st.dealIns / st.rounds).toFixed(1)} 次（共 {st.rounds} 圈）</p>}
        </>
      )}
    </>
  );
}

export function RankView({ mine, loading }: { mine: MySession[]; loading: boolean }) {
  const st = statsOf(mine);
  // 由主頁撳成就入嚟：捲去成就／嗰一類，閃一閃
  useEffect(() => {
    if (loading) return;
    const h = window.location.hash.slice(1);
    if (!h.startsWith('badge')) return;
    const el = document.getElementById(h);
    if (!el) return;
    const t1 = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: h === 'badges' ? 'start' : 'center' });
      if (h !== 'badges') { el.classList.add('flash-focus'); setTimeout(() => el.classList.remove('flash-focus'), 1800); }
    }, 120);
    return () => clearTimeout(t1);
  }, [loading]);
  const t = tierOf(st.points);
  const badges = badgesOf(st);
  // 段位：淨係顯示而家嗰級，其他撳先展開
  const [allTiers, setAllTiers] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  return (
    <main className="page">
      <TopBar title="段位" />

      <section className="hero small-hero">
        <div className="hero-top">
          <TierTile tier={t.tier} size="lg" />
          <div className="grow">
            <h2>{t.tier.name}</h2>
            <p className="hero-sub"><CountUp value={st.points} /> 分 · {st.played} 次大局{st.rounds ? ` · ${st.rounds} 圈` : ''}</p>
          </div>
        </div>
        <div className="hero-tier">
          <Progress value={t.progress} />
          <small>{t.next ? `再 ${t.toNext} 分升「${t.next.name}」` : '已到最高段位'}</small>
        </div>
      </section>

      <section className="stack">
        <h2 className="section-head">段位</h2>
        <ol className="list ladder tier-ladder">
          {TIERS.map((x, i) => {
            const next = TIERS[i + 1];
            const here = x.name === t.tier.name;
            if (!here && !allTiers) return null;
            const done = st.points >= (next?.min ?? Infinity);
            return (
              <li key={x.name} className={here ? 'here' : done ? 'done' : st.points >= x.min ? 'done' : 'todo'}>
                <TierTile tier={x} size="sm" />
                <span className="grow tier-row">
                  <span className="tier-row-top"><b>{x.name}</b><span className="muted small num">{next ? `${x.min}–${next.min - 1} 分` : `${x.min} 分以上`}</span></span>
                  {here && (
                    <span className="tier-row-bar">
                      <Progress value={t.progress} />
                      <small className="num">{st.points} 分{t.next ? ` · 再 ${t.toNext} 分升級` : ' · 最高段位'}</small>
                    </span>
                  )}
                </span>
                <span className="tier-mark-col" aria-hidden="true">{done ? '✓' : here ? '●' : ''}</span>
              </li>
            );
          })}
          <li className="tier-more">
            <button type="button" className="textbtn" aria-expanded={allTiers} onClick={() => setAllTiers((v) => !v)}><span>{allTiers ? '收埋其他段位' : `睇晒 ${TIERS.length} 個段位`}</span><Chevron up={allTiers} /></button>
          </li>
        </ol>
      </section>

      {mine.length > 0 && (
        <section className="stack">
          <h2 className="section-head">數據</h2>
          <MyStats st={st} />
        </section>
      )}

      <section className="stack" id="badges">
        <h2 className="section-head">成就<small className="muted head-note">已解鎖 {badges.filter((b) => b.got).length} 個・共 {badges.length} 個</small></h2>
        <BadgeCats badges={badges} stats={st} />
      </section>

      {/* 點樣攞分：放最底，收埋做一張說明卡 */}
      <section className={`how-points${howOpen ? ' open' : ''}`}>
        <button type="button" className="how-points-head" aria-expanded={howOpen} onClick={() => setHowOpen((v) => !v)}>
          <span className="how-points-icon" aria-hidden="true">?</span>
          <span className="grow"><b>點樣攞分</b><small>打大局、贏、做龍頭都有分；儲夠就升段位</small></span>
          <span className="how-points-chev"><Chevron up={howOpen} /></span>
        </button>
        {howOpen && (
          <dl className="how-points-list">
            {POINT_RULES.map(([a, b]) => (
              <div key={a}><dt>{a}</dt><dd className="num">{b}</dd></div>
            ))}
          </dl>
        )}
      </section>
      {loading && <p className="muted center-text">計緊…</p>}
    </main>
  );
}

export default function RankPage({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const h = useMyHistory(profile.loading ? null : user.uid, profile.data.groups);
  useTierSync(h, !profile.loading);
  return <RankView mine={h.mine} loading={profile.loading || h.loading} />;
}
