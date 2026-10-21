// 龍虎榜：按日／月／季／年／全部睇；走勢圖、可以排序嘅排行表；撳人睇佢喺呢個牌友圈嘅個人統計
import { useMemo, useState } from 'react';
import { Leaderboard, TrendChart } from './Charts.tsx';
import { boardRows } from '../lib/history.ts';
import type { SessionResult } from '../lib/history.ts';
import { Link } from '../lib/router.tsx';
import { Sheet, fmt } from '../ui.tsx';
import { addPlay, emptyPlay } from '../lib/score.ts';
import Awards, { PlayTable } from './Awards.tsx';

type Period = 'day' | 'month' | 'quarter' | 'year' | 'all';
const PERIODS: [Period, string][] = [['day', '日'], ['month', '月'], ['quarter', '季'], ['year', '年'], ['all', '全部']];

function rangeOf(p: Period, anchor: Date): [number, number] {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);
  if (p === 'day') { const e = new Date(d); e.setDate(e.getDate() + 1); return [d.getTime(), e.getTime()]; }
  if (p === 'quarter') { d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1); const e = new Date(d); e.setMonth(e.getMonth() + 3); return [d.getTime(), e.getTime()]; }
  if (p === 'month') { d.setDate(1); const e = new Date(d); e.setMonth(e.getMonth() + 1); return [d.getTime(), e.getTime()]; }
  if (p === 'year') { d.setMonth(0, 1); const e = new Date(d); e.setFullYear(e.getFullYear() + 1); return [d.getTime(), e.getTime()]; }
  return [0, Infinity];
}

function shift(p: Period, anchor: Date, dir: number): Date {
  const d = new Date(anchor);
  if (p === 'day') d.setDate(d.getDate() + dir);
  if (p === 'quarter') d.setMonth(d.getMonth() + 3 * dir);
  if (p === 'month') d.setMonth(d.getMonth() + dir);
  if (p === 'year') d.setFullYear(d.getFullYear() + dir);
  return d;
}

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

function labelOf(p: Period, anchor: Date): string {
  const [a, b] = rangeOf(p, anchor);
  if (p === 'day') return md(a);
  if (p === 'quarter') return `${new Date(a).getFullYear()}年第 ${Math.floor(new Date(a).getMonth() / 3) + 1} 季（${new Date(a).getMonth() + 1}–${new Date(b - 1).getMonth() + 1}月）`;
  if (p === 'month') return `${new Date(a).getFullYear()}年${new Date(a).getMonth() + 1}月`;
  if (p === 'year') return `${new Date(a).getFullYear()}年`;
  return '全部日子';
}

