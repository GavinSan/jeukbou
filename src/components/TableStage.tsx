// 電視模式（一張枱）：打橫、大字、四家頭像同分數，分數一變就閃出「+N」；
// 背景有慢慢飄落嘅麻雀牌（可以閂）。用 AirPlay／螢幕鏡像射上電視用。
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Avatar, fmt, useNow } from '../ui.tsx';
import GroupIcon from './GroupIcon.tsx';
import { Link } from '../lib/router.tsx';

export interface StagePlayer {
  id: string;
  name: string;
  v: number;
  wind: string;
  photo?: string | null;
  dealer?: boolean;
  streak?: number;
}

const ANIM_KEY = 'jeukbou-tv-anim';
export const tvAnimOn = () => { try { return localStorage.getItem(ANIM_KEY) !== '0'; } catch { return true; } };
export const setTvAnim = (on: boolean) => { try { localStorage.setItem(ANIM_KEY, on ? '1' : '0'); } catch { /* 唔緊要 */ } };

// 背景飄落嘅牌：位置、速度固定（唔使隨機，每次一樣）
const FALL = ['中', '發', '東', '南', '西', '北', '一', '九', '萬', '筒', '索', '白', '春', '梅', '五', '八'];

function Falling() {
  return (
    <div className="stage-fall" aria-hidden="true">
      {FALL.map((t, i) => (
        <span key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${14 + ((i * 7) % 9)}s`, '--delay': `${-((i * 3.3) % 14)}s`, '--r': `${((i * 53) % 60) - 30}deg`, '--s': `${0.8 + ((i * 13) % 6) / 10}` } as CSSProperties}>{t}</span>
      ))}
    </div>
  );
}

/** 分數一變就喺卡上面閃「+N」幾秒 */
function useDeltas(players: StagePlayer[]) {
  const prev = useRef<Record<string, number> | null>(null);
  const [deltas, setDeltas] = useState<Record<string, { d: number; k: number }>>({});
  const sig = players.map((p) => `${p.id}:${p.v}`).join('|');
  useEffect(() => {
    const now: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, p.v]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const changed = Object.entries(now).filter(([id, v]) => before[id] !== undefined && before[id] !== v);
    if (!changed.length) return;
    const k = Date.now();
    setDeltas((d) => ({ ...d, ...Object.fromEntries(changed.map(([id, v]) => [id, { d: v - before[id], k }])) }));
    const t = setTimeout(() => setDeltas((d) => Object.fromEntries(Object.entries(d).filter(([, x]) => x.k !== k))), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return deltas;
}

export default function TableStage({ groupName, icon, title, round, last, players, backHref, anim, preview = false }: {
  groupName: string; icon?: string; title: string; round: string; last?: string; players: StagePlayer[];
  backHref?: string; anim: boolean;
  /** 細細個預覽（AirPlay 說明頁用）：唔顯示返回掣、唔郁 */
  preview?: boolean;
}) {
  const now = useNow(15000);
  const deltas = useDeltas(players);
  const [chrome, setChrome] = useState(true);
  // 三秒冇郁就收埋返回掣，電視上面乾淨啲
  useEffect(() => {
    if (preview) return;
    let t = setTimeout(() => setChrome(false), 3000);
    const wake = () => { setChrome(true); clearTimeout(t); t = setTimeout(() => setChrome(false), 3000); };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('pointermove', wake);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', wake); window.removeEventListener('pointermove', wake); };
  }, [preview]);
  const clock = new Date(now).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
  const order = ['東', '南', '西', '北'];
  const seats = [...players].sort((a, b) => order.indexOf(a.wind) - order.indexOf(b.wind));
  const top = Math.max(...players.map((p) => p.v));
  return (
    <div className={`stage${preview ? ' preview' : ''}`}>
      {anim && !preview && <Falling />}
      <header className="stage-head">
        <span className="stage-title">
          <GroupIcon icon={icon} name={groupName} size={preview ? 18 : 34} />
          <b className="ellipsis">{title}</b>
          <span className="stage-live"><i className="live-dot" aria-hidden="true" />進行中</span>
        </span>
        <span className="stage-round">{round}</span>
        <span className="stage-clock num">{clock}</span>
      </header>
      <main className="stage-grid">
        {seats.map((p) => {
          const d = deltas[p.id];
          return (
            <section key={p.id} className={`stage-card${p.dealer ? ' dealer' : ''}${p.v === top && p.v > 0 ? ' lead' : ''}`}>
              <span className="stage-wind">{p.wind}</span>
              {p.dealer && <span className="stage-dealer">莊{p.streak ? ` 冧${p.streak}` : ''}</span>}
              <span className="stage-name ellipsis">{p.name}</span>
              <span className="stage-av"><Avatar name={p.name} photo={p.photo} size="lg" /></span>
              <b className={`num stage-score ${p.v > 0 ? 'gain' : p.v < 0 ? 'loss' : ''}`}>{fmt(p.v)}</b>
              {d && <span key={d.k} className={`stage-delta ${d.d > 0 ? 'gain' : 'loss'}`}>{d.d > 0 ? '+' : ''}{d.d}</span>}
            </section>
          );
        })}
      </main>
      <footer className="stage-foot">
        <span className="stage-brand">🀄 雀簿</span>
        {last && <span className="stage-last ellipsis">{last}</span>}
      </footer>
      {!preview && backHref && (
        <Link to={backHref} className={`stage-back${chrome ? '' : ' hide'}`} ariaLabel="返回">‹ 返回</Link>
      )}
      {!preview && <div className="stage-rotate" role="note">打橫部機，再開螢幕鏡像（AirPlay）射上電視</div>}
    </div>
  );
}
