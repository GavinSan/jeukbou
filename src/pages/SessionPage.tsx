import { useMemo } from 'react';
import { useGroup, useManyEvents, useSession, useTables } from '../lib/live.ts';
import { Link } from '../lib/router.tsx';
import { computeTable, rulesOf } from '../lib/score.ts';
import type { Computed } from '../lib/score.ts';
import { Avatar, Chips, CopyLink, Loading, TopBar, fmt, tone } from '../ui.tsx';

export default function SessionPage({ groupId, sessionId }: { groupId: string; sessionId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const tables = useTables(groupId, sessionId);
  const events = useManyEvents(groupId, sessionId, tables.data.map((t) => t.id));
  const rules = useMemo(() => rulesOf(group.data), [group.data]);

  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables.data) out[t.id] = computeTable(t, events[t.id] ?? [], rules);
    return out;
  }, [tables.data, events, rules]);

  const ranking = useMemo(() => {
    const rows: { id: string; name: string; table: string; settled: number; net: number }[] = [];
    for (const t of tables.data) {
      const c = computed[t.id];
      if (!c) continue;
      for (const id of Object.keys(c.state.settled)) {
        const settled = c.state.settled[id] ?? 0;
        rows.push({ id, name: t.names[id] ?? '玩家', table: t.name.replace('第 ', ''), settled, net: settled + (c.pending[id] ?? 0) });
      }
    }
    return rows.sort((a, b) => b.net - a.net);
  }, [tables.data, computed]);

  const water = Object.values(computed).reduce((a, c) => a + (c?.state.water ?? 0), 0);

  if (session.error || group.error) return <main className="page"><TopBar back={`/g/${groupId}`} /><p className="error">{session.error ?? group.error}</p></main>;
  if (!session.data || !group.data) return <main className="page"><TopBar back={`/g/${groupId}`} /><Loading /></main>;

  const invite = `${window.location.origin}/join/${groupId}/${group.data.inviteCode}/s/${sessionId}`;

  return (
    <main className="page">
      <TopBar back={`/g/${groupId}`} title={session.data.name} />

      <section className="stack">
        <div className="between">
          <h2 className="section-title">枱面</h2>
          <span className="muted small">撳入去入數</span>
        </div>
        {tables.data.map((t) => {
          const c = computed[t.id];
          return (
            <Link key={t.id} to={`/g/${groupId}/s/${sessionId}/t/${t.id}`} className="card stack table-card">
              <div className="between">
                <strong>{t.name}</strong>
                <span className="muted small">
                  {c ? (c.state.ended ? '已完場' : `${c.info.roundWind}圈 · 第 ${c.info.hand} 鋪`) : ''}
                </span>
              </div>
              <div className="mini-grid">
                {t.seats.map((id) => {
                  const settled = c?.state.settled[id] ?? 0;
                  const p = c?.pending[id] ?? 0;
                  const isDealer = c ? c.info.dealer === id : false;
                  return (
                    <div key={id} className="mini-seat">
                      <Avatar name={t.names[id] ?? '?'} size="sm" />
                      <span className="ellipsis grow">{t.names[id] ?? '玩家'}</span>
                      {isDealer && !c?.state.ended && <span className="badge">莊</span>}
                      {p < 0 && <Chips amount={-p} />}
                      {p > 0 && <span className="num pos small">+{p}</span>}
                      <span className={`num strong ${tone(settled)}`}>{fmt(settled)}</span>
                    </div>
                  );
                })}
              </div>
              {c && c.state.chains.length > 0 && (
                <div className="la-pill">
                  {c.state.chains.map((ch) => `${t.names[ch.puller]} 拉 ${t.names[ch.pulled]} ${ch.count}`).join(' · ')}
                </div>
              )}
            </Link>
          );
        })}
      </section>

      <section className="stack">
        <div className="between">
          <h2 className="section-title">全場排名</h2>
          <span className="muted small">計埋未找 · 水 {water}</span>
        </div>
        <div className="card list">
          {ranking.map((r, i) => (
            <div key={r.id + r.table} className="listrow static">
              <span className="num muted rank">{i + 1}</span>
              <Avatar name={r.name} size="sm" />
              <span className="grow ellipsis">{r.name}</span>
              <span className="tag">{r.table}</span>
              <span className={`num strong ${tone(r.net)}`}>{fmt(r.net)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>邀請入呢個大局</h2>
        <p className="muted small">未入牌友圈嘅人撳呢條連結登入，會自動加入同埋直接去呢個大局。</p>
        <CopyLink url={invite} />
      </section>
    </main>
  );
}
