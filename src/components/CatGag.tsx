// 詐糊：老貓燒鬚 —— 貓鬚燒著、冒煙、隻貓嚇親。兩款畫風：卡通橙貓、水墨黑貓
import { useEffect } from 'react';

/** 水墨黑貓：宣紙、墨圈、黑貓剪影、鬚燒著，蓋紅印 */
function InkCat({ name }: { name: string }) {
  const whiskers = [
    'M70 120 Q40 112 16 100', 'M70 128 Q40 128 12 130', 'M70 136 Q42 146 18 160',
    'M130 120 Q160 112 184 100', 'M130 128 Q160 128 188 130', 'M130 136 Q158 146 182 160',
  ];
  return (
    <div className="gag-card ink">
      <svg className="gag-cat" viewBox="0 0 200 200" aria-hidden="true">
        <circle className="ink-enso" cx="100" cy="104" r="86" fill="none" stroke="#1C1F1D" strokeWidth="9" strokeLinecap="round" strokeDasharray="480 60" opacity="0.18" />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} className="smoke ink-smoke" cx={i % 2 ? 22 : 178} cy={96 + (i % 3) * 22} r={8 + (i % 3) * 3} style={{ animationDelay: `${0.5 + i * 0.2}s` }} />
        ))}
        <path d="M52 92 L60 34 L92 70 Q100 66 108 70 L140 34 L148 92 Q160 128 140 156 Q100 182 60 156 Q40 128 52 92 Z" fill="#1C1F1D" />
        <g className="gag-eyes">
          <ellipse cx="80" cy="108" rx="13" ry="15" fill="#F2C14E" />
          <ellipse cx="120" cy="108" rx="13" ry="15" fill="#F2C14E" />
          <ellipse className="pupil" cx="80" cy="108" rx="3" ry="11" fill="#1C1F1D" />
          <ellipse className="pupil" cx="120" cy="108" rx="3" ry="11" fill="#1C1F1D" />
        </g>
        <path d="M94 130 L106 130 L100 136 Z" fill="#D9607A" />
        <path className="gag-mouth" d="M92 144 Q100 152 108 144" stroke="#F4EFDF" strokeWidth="3" fill="none" strokeLinecap="round" />
        {whiskers.map((d, i) => (
          <g key={i} className={`whisker ${i < 3 ? 'l' : 'r'}`} style={{ animationDelay: `${0.3 + (i % 3) * 0.12}s` }}>
            <path d={d} stroke="#F4EFDF" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </g>
        ))}
        {[[16, 100], [12, 130], [18, 160], [184, 100], [188, 130], [182, 160]].map(([x, y], i) => (
          <g key={i} className="flame" style={{ animationDelay: `${0.2 + (i % 3) * 0.1}s`, transformOrigin: `${x}px ${y}px` }}>
            <path d={`M${x} ${y + 6} q-9 -10 -2 -20 q2 8 6 6 q-2 -10 6 -14 q-2 10 5 16 q4 8 -4 12 z`} fill="#B02E26" />
            <path d={`M${x + 1} ${y + 5} q-4 -6 0 -11 q2 5 5 3 q2 6 -5 8 z`} fill="#F2C14E" />
          </g>
        ))}
      </svg>
      <div className="gag-text ink-text">
        <b>老貓燒鬚</b>
        <span>{name} 詐糊</span>
        <i className="ink-seal" aria-hidden="true">詐</i>
      </div>
    </div>
  );
}

export default function CatGag({ name, onDone, variant = 0 }: { name: string; onDone: () => void; variant?: number }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  if (variant === 1) return <div className="gag ink-bg" role="status" aria-live="polite"><InkCat name={name} /></div>;
  const whiskers = [
    { d: 'M58 118 L8 104', s: 'l' }, { d: 'M58 126 L6 126', s: 'l' }, { d: 'M58 134 L10 148', s: 'l' },
    { d: 'M142 118 L192 104', s: 'r' }, { d: 'M142 126 L194 126', s: 'r' }, { d: 'M142 134 L190 148', s: 'r' },
  ];
  return (
    <div className="gag" role="status" aria-live="polite">
      <div className="gag-card">
        <svg className="gag-cat" viewBox="0 0 200 200" aria-hidden="true">
          {/* 煙 */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <circle key={i} className="smoke" cx={i % 2 ? 16 : 184} cy={110 + (i % 3) * 14} r={7 + (i % 3) * 3} style={{ animationDelay: `${0.6 + i * 0.18}s` }} />
          ))}
          {/* 耳 */}
          <path d="M42 70 L56 18 L92 52 Z" fill="#E9A24A" stroke="#7A4A1C" strokeWidth="4" strokeLinejoin="round" />
          <path d="M158 70 L144 18 L108 52 Z" fill="#E9A24A" stroke="#7A4A1C" strokeWidth="4" strokeLinejoin="round" />
          <path d="M55 58 L60 34 L78 51 Z" fill="#F7C9C0" />
          <path d="M145 58 L140 34 L122 51 Z" fill="#F7C9C0" />
          {/* 頭 */}
          <ellipse cx="100" cy="110" rx="68" ry="60" fill="#F2B45F" stroke="#7A4A1C" strokeWidth="4" />
          <path d="M100 52 L100 72 M84 56 L88 72 M116 56 L112 72" stroke="#C9822E" strokeWidth="4" strokeLinecap="round" />
          {/* 驚到眼大大 */}
          <g className="gag-eyes">
            <circle cx="74" cy="100" r="15" fill="#FFF" stroke="#3A2410" strokeWidth="3" />
            <circle cx="126" cy="100" r="15" fill="#FFF" stroke="#3A2410" strokeWidth="3" />
            <circle className="pupil" cx="74" cy="100" r="5" fill="#1C1F1D" />
            <circle className="pupil" cx="126" cy="100" r="5" fill="#1C1F1D" />
          </g>
          <path d="M94 122 L106 122 L100 129 Z" fill="#D9607A" />
          <ellipse className="gag-mouth" cx="100" cy="146" rx="10" ry="12" fill="#5A1E14" />
          {/* 汗 */}
          <path className="sweat" d="M160 78 q6 10 0 16 q-6 -6 0 -16 z" fill="#7FD1FF" />
          {/* 鬚：慢慢燒短 */}
          {whiskers.map((w, i) => (
            <g key={i} className={`whisker ${w.s}`} style={{ animationDelay: `${0.3 + (i % 3) * 0.12}s` }}>
              <path d={w.d} stroke="#3A2410" strokeWidth="3" strokeLinecap="round" fill="none" />
            </g>
          ))}
          {/* 火 */}
          {[[10, 104], [6, 126], [12, 148], [190, 104], [194, 126], [188, 148]].map(([x, y], i) => (
            <g key={i} className="flame" style={{ animationDelay: `${0.2 + (i % 3) * 0.1}s`, transformOrigin: `${x}px ${y}px` }}>
              <path d={`M${x} ${y + 6} q-9 -10 -2 -20 q2 8 6 6 q-2 -10 6 -14 q-2 10 5 16 q4 8 -4 12 z`} fill="#FF8A3D" />
              <path d={`M${x + 1} ${y + 5} q-4 -6 0 -11 q2 5 5 3 q2 6 -5 8 z`} fill="#FFE07A" />
            </g>
          ))}
        </svg>
        <div className="gag-text">
          <b>老貓燒鬚！</b>
          <span>{name} 詐糊</span>
        </div>
      </div>
    </div>
  );
}
