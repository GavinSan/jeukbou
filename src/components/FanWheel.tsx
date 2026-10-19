// iPhone 式滾輪揀番數：上下碌，中間嗰個就係；亦可以撳中間個數字自己打
import { useEffect, useRef, useState } from 'react';
import { buzz } from '../lib/haptics.ts';

const MAX = 500;

export default function FanWheel({ value, onChange, label, item: ITEM = 48, visible: VISIBLE = 5, compact = false }: {
  value: number; onChange: (v: number) => void; label: string; item?: number; visible?: number; compact?: boolean;
}) {
  const live = useRef(value);
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef<number | null>(null);
  const programmatic = useRef(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState(String(value));

  // 外面改咗（快捷掣、加減）就碌去嗰個數
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    live.current = value;
    setShown(value);
    const target = value * ITEM;
    if (Math.abs(el.scrollTop - target) < 2) return;
    programmatic.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' });
    const t = setTimeout(() => { programmatic.current = false; }, 400);
    return () => clearTimeout(t);
  }, [value]);

  // 第一次出現時直接跳去嗰個數
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = value * ITEM;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onScroll() {
    const now = ref.current ? Math.max(0, Math.min(MAX, Math.round(ref.current.scrollTop / ITEM))) : value;
    // 碌緊嘅時候中間個數即刻變大，輕輕震一下
    if (now !== live.current) {
      live.current = now;
      setShown(now);
      if (!programmatic.current) buzz('tick');
    }
    if (programmatic.current) return;
    if (settling.current) window.clearTimeout(settling.current);
    settling.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const v = Math.max(0, Math.min(MAX, Math.round(el.scrollTop / ITEM)));
      if (v !== value) onChange(v);
    }, 90);
  }

  function commitDraft() {
    const n = Math.max(0, Math.min(MAX, Math.round(Number(draft) || 0)));
    setTyping(false);
    onChange(n);
  }

  return (
    <div className={`wheel-wrap${compact ? ' compact' : ''}`}>
      <div
        ref={ref}
        className="wheel"
        style={{ height: ITEM * VISIBLE, paddingBlock: (ITEM * (VISIBLE - 1)) / 2 }}
        onScroll={onScroll}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`fan-opt-${shown}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.max(0, value - 1)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.min(MAX, value + 1)); }
        }}
      >
        {Array.from({ length: MAX + 1 }, (_, n) => (
          <div
            key={n}
            id={`fan-opt-${n}`}
            role="option"
            aria-selected={n === shown}
            className={`wheel-item${n === shown ? ' on' : ''}${Math.abs(n - shown) === 1 ? ' near' : ''}${n === shown && n >= 100 ? ' hot2' : n === shown && n >= 70 ? ' hot1' : ''}`}
            style={{ height: ITEM }}
            onClick={() => (n === value ? (setDraft(String(value)), setTyping(true)) : onChange(n))}
          >
            {n}
          </div>
        ))}
      </div>
      <div className="wheel-band" aria-hidden="true"><span className="wheel-unit">番</span></div>
      {typing && (
        <input
          className="wheel-input"
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
