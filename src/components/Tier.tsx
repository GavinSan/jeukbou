// 段位牌、成就牌、數字跳動、圓環：首頁同段位頁用
import { useEffect, useRef, useState } from 'react';
import type { Badge, Tier } from '../lib/stats.ts';

/** 段位：一隻象牙色牌，刻住段位字，邊框顏色分段 */
export function TierTile({ tier, size = 'md' }: { tier: Tier; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`tier-tile ${tier.cls} ${size}`} aria-label={tier.name} title={tier.name}>
      <span>{tier.mark}</span>
    </span>
  );
}

export function TierChip({ tier }: { tier: Tier }) {
  return <span className={`tier-chip ${tier.cls}`}>{tier.name}</span>;
}

export function BadgeTile({ b }: { b: Badge }) {
  return (
    <div className={`badge${b.got ? ' got' : ''}`} title={b.note}>
      <span className="badge-mark" aria-hidden="true">{b.mark}</span>
      <b>{b.name}</b>
      <small>{b.note}</small>
      {!b.got && <span className="badge-bar" aria-hidden="true"><i style={{ width: `${Math.round(b.progress * 100)}%` }} /></span>}
    </div>
  );
}

const reduce = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 數字由 0 跳上去 */
export function CountUp({ value, format = (n) => String(Math.round(n)), ms = 900, className }: { value: number; format?: (n: number) => string; ms?: number; className?: string }) {
  const [shown, setShown] = useState(reduce() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduce()) { setShown(value); return; }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className={className}>{format(shown)}</span>;
}

/** 圓環（勝率等） */
export function Ring({ value, size = 64, label }: { value: number; size?: number; label: string }) {
  const [v, setV] = useState(reduce() ? value : 0);
  useEffect(() => { const t = setTimeout(() => setV(value), 60); return () => clearTimeout(t); }, [value]);
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - v)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/** 升段進度條 */
export function Progress({ value }: { value: number }) {
  const [v, setV] = useState(reduce() ? value : 0);
  useEffect(() => { const t = setTimeout(() => setV(value), 80); return () => clearTimeout(t); }, [value]);
  return <span className="tier-progress" aria-hidden="true"><i style={{ width: `${Math.round(v * 100)}%` }} /></span>;
}