export default function BoardView({ sessions, names, me, sessionHref }: {
  sessions: SessionResult[]; names: Record<string, string>; me?: string | null; sessionHref?: (id: string) => string;
}) {
  const [period, setPeriod] = useState<Period>('all');
  const [anchor, setAnchor] = useState(() => {
    const last = sessions[sessions.length - 1];
    return last ? new Date(last.at) : new Date();
  });
  const [pick, setPick] = useState<string | null>(null);

  const inRange = useMemo(() => {
    const [a, b] = rangeOf(period, anchor);
    return sessions.filter((s) => s.at >= a && s.at < b);
  }, [sessions, period, anchor]);
  const rows = useMemo(() => boardRows(inRange, names), [inRange, names]);
  const play = useMemo(() => inRange.reduce((acc, x) => (x.play ? addPlay(acc, x.play) : acc), emptyPlay()), [inRange]);
  const days = new Set(inRange.map((s) => md(s.at))).size;
  // 走勢：所有人，每個大局之後累計（自己條線 highlight）
  const trend = useMemo(() => {
    const sorted = [...inRange].sort((a, b) => a.at - b.at);
    if (sorted.length < 2) return null;
    const pickIds = rows.map((r) => r.id);
    const series = pickIds.map((id) => {
      let acc = 0;
      return { id, name: names[id] || '玩家', values: [0, ...sorted.map((x) => (acc += x.totals[id] ?? 0))] };
    });
    return { series, labels: ['開始', ...sorted.map((x) => md(x.at))] };
  }, [inRange, rows, me, names]);

  return (
    <div className="stack">
      <div className="seg wide" role="tablist" aria-label="時間">
        {PERIODS.map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={period === k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{t}</button>
        ))}
      </div>
      {period !== 'all' && (
        <div className="period-nav">
          <button type="button" className="iconbtn small" aria-label="上一段" onClick={() => setAnchor(shift(period, anchor, -1))}>‹</button>
          <b>{labelOf(period, anchor)}</b>
          <button type="button" className="iconbtn small" aria-label="下一段" onClick={() => setAnchor(shift(period, anchor, 1))}>›</button>
        </div>
      )}
      <p className="muted small center-text">{inRange.length} 次大局 · {days} 日 · 撳名睇個人統計</p>
      {rows.length ? (
        <div className="list pad"><Leaderboard rows={rows} me={me} onPick={setPick} /></div>
      ) : <p className="muted center-text">此段時間未有紀錄。</p>}
      {trend && (
        <section className="stack">
          <h2 className="section-head">走勢</h2>
          <div className="list pad"><TrendChart series={trend.series} labels={trend.labels} me={me} /></div>
        </section>
      )}
      {rows.length > 0 && (
        <section className="stack">
          <h2 className="section-head">排行表</h2>
          <BoardTable sessions={inRange} names={names} me={me} onPick={setPick} />
        </section>
      )}
      {play.hands > 0 && (
        <section className="stack">
          <h2 className="section-head">數據</h2>
          <PlayTable play={play} ids={rows.map((r) => r.id)} name={(id) => names[id] || '玩家'} me={me} />
          <Awards play={play} name={(id) => names[id] || '玩家'} />
          {inRange.some((x) => !x.play) && <p className="muted small">匯入嘅舊紀錄只有總數，冇食糊、自摸呢啲數據。</p>}
        </section>
      )}
      {pick && (
        <PlayerSheet
          id={pick}
          name={names[pick] || '玩家'}
          sessions={inRange.filter((s) => pick in s.totals)}
          all={sessions.filter((s) => pick in s.totals)}
          scope={labelOf(period, anchor)}
          sessionHref={sessionHref}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}

type BoardKey = 'total' | 'rounds' | 'avg' | 'best' | 'rate';
const BOARD_COLS: [BoardKey, string][] = [['total', '總數'], ['rounds', '圈'], ['avg', '每圈'], ['best', '最好一次'], ['rate', '贏錢率']];

/** 排行表：撳表頭排序 */
function BoardTable({ sessions, names, me, onPick }: { sessions: SessionResult[]; names: Record<string, string>; me?: string | null; onPick: (id: string) => void }) {
  const [sort, setSort] = useState<BoardKey>('total');
  const [asc, setAsc] = useState(false);
  const acc = new Map<string, { id: string; total: number; played: number; best: number; wins: number; rounds: number; detailedTotal: number }>();
  for (const s of sessions) {
    for (const [id, v] of Object.entries(s.totals)) {
      const r = acc.get(id) ?? { id, total: 0, played: 0, best: -Infinity, wins: 0, rounds: 0, detailedTotal: 0 };
      r.total += v; r.played += 1; r.best = Math.max(r.best, v); if (v > 0) r.wins += 1;
      const rd = s.play?.rounds?.[id] ?? 0;
      if (rd > 0) { r.rounds += rd; r.detailedTotal += v; }
      acc.set(id, r);
    }
  }
  // 每圈 = 有圈數紀錄嘅大局總數 ÷ 圈數（舊紀錄冇圈數，唔計）
  const rows = [...acc.values()].map((r) => ({
    ...r, rounds: Math.round(r.rounds), avg: r.rounds > 0 ? Math.round(r.detailedTotal / r.rounds) : 0,
    rate: Math.round((r.wins / r.played) * 100), best: Number.isFinite(r.best) ? r.best : 0,
  }));
  rows.sort((a, b) => (asc ? a[sort] - b[sort] : b[sort] - a[sort]) || b.total - a.total);
  const tone = (v: number) => (v > 0 ? 'gain' : v < 0 ? 'loss' : '');
  return (
    <div className="ledger settle-table board-table">
      <div className="st-row st-head six">
        <span>玩家</span>
        {BOARD_COLS.map(([k, label]) => (
          <button key={k} type="button" className={`sort-th${sort === k ? ' on' : ''}`} aria-pressed={sort === k} onClick={() => { if (sort === k) setAsc((v) => !v); else { setSort(k); setAsc(false); } }}>
            {label}{sort === k ? (asc ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>
      {rows.map((r, i) => (
        <button key={r.id} type="button" className={`st-row six st-tap${r.id === me ? ' me' : ''}`} onClick={() => onPick(r.id)}>
          <span className="ellipsis"><span className="rank-no">{i + 1}</span>{names[r.id] || '玩家'}</span>
          <b className={`num ${tone(r.total)}`}>{fmt(r.total)}</b>
          <span className="num">{r.rounds || '–'}</span>
          <span className={`num ${tone(r.avg)}`}>{r.rounds ? fmt(r.avg) : '–'}</span>
          <span className="num gain">{fmt(r.best)}</span>
          <span className="num">{r.rate}%</span>
        </button>
      ))}
    </div>
  );
}

export function PlayerSheet({ id, name, sessions, all, scope, sessionHref, onClose }: {
  id: string; name: string; sessions: SessionResult[]; all: SessionResult[]; scope: string; sessionHref?: (id: string) => string; onClose: () => void;
}) {
  const vals = sessions.map((s) => s.totals[id] ?? 0);
  const total = vals.reduce((a, b) => a + b, 0);
  const wins = vals.filter((v) => v > 0).length;
  const best = vals.length ? Math.max(...vals) : 0;
  const worst = vals.length ? Math.min(...vals) : 0;
  const lifetime = all.reduce((a, s) => a + (s.totals[id] ?? 0), 0);
  const max = Math.max(1, ...vals.map(Math.abs));
  return (
    <Sheet onClose={onClose} label={`${name} 統計`}>
      <div className="between">
        <h2>{name}</h2>
        <span className="muted small">{scope}</span>
      </div>
      <div className="stat-grid">
        <div><small>總數</small><b className={`num ${total > 0 ? 'gain' : total < 0 ? 'loss' : ''}`}>{fmt(total)}</b></div>
        <div><small>次數</small><b className="num">{vals.length}</b></div>
        <div><small>勝率</small><b className="num">{vals.length ? Math.round((wins / vals.length) * 100) : 0}%</b></div>
        <div><small>平均</small><b className="num">{vals.length ? fmt(Math.round(total / vals.length)) : '0'}</b></div>
        <div><small>最好</small><b className="num gain">{fmt(best)}</b></div>
        <div><small>最差</small><b className="num loss">{fmt(worst)}</b></div>
      </div>
      {(() => {
        const pl = sessions.reduce((acc, x) => (x.play ? addPlay(acc, x.play) : acc), emptyPlay());
        if (!pl.hands) return null;
        return (
          <div className="stat-grid">
            <div><small>食糊</small><b className="num">{pl.wins[id] ?? 0}</b></div>
            <div><small>自摸</small><b className="num gain">{pl.selfDraws[id] ?? 0}</b></div>
            <div><small>出銃</small><b className="num loss">{pl.dealIns[id] ?? 0}</b></div>
            <div><small>最大一鋪</small><b className="num">{pl.best[id] ?? 0}</b></div>
          </div>
        );
      })()}
      {vals.length > 1 && (
        <svg className="mini-bars" viewBox={`0 0 ${vals.length * 14} 80`} preserveAspectRatio="none" aria-label="每場上落">
          <line x1="0" x2={vals.length * 14} y1="40" y2="40" className="viz-zero" />
          {vals.map((v, i) => {
            const h = (Math.abs(v) / max) * 36;
            return <rect key={i} x={i * 14 + 2} y={v >= 0 ? 40 - h : 40} width="10" height={Math.max(1, h)} rx="2" className={v >= 0 ? 'bar-gain' : 'bar-loss'} />;
          })}
        </svg>
      )}
      <ul className="list exp-list">
        {[...sessions].reverse().map((s) => {
          const v = s.totals[id] ?? 0;
          const body = <><span className="grow exp-text"><span>{s.name}</span><small className="muted">{md(s.at)}</small></span><b className={`num ${v > 0 ? 'gain' : v < 0 ? 'loss' : ''}`}>{fmt(v)}</b></>;
          return <li key={s.id} className="exp-row">{sessionHref ? <Link to={sessionHref(s.id)} className="row-link">{body}</Link> : body}</li>;
        })}
      </ul>
      <p className="muted small">在此牌友圈累計：<b className={`num ${lifetime > 0 ? 'gain' : lifetime < 0 ? 'loss' : ''}`}>{fmt(lifetime)}</b>（{all.length} 次）</p>
      <button type="button" className="btn plain" onClick={onClose}>關閉</button>
    </Sheet>
  );
}
