// 橫向滾輪揀番數：左右碌，中間嗰個就係；撳其他數字跳過去，撳中間個數字可以自己打
import { useEffect, useRef, useState } from 'react';
import { buzz } from '../lib/haptics.ts';

const ITEM = 52;
const MAX = 500;

export default function FanRoller({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef<number | null>(null);
  const programmatic = useRef(false);
  const live = useRef(value);
  const [shown, setShown] = useState(value);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState(String(value));

  // 外面改咗（快捷掣、加減、番數表）就碌去嗰個數
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setShown(value);
    live.current = value;
    const target = value * ITEM;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    programmatic.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' });
    const t = setTimeout(() => { programmatic.current = false; }, 450);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = value * ITEM;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const v = Math.max(0, Math.min(MAX, Math.round(el.scrollLeft / ITEM)));
    // 碌嘅時候中間個數即刻變大，輕輕震一下
    if (v !== live.current) {
      live.current = v;
      setShown(v);
      if (!programmatic.current) buzz('tick');
    }
    if (programmatic.current) return;
    if (settling.current) window.clearTimeout(settling.current);
    settling.current = window.setTimeout(() => { if (v !== value) onChange(v); }, 110);
  }

  function commitDraft() {
    const n = Math.max(0, Math.min(MAX, Math.round(Number(draft) || 0)));
    setTyping(false);
    onChange(n);
  }

  // 只畫附近嘅數字就夠，但要保持闊度：用前後空位撐
  const from = Math.max(0, shown - 30);
  const to = Math.min(MAX, shown + 30);
  return (
    <div className="roller-wrap">
      <div
        ref={ref}
        className="roller"
        onScroll={onScroll}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`roll-opt-${shown}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(Math.max(0, value - 1)); }
          if (e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(MAX, value + 1)); }
        }}
      >
        <span className="roller-pad" aria-hidden="true" />
        <span style={{ flex: `0 0 ${from * ITEM}px` }} aria-hidden="true" />
        {Array.from({ length: to - from + 1 }, (_, i) => {
          const n = from + i;
          const d = Math.abs(n - shown);
          return (
            <span
              key={n}
              id={`roll-opt-${n}`}
              role="option"
              aria-selected={n === shown}
              className={`roller-item${d === 0 ? ' on' : d === 1 ? ' near' : d === 2 ? ' far' : ''}${n >= 100 ? ' hot2' : n >= 70 ? ' hot1' : ''}`}
              style={{ width: ITEM }}
              onClick={() => (n === value ? (setDraft(String(value)), setTyping(true)) : onChange(n))}
            >
              {n}
            </span>
          );
        })}
        <span style={{ flex: `0 0 ${(MAX - to) * ITEM}px` }} aria-hidden="true" />
        <span className="roller-pad" aria-hidden="true" />
      </div>
      <div className="roller-band" aria-hidden="true"><span>番</span></div>
      {typing && (
        <input
          className="roller-input num"
          type="text"
          inputMode="numeric"
          autoFocus
          value={draft}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, 3))}
          onBlur={commitDraft}
          onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); }}
          aria-label={label}
        />
      )}
    </div>
  );
}
