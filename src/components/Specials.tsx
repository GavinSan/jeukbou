// 特別事項：每款一張有圖嘅卡（草、花、槓、骰…），撳落去會郁；入咗數枱面會飄啲嘢
import type { CSSProperties } from 'react';
import type { TableEvent } from '../engine/table.ts';

export type Art = 'kong' | 'heaven' | 'flower' | 'grass' | 'triple' | 'dice123' | 'pong' | 'chase' | 'false' | 'forgot';

export interface SpecialItem {
  art: Art;
  label: string;
  amount: number;
  dir: 'collect' | 'pay';
  note: string;
}

export const SPECIAL_ITEMS: SpecialItem[] = [
  { art: 'flower', label: '一台花', amount: 5, dir: 'collect', note: '收每家 5' },
  { art: 'grass', label: '一台草', amount: 2, dir: 'collect', note: '收每家 2' },
  { art: 'kong', label: '暗槓', amount: 5, dir: 'collect', note: '收每家 5' },
  // 天槓：每家俾 $10；番數按埋數設定換算（6 番 = $1 就係 60 番）
  { art: 'heaven', label: '天槓', amount: 10, dir: 'collect', note: '收每家 10' },
  { art: 'triple', label: '圍骰', amount: 5, dir: 'collect', note: '收每家 5' },
  { art: 'dice123', label: '骰開一二三', amount: 5, dir: 'pay', note: '付每家 5' },
  { art: 'pong', label: '叫碰唔碰', amount: 5, dir: 'pay', note: '付每家 5' },
  { art: 'chase', label: '被追', amount: 5, dir: 'pay', note: '番子 5、非番子 10' },
  // 詐糊：金額跟家規（falseWinPenalty）
  { art: 'false', label: '詐糊', amount: 0, dir: 'pay', note: '付每家' },
];

/** 追牌：番子 5、非番子 10；即摸 +5，即摸 2 隻 +10，即摸 3 隻 +15（最多 3 隻） */
export const CHASE_MAX_REPEAT = 2;


/** 被追：番子 5、非番子 10；即摸每隻 +5（最多 3 隻） */
export function chaseAmount(kind: 'fan' | 'other', repeat: number, instant = true): number {
  const extra = instant ? 1 + Math.max(0, Math.min(CHASE_MAX_REPEAT, repeat)) : 0;
  return (kind === 'fan' ? 5 : 10) + 5 * extra;
}

/** 上一鋪都係同一類、即摸嘅被追，就建議「同一隻」再加一次 */
export function suggestRepeat(last: TableEvent | undefined, kind: 'fan' | 'other'): number {
  if (!last || last.type !== 'special' || last.meta?.art !== 'chase' || last.meta.chase !== kind || last.meta.instant === false) return 0;
  return Math.min(CHASE_MAX_REPEAT, (last.meta.repeat ?? 0) + 1);
}

/** 舊紀錄冇 meta，就由名猜返係邊款 */
export function artOf(e: TableEvent): Art | null {
  if (e.type !== 'special') return null;
  if (e.meta?.art) return e.meta.art as Art;
  const hit = SPECIAL_ITEMS.find((s) => e.label.startsWith(s.label));
  return hit?.art ?? null;
}

const INK = '#1C1F1D';
const RED = '#B02E26';
const GREEN = '#2E7D5B';
const BLUE = '#24508F';

