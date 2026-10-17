// 三粒骰：碌一陣先停，全枱手機同步見到
import { useEffect, useState } from 'react';

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

export function Die({ value, rolling, delay = 0 }: { value: number; rolling: boolean; delay?: number }) {
  const red = value === 1 || value === 4;
  return (
    <svg className={`die${rolling ? ' rolling' : ''}`} style={{ animationDelay: `${delay}ms` }} viewBox="0 0 100 100" width="64" height="64" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="18" fill="#FBF8EE" stroke="#C9C2AE" strokeWidth="3" />
      {PIPS[value].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={value === 1 ? 13 : 9} fill={red ? '#B02E26' : '#1C1F1D'} />
      ))}
    </svg>
  );
}

/** 擲骰動畫：rolling 期間每 80ms 換一次面，之後停喺真正嘅點數 */
export default function DiceRoll({ values, onDone }: { values: number[]; onDone?: () => void }) {
  const [faces, setFaces] = useState<number[]>(() => values.map(() => 1 + Math.floor(Math.random() * 6)));
  const [rolling, setRolling] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setFaces(values); setRolling(false); onDone?.(); return; }
    const spin = window.setInterval(() => setFaces(values.map(() => 1 + Math.floor(Math.random() * 6))), 80);
    const stop = window.setTimeout(() => {
      window.clearInterval(spin);
      setFaces(values);
      setRolling(false);
      onDone?.();
    }, 900);
    return () => { window.clearInterval(spin); window.clearTimeout(stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.join(',')]);

  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="dice-box">
      <div className="dice-row">
        {faces.map((f, i) => <Die key={i} value={f} rolling={rolling} delay={i * 60} />)}
      </div>
      <p className="dice-total" aria-live="polite">{rolling ? ' ' : `${total} 點`}</p>
    </div>
  );
}
