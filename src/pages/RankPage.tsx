// 段位頁：自己段位、點樣攞分、全部成就、每個牌友圈嘅雀力排行
import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { useProfile } from '../lib/live.ts';
import { POINT_RULES, TIERS, badgesOf, pointsFor, statsOf, tierOf, useMyHistory } from '../lib/stats.ts';
import type { GroupResults, MySession } from '../lib/stats.ts';
import { BadgeCats, CountUp, Progress, TierChip, TierTile } from '../components/Tier.tsx';
import { TopBar } from '../ui.tsx';

export function RankView({ me, mine, groups, loading }: { me: string; mine: MySession[]; groups: GroupResults[]; loading: boolean }) {
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
  const [gi, setGi] = useState(0);
  const g = groups[Math.min(gi, groups.length - 1)];
  const ladder = useMemo(() => {
    if (!g) return [];
    const ids = new Set(g.sessions.flatMap((s) => Object.keys(s.totals)));
    return [...ids]
      .map((id) => ({ id, name: g.names[id] || '玩家', points: pointsFor(id, g.sessions), played: g.sessions.filter((s) => id in s.totals).length }))
      .sort((a, b) => b.points - a.points);
  }, [g]);

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
        <ol className="list ladder">
          {TIERS.map((x) => (
            <li key={x.name} className={x.name === t.tier.name ? 'here' : st.points >= x.min ? 'done' : ''}>
              <TierTile tier={x} size="sm" />
              <span className="grow">{x.name}</span>
              <span className="muted small num">{x.min} 分</span>
              {x.name === t.tier.name && <span className="tag new">你在這裡</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="stack">
        <h2 className="section-head">點樣攞分</h2>
        <div className="list flat">
          {POINT_RULES.map(([a, b]) => (
            <div key={a} className="rule-row"><span className="grow">{a}</span><b className="num">{b}</b></div>
          ))}
        </div>
      </section>

      <section className="stack" id="badges">
        <h2 className="section-head">成就 {badges.filter((b) => b.got).length}/{badges.length}</h2>
        <BadgeCats badges={badges} stats={st} />
      </section>

      {groups.length > 0 && (
        <section className="stack">
          <h2 className="section-head">雀力排行</h2>
          {groups.length > 1 && (
            <div className="seg wide" role="tablist" aria-label="牌友圈">
              {groups.map((x, i) => (
                <button key={x.gid} type="button" role="tab" aria-selected={i === gi} aria-pressed={i === gi} onClick={() => setGi(i)}>{x.name}</button>
              ))}
            </div>
          )}
          <ol className="list ladder points">
            {ladder.map((r, i) => {
              const tt = tierOf(r.points).tier;
              return (
                <li key={r.id} className={r.id === me ? 'here' : ''}>
                  <span className="rank-dot">{i + 1}</span>
                  <span className="grow ellipsis">{r.name}<small className="muted">　{r.played} 次</small></span>
                  <TierChip tier={tt} />
                  <b className="num">{r.points}</b>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {loading && <p className="muted center-text">計緊…</p>}
    </main>
  );
}

export default function RankPage({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const h = useMyHistory(profile.loading ? null : user.uid, profile.data.groups);
  return <RankView me={user.uid} mine={h.mine} groups={h.groups} loading={profile.loading || h.loading} />;
}