/** 卡背景圖：全部係 SVG，play 時會郁 */
export function SpecialArt({ art, heat = 0 }: { art: Art; heat?: number }) {
  switch (art) {
    case 'grass':
      return (
        <svg className="sp-art grass" viewBox="0 0 160 90" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          {[8, 22, 34, 48, 61, 75, 88, 101, 114, 128, 141, 153].map((x, i) => (
            <path
              key={x}
              className="blade"
              style={{ '--d': `${(i % 4) * 0.08}s`, transformOrigin: `${x}px 90px` } as CSSProperties}
              d={`M${x} 90 Q${x + (i % 2 ? 6 : -6)} ${60 - (i % 3) * 8} ${x + (i % 2 ? 2 : -3)} ${30 + (i % 4) * 7}`}
              stroke={i % 3 ? GREEN : '#4E9A6E'}
              strokeWidth={i % 2 ? 3.4 : 2.6}
              strokeLinecap="round"
              fill="none"
            />
          ))}
          {[30, 95, 140].map((x) => <circle key={x} cx={x} cy={84} r={2} fill="#7DBB8F" />)}
        </svg>
      );
    case 'flower': {
      const blossoms: [number, number, number, string][] = [[30, 30, 1, RED], [118, 22, 0.8, '#D9607A'], [86, 62, 1.1, RED], [140, 70, 0.7, '#D9607A'], [16, 72, 0.6, '#D9607A']];
      return (
        <svg className="sp-art flower" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M0 80 Q40 50 80 58 T160 30" stroke="#6B4A2E" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M60 58 Q66 40 84 34" stroke="#6B4A2E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          {blossoms.map(([x, y, s, c], i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
              <g className="bloom" style={{ '--d': `${i * 0.07}s` } as CSSProperties}>
                {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-7" rx="5.5" ry="7" fill={c} transform={`rotate(${a})`} opacity="0.92" />)}
                <circle r="2.6" fill="#F2C14E" />
              </g>
            </g>
          ))}
        </svg>
      );
    }
    case 'kong':
      return (
        <svg className="sp-art side kong" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <g key={i} className="kong-tile" style={{ '--d': `${i * 0.08}s`, transformOrigin: `${34 + i * 31}px 64px` } as CSSProperties}>
              <rect x={20 + i * 31} y={26} width={28} height={40} rx={4} fill={GREEN} />
              <rect x={20 + i * 31} y={22} width={28} height={40} rx={4} fill="#3B9670" />
            </g>
          ))}
        </svg>
      );
    case 'heaven':
      return (
        <svg className="sp-art side heaven" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <radialGradient id="hv-glow" cx="50%" cy="55%" r="55%"><stop offset="0" stopColor="#FFE9A8" stopOpacity="0.95" /><stop offset="1" stopColor="#FFE9A8" stopOpacity="0" /></radialGradient>
            <linearGradient id="hv-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFE7A0" /><stop offset="0.55" stopColor="#E3B23C" /><stop offset="1" stopColor="#B8860B" /></linearGradient>
          </defs>
          <g className="hv-rays" style={{ transformOrigin: '80px 50px' } as CSSProperties}>
            {Array.from({ length: 12 }, (_, i) => <path key={i} d="M80 50 L76 -20 L84 -20 Z" fill="#F2C14E" opacity="0.35" transform={`rotate(${i * 30} 80 50)`} />)}
          </g>
          <circle cx="80" cy="50" r="48" fill="url(#hv-glow)" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i} className="hv-tile" style={{ '--d': `${i * 0.12}s`, transformOrigin: `${34 + i * 31}px 64px` } as CSSProperties}>
              <rect x={20 + i * 31} y={28} width={28} height={40} rx={4} fill="#9A6B0B" />
              <rect x={20 + i * 31} y={24} width={28} height={40} rx={4} fill="url(#hv-gold)" stroke="#FFF3C4" strokeWidth="1" />
              <text x={34 + i * 31} y={51} textAnchor="middle" fontSize="16" fontWeight="700" fill="#7A2A10" style={{ fontFamily: 'var(--font-kai)' }}>{'天槓天槓'[i]}</text>
            </g>
          ))}
        </svg>
      );
    case 'forgot':
      // 唔記得開：四隻牌冚住（問號）
      return (
        <svg className="sp-art side forgot" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <g key={i} className="fg-tile" style={{ '--d': `${i * 0.07}s`, transformOrigin: `${34 + i * 31}px 64px` } as CSSProperties}>
              <rect x={20 + i * 31} y={26} width={28} height={40} rx={4} fill="#4A4F4C" />
              <rect x={20 + i * 31} y={22} width={28} height={40} rx={4} fill="#6B716D" />
              <text x={34 + i * 31} y={48} textAnchor="middle" fontSize="16" fontWeight="700" fill="#D8DCD9" style={{ fontFamily: 'var(--font-kai)' }}>？</text>
            </g>
          ))}
        </svg>
      );
    case 'false':
      return (
        <svg className="sp-art side falsewin" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <g transform="translate(80 20) rotate(8)">
            <circle cx="40" cy="20" r="17" fill="none" stroke={RED} strokeWidth="2.5" opacity="0.85" />
            <text x="40" y="28" textAnchor="middle" fontSize="22" fontWeight="700" fill={RED} opacity="0.85" style={{ fontFamily: 'var(--font-kai)' }}>詐</text>
          </g>
          <g transform="translate(50 22)">
            <rect x="0" y="4" width="34" height="48" rx="5" fill="#C9C2AE" />
            <rect x="0" y="0" width="34" height="48" rx="5" fill="#FBF8EE" stroke="#C9C2AE" strokeWidth="1.5" />
            <text x="17" y="33" textAnchor="middle" fontSize="22" fontWeight="700" fill={INK} style={{ fontFamily: 'var(--font-kai)' }}>糊</text>
            <path className="strike" pathLength={100} d="M4 6 L30 42 M30 6 L4 42" stroke={RED} strokeWidth="3.4" strokeLinecap="round" />
          </g>
        </svg>
      );
    case 'triple':
    case 'dice123': {
      const faces = art === 'triple' ? [4, 4, 4] : [1, 2, 3];
      const pips: Record<number, [number, number][]> = { 1: [[50, 50]], 2: [[30, 30], [70, 70]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[30, 30], [70, 30], [30, 70], [70, 70]] };
      return (
        <svg className="sp-art side dice" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {faces.map((f, i) => (
            <g key={i} transform={`translate(${17 + i * 43} 25) scale(0.4)`}>
              <g className="sp-die" style={{ '--d': `${i * 0.09}s` } as CSSProperties}>
                <rect x="2" y="2" width="96" height="96" rx="18" fill="#FBF8EE" stroke="#C9C2AE" strokeWidth="4" />
                {pips[f].map(([x, y], j) => <circle key={j} cx={x} cy={y} r={f === 1 ? 14 : 10} fill={f === 1 || f === 4 ? RED : INK} />)}
              </g>
            </g>
          ))}
        </svg>
      );
    }
    case 'pong':
      return (
        <svg className="sp-art side pong" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <text x="80" y="66" textAnchor="middle" fontSize="54" fontWeight="700" fill={RED} opacity="0.85" style={{ fontFamily: 'var(--font-kai)' }}>碰</text>
          <path className="strike" pathLength={100} d="M42 26 L118 72" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'chase':
      return (
        <svg className="sp-art side chase" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {[0, 1, 2].map((i) => <path key={i} className="speed" style={{ '--d': `${i * 0.1}s` } as CSSProperties} d={`M${14 + i * 4} ${36 + i * 10} h${30 - i * 6}`} stroke={BLUE} strokeWidth="2.4" strokeLinecap="round" opacity={0.7 - i * 0.15} />)}
          <g className="chase-a"><rect x="58" y="22" width="30" height="42" rx="4" fill="#FBF8EE" stroke="#C9C2AE" strokeWidth="1.5" /><text x="73" y="51" textAnchor="middle" fontSize="20" fontWeight="700" fill={RED} style={{ fontFamily: 'var(--font-kai)' }}>中</text></g>
          <g className="chase-b"><rect x="96" y="22" width="30" height="42" rx="4" fill="#FBF8EE" stroke="#C9C2AE" strokeWidth="1.5" /><text x="111" y="51" textAnchor="middle" fontSize="20" fontWeight="700" fill={RED} style={{ fontFamily: 'var(--font-kai)' }}>中</text></g>
          {Array.from({ length: heat * 3 }, (_, i) => (
            <circle key={i} className="ember" style={{ '--d': `${i * 0.13}s`, '--x': `${(i * 37) % 60 - 30}px` } as CSSProperties} cx={92} cy={80} r={2 + (i % 3)} fill={i % 2 ? '#F2C14E' : '#E5703A'} />
          ))}
        </svg>
      );
  }
}

