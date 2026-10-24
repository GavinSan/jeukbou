// 高番慶祝：30 起彩炮，70 起加煙花，100 起成個畫面震，200 起金雨。全枱電話一齊播。
import { useEffect, useRef } from 'react';
import { sfx } from '../lib/sound.ts';

interface P {
  x: number; y: number; vx: number; vy: number; life: number; max: number;
  color: string; size: number; rot: number; vr: number; kind: 'paper' | 'spark' | 'rocket';
  burst?: number; trail?: boolean;
}

const PAPER = ['#B02E26', '#F2C14E', '#2E7D5B', '#24508F', '#E5703A', '#D9607A', '#F4EFDF'];
const SPARK = ['#FFD66B', '#FF8A5B', '#FF5E7E', '#7FD1FF', '#B6F09C', '#FFFFFF', '#F2C14E'];

function tier(fan: number) {
  if (fan >= 200) return { label: '神糊', paper: 260, rockets: 9, shake: true, gold: true, ms: 5200 };
  if (fan >= 100) return { label: '百番', paper: 220, rockets: 5, shake: true, gold: false, ms: 4200 };
  if (fan >= 70) return { label: '爆棚', paper: 160, rockets: 2, shake: false, gold: false, ms: 3400 };
  if (fan >= 50) return { label: '大糊', paper: 120, rockets: 0, shake: false, gold: false, ms: 2600 };
  return { label: '好糊', paper: 70, rockets: 0, shake: false, gold: false, ms: 2200 };
}

export default function Celebrate({ fan, onDone, silent, who, long }: { fan: number; onDone: () => void; silent?: boolean; who?: string; long?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = tier(fan);
  // Live（電視）：留耐啲，等全場睇清楚
  const t = long ? { ...base, ms: base.ms + 2600 } : base;

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (silent) { /* 聲效由外面播 */ } else if (t.rockets) sfx.firework(t.rockets >= 5 ? 4 : 2);
    else sfx.popper();
    if (t.shake) document.body.classList.add('shake');
    const done = setTimeout(() => { document.body.classList.remove('shake'); onDone(); }, reduce ? 1800 : t.ms);
    if (reduce) return () => clearTimeout(done);

    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return () => clearTimeout(done);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.scale(dpr, dpr);

    const ps: P[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    // 彩炮：由兩邊下角射上嚟
    const popper = (fromLeft: boolean, n: number) => {
      for (let i = 0; i < n; i++) {
        const ang = fromLeft ? rnd(-1.35, -0.75) : rnd(-2.4, -1.8);
        const sp = rnd(9, 17);
        ps.push({
          x: fromLeft ? 0 : W, y: H * 0.85, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: rnd(110, 170),
          color: PAPER[i % PAPER.length], size: rnd(5, 10), rot: rnd(0, 6), vr: rnd(-0.3, 0.3), kind: 'paper',
        });
      }
    };
    popper(true, t.paper / 2);
    popper(false, t.paper / 2);
    if (fan >= 50) setTimeout(() => { popper(true, t.paper / 3); popper(false, t.paper / 3); }, 450);
    // Live：第二、三轟彩炮，留耐啲
    if (long) { setTimeout(() => { popper(true, t.paper / 2); popper(false, t.paper / 2); }, 1400); setTimeout(() => { popper(true, t.paper / 3); popper(false, t.paper / 3); }, 2800); }

    // 煙花火箭
    for (let r = 0; r < t.rockets; r++) {
      setTimeout(() => {
        ps.push({ x: rnd(W * 0.15, W * 0.85), y: H, vx: rnd(-1, 1), vy: rnd(-15, -11), life: 0, max: rnd(38, 52), color: '#FFE9A8', size: 3, rot: 0, vr: 0, kind: 'rocket', burst: t.gold ? 110 : 80 });
      }, 250 + r * (t.rockets > 5 ? 380 : 520));
    }
    // 神糊：金雨
    if (t.gold) {
      const rain = setInterval(() => {
        for (let i = 0; i < 6; i++) ps.push({ x: rnd(0, W), y: -10, vx: rnd(-0.5, 0.5), vy: rnd(2, 4), life: 0, max: 200, color: '#F2C14E', size: rnd(2, 4), rot: 0, vr: 0, kind: 'spark' });
      }, 60);
      setTimeout(() => clearInterval(rain), t.ms - 1200);
    }

    let raf = 0;
    const step = () => {
      ctx.clearRect(0, 0, W, H);
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life += 1;
        if (p.kind === 'paper') {
          p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          const a = Math.max(0, 1 - p.life / p.max);
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (1 + Math.sin(p.life / 5)));
          ctx.restore();
        } else if (p.kind === 'rocket') {
          p.vy += 0.18; p.x += p.vx; p.y += p.vy;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill();
          ps.push({ x: p.x, y: p.y, vx: rnd(-0.3, 0.3), vy: rnd(0.5, 1.5), life: 0, max: 18, color: '#FFD66B', size: 1.6, rot: 0, vr: 0, kind: 'spark' });
          if (p.life >= p.max || p.vy > -1) {
            const n = p.burst ?? 70;
            const hue = SPARK[Math.floor(Math.random() * SPARK.length)];
            const hue2 = SPARK[Math.floor(Math.random() * SPARK.length)];
            for (let k = 0; k < n; k++) {
              const ang = (k / n) * Math.PI * 2 + rnd(-0.05, 0.05);
              const sp = rnd(2.5, 6.5);
              ps.push({ x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: rnd(50, 80), color: k % 3 ? hue : hue2, size: rnd(1.6, 2.8), rot: 0, vr: 0, kind: 'spark', trail: true });
            }
            ps.splice(i, 1);
            continue;
          }
        } else {
          p.vy += p.trail ? 0.06 : 0.02; p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx; p.y += p.vy;
          const a = Math.max(0, 1 - p.life / p.max);
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + a * 0.6), 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (p.life > p.max || p.y > H + 40) ps.splice(i, 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); document.body.classList.remove('shake'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`party tier-${t.label}${long ? ' long' : ''}`} aria-live="polite">
      <canvas ref={ref} className="party-canvas" aria-hidden="true" />
      <div className="party-text">
        {who && <i className="party-who">{who}</i>}
        <b className="num">{fan}</b><span>番</span>
        <em>{t.label}！</em>
      </div>
    </div>
  );
}
