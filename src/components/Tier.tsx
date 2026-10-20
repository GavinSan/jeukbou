// 段位牌、成就牌、數字跳動、圓環：首頁同段位頁用
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { go } from '../lib/router.tsx';
import type { Badge, Stats, Tier } from '../lib/stats.ts';
import { BADGE_CATS } from '../lib/stats.ts';

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

export function BadgeTile({ b, href }: { b: Badge; href?: string }) {
  const color = BADGE_CATS.find((c) => c.key === b.cat)?.color ?? '#C08A16';
  const cls = `badge${b.got ? ` got lv${b.level}` : ''}${href ? ' badge-link' : ''}`;
  const style = { '--bc': color } as CSSProperties;
  const body = (
    <>
      <span className="badge-mark" aria-hidden="true">{b.mark}</span>
      <b>{b.name}</b>
      <small>{b.note}</small>
      {!b.got && <span className="badge-bar" aria-hidden="true"><i style={{ width: `${Math.round(b.progress * 100)}%` }} /></span>}
    </>
  );
  if (!href) return <div className={cls} title={b.note} style={style}>{body}</div>;
  return (
    <a className={cls} title={b.note} style={style} href={href} onClick={(e: MouseEvent<HTMLAnchorElement>) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(href); }}>
      {body}
    </a>
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

/** 段位頁：成就按類顯示，每類 8 級，越高級越深色、會閃 */
export function BadgeCats({ badges, stats }: { badges: Badge[]; stats?: Stats }) {
  return (
    <div className="bcats">
      {BADGE_CATS.map((c, ci) => {
        const list = badges.filter((b) => b.cat === c.key);
        const got = list.filter((b) => b.got);
        const top = got[got.length - 1];
        const next = list.find((b) => !b.got);
        const need = c.need && stats ? c.need(stats) : null;
        const progressTxt = next ? (c.show ? c.show(next.now, next.goal) : `${next.now}/${next.goal} ${c.unit}`) : '';
        return (
          <div key={c.key} id={`badge-${c.key}`} className={`bcat${top ? ` lv${top.level}` : ''}`} style={{ '--bc': c.color, animationDelay: `${ci * 0.03}s` } as CSSProperties}>
            <div className="bcat-head">
              <span className={`badge-mark${top ? ` on lv${top.level}` : ''}`} aria-hidden="true">{c.mark}</span>
              <span className="grow">
                <b>{c.title}{top && <span className={`bcat-title lv${top.level}`}>{top.name}</span>}</b>
                <small className="muted">{need ?? (next ? `下一個「${next.name}」：${progressTxt}` : '全部完成！')}</small>
              </span>
              <span className="bcat-count num">{got.length}/{list.length}</span>
            </div>
            <span className="bcat-bar" aria-hidden="true"><i style={{ width: `${Math.round((next ? next.progress : 1) * 100)}%` }} /></span>
            <div className="bcat-tiers">
              {list.map((b) => (
                <span key={b.key} className={`btier lv${b.level}${b.got ? ' got' : ''}${b === next ? ' next' : ''}`} title={b.note}>
                  {b.name}<small>{c.show ? `${c.key === 'safe' ? 100 - b.goal : b.goal}%` : b.goal}</small>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