/** 入咗特別事項，枱面飄一陣嘢 */
export function SpecialBurst({ art, text }: { art: Art; text?: string }) {
  if (art === 'heaven') {
    // 天槓：枱面變暗、金光轉、四隻金牌逐隻砸落、金幣雨
    return (
      <div className="burst burst-heaven" aria-hidden="true">
        <span className="hv-flash" />
        <span className="hv-sun" />
        <div className="hv-row">
          {'天槓天槓'.split('').map((ch, i) => <span key={i} className="hv-big" style={{ '--d': `${0.15 + i * 0.16}s` } as CSSProperties}>{ch}</span>)}
        </div>
        {Array.from({ length: 22 }, (_, i) => (
          <span key={i} className="burst-bit hv-coin" style={{ '--x': `${(i * 41) % 100}%`, '--d': `${0.8 + (i % 7) * 0.09}s`, '--r': `${(i * 67) % 360}deg`, '--s': `${0.8 + (i % 3) * 0.2}` } as CSSProperties} />
        ))}
        <span className="burst-stamp hv-stamp">{text ?? '天槓'}</span>
      </div>
    );
  }
  if (art === 'forgot') {
    return (
      <div className="burst burst-forgot" aria-hidden="true">
        <span className="fg-dim" />
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="burst-bit fg-bit" style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i % 5) * 0.08}s`, '--r': `${(i * 71) % 360}deg`, '--s': `${0.9 + (i % 3) * 0.15}` } as CSSProperties} />
        ))}
        <span className="burst-stamp fg-stamp">{text ?? '唔記得開！'}</span>
      </div>
    );
  }
  const n = art === 'flower' || art === 'grass' ? 16 : art === 'chase' ? 0 : 6;
  return (
    <div className={`burst burst-${art}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="burst-bit"
          style={{ '--x': `${(i * 53) % 100}%`, '--d': `${(i % 8) * 0.08}s`, '--r': `${(i * 47) % 360}deg`, '--s': `${0.7 + (i % 4) * 0.15}` } as CSSProperties}
        />
      ))}
      {text && <span className="burst-stamp">{text}</span>}
    </div>
  );
}
