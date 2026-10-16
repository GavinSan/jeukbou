// 大局總覽：每張枱最新一鋪、統計、全場排名、最新動態
import { useMemo } from 'react';
import type { TableDoc } from '../lib/data.ts';
import { Link } from '../lib/router.tsx';
import type { Computed } from '../lib/score.ts';
import { ago, describe } from '../lib/score.ts';
import { Avatar, Chips, CopyLink, TopBar, fmt, tone, useNow } from '../ui.tsx';

export interface SessionScreenProps {
  title: string;
  back: string;
  tables: TableDoc[];
  computed: Record<string, Computed | null>;
  tableHref: (tableId: string) => string;
  invite: string | null;
}

export default function SessionScreen({ title, back, tables, computed, tableHref, invite }: SessionScreenProps) {
  const now = useNow();

  const ranking = useMemo(() => {
    const rows: { id: string; name: string; table: string; net: number }[] = [];
    for (const t of tables) {
      const c = computed[t.id];
      if (!c) continue;
      for (const id of Object.keys(c.state.settled)) {
        rows.push({ id, name: t.names[id] ?? '玩家', table: t.name, net: (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0) });
      }
    }
    return rows.sort((a, b) => b.net - a.net);
  }, [tables, computed]);

  const feed = useMemo(() => {
    const items: { key: string; table: string; text: string; at: number | null; seq: number }[] = [];
    for (const t of tables) {
      const c = computed[t.id];
      if (!c) continue;
      const name = (id: string) => t.names[id] ?? '玩家';
      for (const st of c.steps) items.push({ key: `${t.id}-${st.seq}`, table: t.name, text: describe(st.event, name), at: st.at, seq: st.seq });
    }
    return items.sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity) || b.seq - a.seq).slice(0, 6);
  }, [tables, computed]);

  const water = Object.values(computed).reduce((a, c) => a + (c?.state.water ?? 0), 0);
  const people = tables.reduce((a, t) => a + t.seats.length, 0);

  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>{title}</h1><span className="muted small">{tables.length} 張枱，{people} 人</span></div>} />

      <section className="stack">
        {tables.map((t) => {
          const c = computed[t.id];
          const name = (id: string) => t.names[id] ?? '玩家';
          const last = c?.steps[c.steps.length - 1];
          const owe: Record<string, number> = {};
          for (const ch of c?.state.chains ?? []) owe[ch.pulled] = (owe[ch.pulled] ?? 0) + ch.owed;
          return (
            <Link key={t.id} to={tableHref(t.id)} className="tcard">
              <div className="tcard-head">
                <h3>{t.name}</h3>
                <span className="muted small">{!c ? '' : c.state.ended ? '已完場' : `${c.info.roundWind}圈第 ${c.info.hand} 鋪`}</span>
              </div>
              <div className="tcard-rows">
                {t.seats.map((id) => {
                  const settled = c?.state.settled[id] ?? 0;
                  const dealer = c && !c.state.ended && c.info.dealer === id;
                  return (
                    <div key={id} className="prow">
                      <Avatar name={name(id)} size="sm" />
                      <span className="ellipsis grow">{name(id)}{dealer ? '（莊）' : ''}</span>
                      {owe[id] ? <Chips amount={owe[id]} /> : null}
                      <span className={`num ${tone(settled)}`}>{fmt(settled)}</span>
                    </div>
                  );
                })}
              </div>
              {c && (
                <div className="facts">
                  <span className="fact"><b>{c.stats.hands}</b> 鋪</span>
                  {c.stats.biggest && <span className="fact">最大 <b>{c.stats.biggest.fan}</b> 番（{name(c.stats.biggest.player)}）</span>}
                  {c.stats.selfDraws > 0 && <span className="fact">自摸 <b>{c.stats.selfDraws}</b></span>}
                  {c.state.chains.map((ch) => (
                    <span key={ch.puller + ch.pulled} className="fact la">{name(ch.puller)} 拉 {name(ch.pulled)} {ch.count}</span>
                  ))}
                </div>
              )}
              <div className="latest">
                {last ? <><span className="grow">{describe(last.event, name)}</span><span className="when">{ago(last.at, now)}</span></> : <span className="muted">未開始</span>}
              </div>
            </Link>
          );
        })}
      </section>

      {ranking.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2>全場排名</h2>
            <span className="muted small">計埋未找，水 {water}</span>
          </div>
          <div className="list">
            {ranking.map((r, i) => (
              <div key={r.id + r.table} className="listrow">
                <span className="num rank">{i + 1}</span>
                <Avatar name={r.name} size="sm" />
                <span className="grow ellipsis">{r.name}</span>
                <span className="muted small">{r.table}</span>
                <span className={`num ${tone(r.net)}`} style={{ fontSize: 18 }}>{fmt(r.net)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {feed.length > 0 && (
        <section className="stack">
          <h2>最新</h2>
          <ul className="log list feed">
            {feed.map((f) => (
              <li key={f.key}>
                <span className="where">{f.table.replace('第 ', '').replace(' 枱', '枱')}</span>
                <span className="who">{f.text}</span>
                <span className="when">{ago(f.at, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {invite && (
        <section className="panel">
          <h3>叫人入呢個大局</h3>
          <p className="muted small">未入牌友圈嘅人撳連結登入，會自動加入，再直接嚟呢度。</p>
          <CopyLink url={invite} />
        </section>
      )}
    </main>
  );
}
