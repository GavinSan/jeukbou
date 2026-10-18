// 圖表：走勢線（每鋪之後各人累計）、細走勢線、龍虎榜橫條
// 顏色：四個分類色（已用色盲檢查），文字一律用文字色，唔用系列色。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, RefObject } from 'react';
import { fmt } from '../ui.tsx';

export interface Series {
  id: string;
  name: string;
  values: number[];
}

/** 好睇嘅刻度：0、±50、±100… */
function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  const top = Math.ceil(max / step) * step;
  for (let v = Math.floor(min / step) * step; v <= top + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** 走勢：x = 第幾鋪，y = 累計（找咗 + 枱面） */
export function TrendChart({ series, labels, me }: { series: Series[]; labels: string[]; me?: string | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const pad = { l: 36, r: 12, t: 12, b: 22 };
  const n = Math.max(1, ...series.map((s) => s.values.length)) - 1;
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (i: number) => pad.l + (n ? (i / n) * (width - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);

  const ordered = useMemo(() => [...series].sort((a, b) => (b.values.at(-1) ?? 0) - (a.values.at(-1) ?? 0)), [series]);

  function onMove(e: RPointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.round(((px - 0) / box.width) * n);
    setHover(Math.max(0, Math.min(n, i)));
  }

  if (n < 1) return null;
  const hx = hover !== null ? x(hover) : 0;
  const tipLeft = hover !== null && hx > width / 2;

  return (
    <figure className="viz" aria-label="各人累計走勢">
      <div className="viz-legend">
        {ordered.map((s) => {
          const slot = series.indexOf(s) + 1;
          const v = hover !== null ? s.values[Math.min(hover, s.values.length - 1)] ?? 0 : s.values.at(-1) ?? 0;
          return (
            <span key={s.id} className={`viz-key${s.id === me ? ' me' : ''}`}>
              <i style={{ background: `var(--s${slot})` }} />
              <span className="ellipsis">{s.name}</span>
              <b className="num">{fmt(v)}</b>
            </span>
          );
        })}
      </div>
      <div ref={ref} className="viz-plot">
        <svg width={width} height={H} role="img" aria-label={`走勢圖，共 ${n} 鋪`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-zero' : 'viz-grid'} />
              <text x={pad.l - 6} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">{t}</text>
            </g>
          ))}
          <text x={pad.l} y={H - 4} className="viz-tick">{labels[0] ?? '開局'}</text>
          <text x={width - pad.r} y={H - 4} className="viz-tick" textAnchor="end">{labels[n] ?? `第 ${n} 鋪`}</text>
          {series.map((s, k) => (
            <polyline
              key={s.id}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={`var(--s${k + 1})`}
              strokeWidth={s.id === me ? 2.5 : 2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {series.map((s, k) => {
            const i = s.values.length - 1;
            return <circle key={s.id} cx={x(i)} cy={y(s.values[i])} r={4} fill={`var(--s${k + 1})`} className="viz-dot" />;
          })}
          {hover !== null && (
            <g>
              <line x1={hx} x2={hx} y1={pad.t} y2={H - pad.b} className="viz-cross" />
              {series.map((s, k) => (hover < s.values.length ? <circle key={s.id} cx={hx} cy={y(s.values[hover])} r={4.5} fill={`var(--s${k + 1})`} className="viz-dot" /> : null))}
            </g>
          )}
          <rect
            x={pad.l}
            y={0}
            width={Math.max(0, width - pad.l - pad.r)}
            height={H}
            fill="transparent"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={onMove}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <div className="viz-tip" style={tipLeft ? { right: width - hx + 10 } : { left: hx + 10 }}>
            <b>{hover === 0 ? '開局' : labels[hover] ?? `第 ${hover} 鋪`}</b>
          </div>
        )}
      </div>
    </figure>
  );
}

/** 細走勢線：一條線，尾點按升跌上色 */
export function Sparkline({ values, width = 64, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span style={{ width, display: 'inline-block' }} />;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6);
  const end = values[values.length - 1];
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} className="viz-grid" />
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" className="spark-line" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(end)} r={3} className={`spark-end ${end > 0 ? 'gain' : end < 0 ? 'loss' : 'even'}`} />
    </svg>
  );
}

export interface BoardRow {
  id: string;
  name: string;
  total: number;
  sessions: number;
  best: number;
  history: number[];
}

/** 龍虎榜：由中線向左右嘅橫條，數字喺條尾 */
export function Leaderboard({ rows, me }: { rows: BoardRow[]; me?: string | null }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.total)));
  return (
    <ol className="board">
      {rows.map((r, i) => {
        const pct = (Math.abs(r.total) / max) * 50;
        return (
          <li key={r.id} className={r.id === me ? 'me' : ''}>
            <span className="board-rank">{i === 0 && r.total > 0 ? '龍' : i === rows.length - 1 && r.total < 0 ? '虎' : i + 1}</span>
            <span className="board-who">
              <span className="ellipsis">{r.name}</span>
              <small>{r.sessions} 場 · 最佳 {fmt(r.best)}</small>
            </span>
            <span className="board-bar" title={`${r.name} ${fmt(r.total)}`}>
              <span className="board-axis" />
              <span className={`board-fill ${r.total >= 0 ? 'gain' : 'loss'}`} style={r.total >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }} />
            </span>
            <b className={`num board-val ${r.total > 0 ? 'gain' : r.total < 0 ? 'loss' : 'even'}`}>{fmt(r.total)}</b>
          </li>
        );
      })}
    </ol>
  );
}
