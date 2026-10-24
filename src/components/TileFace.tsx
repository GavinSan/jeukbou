// 麻雀牌面（SVG）：萬子、筒子、索子、字牌（東南西北中發白）、花（梅蘭菊竹、春夏秋冬）。
// 牌友圈 icon、Live 背景跌落嚟嘅牌都用；角落有細細嘅數字（1234），一眼睇到係幾多。
// 代碼：'5m' 五萬、'3p' 三筒、'7s' 七索、'E' 'S' 'W' 'N' 東南西北、'C' 中、'F' 發、'P' 白、'f1'–'f8' 梅蘭菊竹春夏秋冬
import type { CSSProperties } from 'react';

export type TileCode = string;

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WINDS: Record<string, string> = { E: '東', S: '南', W: '西', N: '北' };
const FLOWERS = ['梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬'];
const INK = '#1F2A44';
const RED = '#B02E26';
const GREEN = '#1E7A4E';
const BLUE = '#24508F';

/** 所有牌（背景、icon 揀選用） */
export const ALL_TILES: TileCode[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}m`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}p`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}s`),
  'E', 'S', 'W', 'N', 'C', 'F', 'P',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8',
];

/** 舊 icon（emoji）→ 牌代碼 */
export const tileOfIcon = (icon?: string): TileCode | null => {
  if (!icon) return null;
  if (icon === '🀄') return 'C';
  if (icon === '🀅') return 'F';
  if (icon.startsWith('t:')) return icon.slice(2);
  return null;
};

/** 牌名（無障礙用） */
export function tileName(code: TileCode): string {
  const m = /^(\d)([mps])$/.exec(code);
  if (m) return `${CN[Number(m[1])]}${m[2] === 'm' ? '萬' : m[2] === 'p' ? '筒' : '索'}`;
  if (WINDS[code]) return WINDS[code];
  if (code === 'C') return '紅中';
  if (code === 'F') return '發財';
  if (code === 'P') return '白板';
  const f = /^f(\d)$/.exec(code);
  if (f) return FLOWERS[Number(f[1]) - 1] ?? '花';
  return '麻雀牌';
}

// 筒子：每粒嘅位置（牌面 60×80 入面）
const DOTS: Record<number, [number, number][]> = {
  1: [[30, 40]],
  2: [[30, 22], [30, 58]],
  3: [[15, 17], [30, 40], [45, 63]],
  4: [[18, 23], [42, 23], [18, 57], [42, 57]],
  5: [[17, 19], [43, 19], [30, 40], [17, 61], [43, 61]],
  6: [[19, 16], [41, 16], [19, 40], [41, 40], [19, 64], [41, 64]],
  7: [[14, 13], [30, 21], [46, 29], [19, 50], [41, 50], [19, 67], [41, 67]],
  8: [[19, 13], [41, 13], [19, 31], [41, 31], [19, 49], [41, 49], [19, 67], [41, 67]],
  9: [[14, 17], [30, 17], [46, 17], [14, 40], [30, 40], [46, 40], [14, 63], [30, 63], [46, 63]],
};
const DOT_R: Record<number, number> = { 1: 17, 2: 10, 3: 8.5, 4: 9, 5: 8, 6: 8, 7: 6.6, 8: 6.6, 9: 6.6 };
const dotColor = (n: number, i: number) => {
  if (n === 1) return RED;
  if (n === 2) return [GREEN, BLUE][i];
  if (n === 3) return [BLUE, RED, GREEN][i];
  if (n === 4) return [BLUE, GREEN, GREEN, BLUE][i];
  if (n === 5) return [BLUE, GREEN, RED, GREEN, BLUE][i];
  if (n === 6) return i < 2 ? GREEN : RED;
  if (n === 7) return i < 3 ? GREEN : RED;
  if (n === 8) return BLUE;
  return [BLUE, BLUE, BLUE, RED, RED, RED, GREEN, GREEN, GREEN][i];
};

// 索子：每支竹嘅中心（直身）
const STICKS: Record<number, [number, number][]> = {
  2: [[30, 23], [30, 57]],
  3: [[30, 23], [20, 57], [40, 57]],
  4: [[20, 23], [40, 23], [20, 57], [40, 57]],
  5: [[17, 23], [43, 23], [30, 40], [17, 57], [43, 57]],
  6: [[15, 23], [30, 23], [45, 23], [15, 57], [30, 57], [45, 57]],
  7: [[30, 14], [15, 40], [30, 40], [45, 40], [15, 66], [30, 66], [45, 66]],
  8: [[12, 23], [24, 23], [36, 23], [48, 23], [12, 57], [24, 57], [36, 57], [48, 57]],
  9: [[15, 14], [30, 14], [45, 14], [15, 40], [30, 40], [45, 40], [15, 66], [30, 66], [45, 66]],
};
const stickColor = (n: number, i: number) => {
  if (n === 5 && i === 2) return RED;
  if (n === 7 && i === 0) return RED;
  if (n === 9 && (i === 1 || i === 4 || i === 7)) return RED;
  return GREEN;
};

function Stick({ x, y, h, color }: { x: number; y: number; h: number; color: string }) {
  const w = 5.2;
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={2.4} fill={color} />
      <rect x={x - w / 2 - 0.6} y={y - 0.9} width={w + 1.2} height={1.8} rx={0.9} fill="#F4EFDF" opacity={0.85} />
      <rect x={x - 0.7} y={y - h / 2 + 1.5} width={1.4} height={h - 3} rx={0.7} fill="#fff" opacity={0.35} />
    </g>
  );
}

function Face({ code }: { code: TileCode }) {
  const m = /^(\d)([mps])$/.exec(code);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === 'm') {
      return (
        <>
          <text x={30} y={33} textAnchor="middle" fontSize={26} fontWeight={800} fill={INK} fontFamily="var(--font-kai), serif">{CN[n]}</text>
          <text x={30} y={68} textAnchor="middle" fontSize={27} fontWeight={800} fill={RED} fontFamily="var(--font-kai), serif">萬</text>
        </>
      );
    }
    if (m[2] === 'p') {
      return (
        <>
          {DOTS[n].map(([x, y], i) => {
            const r = DOT_R[n];
            const c = dotColor(n, i);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={r} fill="none" stroke={c} strokeWidth={r * 0.32} />
                <circle cx={x} cy={y} r={r * 0.42} fill={c} />
                {n === 1 && <circle cx={x} cy={y} r={r * 0.72} fill="none" stroke={GREEN} strokeWidth={2} strokeDasharray="3 2.4" />}
              </g>
            );
          })}
        </>
      );
    }
    if (n === 1) {
      // 一索：雀仔
      return (
        <g>
          <ellipse cx={30} cy={44} rx={12} ry={15} fill={GREEN} />
          <circle cx={30} cy={25} r={8} fill={GREEN} />
          <circle cx={32.5} cy={23.5} r={1.8} fill="#fff" />
          <path d="M37 25 l7 2 -7 2z" fill="#E5A23A" />
          <path d="M22 50 q-9 10 -6 22 q6 -8 12 -10z" fill={RED} />
          <path d="M38 50 q9 10 6 22 q-6 -8 -12 -10z" fill={BLUE} />
          <path d="M24 40 q6 6 12 0" stroke="#F4EFDF" strokeWidth={2} fill="none" />
        </g>
      );
    }
    const h = n >= 7 ? 22 : 28;
    return <>{STICKS[n].map(([x, y], i) => <Stick key={i} x={x} y={y} h={h} color={stickColor(n, i)} />)}</>;
  }
  if (WINDS[code]) return <text x={30} y={53} textAnchor="middle" fontSize={38} fontWeight={800} fill={INK} fontFamily="var(--font-kai), serif">{WINDS[code]}</text>;
  if (code === 'C') return <text x={30} y={54} textAnchor="middle" fontSize={42} fontWeight={800} fill={RED} fontFamily="var(--font-kai), serif">中</text>;
  if (code === 'F') return <text x={30} y={54} textAnchor="middle" fontSize={40} fontWeight={800} fill={GREEN} fontFamily="var(--font-kai), serif">發</text>;
  if (code === 'P') return <rect x={12} y={14} width={36} height={52} rx={4} fill="none" stroke={BLUE} strokeWidth={4} />;
  const f = /^f(\d)$/.exec(code);
  if (f) {
    const k = Number(f[1]);
    const c = k <= 4 ? [RED, BLUE, '#C08A1E', GREEN][k - 1] : [GREEN, RED, '#C08A1E', BLUE][k - 5];
    return (
      <>
        <circle cx={30} cy={34} r={15} fill={c} opacity={0.14} />
        <text x={30} y={46} textAnchor="middle" fontSize={30} fontWeight={800} fill={c} fontFamily="var(--font-kai), serif">{FLOWERS[k - 1]}</text>
        <text x={30} y={70} textAnchor="middle" fontSize={11} fontWeight={700} fill={c} fontFamily="var(--font-kai), serif">{CN[((k - 1) % 4) + 1]}</text>
      </>
    );
  }
  return null;
}

/** 角落細數字：數牌同花先有 */
function cornerOf(code: TileCode): string | null {
  const m = /^(\d)[mps]$/.exec(code);
  if (m) return m[1];
  const f = /^f(\d)$/.exec(code);
  if (f) return String(((Number(f[1]) - 1) % 4) + 1);
  return null;
}

/** 一隻牌：象牙面、綠底（似真牌） */
export default function TileFace({ code, size = 44, className = '', style }: { code: TileCode; size?: number; className?: string; style?: CSSProperties }) {
  const corner = cornerOf(code);
  const h = Math.round(size * 1.4667);
  return (
    <svg className={`tile-face ${className}`} width={size} height={h} viewBox="0 0 60 88" role="img" aria-label={tileName(code)} style={style}>
      <rect x={1} y={6} width={58} height={81} rx={8} fill="#1E5B49" />
      <rect x={1} y={1} width={58} height={80} rx={8} fill="#F7F2E3" stroke="rgba(0,0,0,.12)" strokeWidth={1} />
      <rect x={4} y={4} width={52} height={74} rx={6} fill="none" stroke="rgba(0,0,0,.05)" strokeWidth={1} />
      <g transform="translate(0,1)"><Face code={code} /></g>
      {corner && <text x={52} y={13} textAnchor="middle" fontSize={9} fontWeight={800} fill="rgba(31,42,68,.55)" fontFamily="var(--font-num), sans-serif">{corner}</text>}
    </svg>
  );
}
