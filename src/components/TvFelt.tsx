// 電視（AirPlay）用嘅枱面：同枱頁一模一樣嘅綠絨布同四隻牌（東下、南右、西上、北左），
// 淨係睇唔撳；分數一變就飄「+N」。ScaleFit 將佢放大縮細塞滿個格（幾多張枱都一版睇晒）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Computed } from '../lib/score.ts';
import { seatWind } from '../engine/table.ts';
import { Chips, RollingNumber, fmt } from '../ui.tsx';

const SPOTS = ['s-bottom', 's-right', 's-top', 's-left'];
const WIND = ['東', '南', '西', '北'];
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const tone = (n: number) => (n > 0 ? 'gain' : n < 0 ? 'loss' : 'even');

/** 分數變咗就記低差額，幾秒後消失 */
function useDeltas(values: Record<string, number>) {
  const prev = useRef<Record<string, number> | null>(null);
  const [fx, setFx] = useState<{ key: number; d: Record<string, number> }>({ key: 0, d: {} });
  const sig = Object.entries(values).map(([k, v]) => `${k}:${v}`).join('|');
  useEffect(() => {
    const before = prev.current;
    prev.current = values;
    if (!before) return;
    const d = Object.fromEntries(Object.entries(values).filter(([k, v]) => before[k] !== undefined && before[k] !== v).map(([k, v]) => [k, v - before[k]]));
    if (!Object.keys(d).length) return;
    const key = Date.now();
    setFx({ key, d });
    const t = setTimeout(() => setFx((f) => (f.key === key ? { key, d: {} } : f)), 3200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return fx;
}

export function TvFelt({ c, names, title, me }: { c: Computed; names: Record<string, string>; title?: string; me?: string | null }) {
  const name = (id: string) => names[id] ?? '玩家';
  const seats = c.state.seats;
  const ended = c.state.ended;
  const owe: Record<string, number> = {};
  const collect: Record<string, number> = {};
  for (const ch of c.state.chains) {
    owe[ch.pulled] = (owe[ch.pulled] ?? 0) + ch.owed;
    collect[ch.puller] = (collect[ch.puller] ?? 0) + ch.owed;
  }
  const pulling = (id: string) => c.state.chains.filter((ch) => ch.puller === id).length;
  const pulledLabel = (id: string) => `被拉${c.state.chains.filter((ch) => ch.pulled === id).map((ch) => CN[ch.count] ?? ch.count).join('・')}`;
  const fx = useDeltas(Object.fromEntries(seats.map((id) => [id, (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0)])));
  return (
    <div className="tv-felt-wrap">
      <div className="tv-felt-title">{title ?? '\u00a0'}</div>
      <section className="felt tv-felt" aria-label={title ?? '枱面'}>
        {seats.map((id, i) => {
          const settled = c.state.settled[id] ?? 0;
          const isDealer = c.info.dealer === id && !ended;
          const nm = name(id);
          return (
            <div key={id} className={`tile ${SPOTS[i]}${isDealer ? ' is-dealer' : ''}${id === me ? ' is-me' : ''}`}>
              {isDealer && <span className="dealer-mark tv-dealer-mark">莊{c.state.streak ? c.state.streak : ''}</span>}
              <span className={`t-name${nm.length > 6 ? ' long' : ''}`}><span className="t-name-text">{nm}</span></span>
              <RollingNumber value={settled} className={`t-score t-${tone(settled)}`} />
              <span className="t-foot">
                {owe[id] ? <><Chips amount={owe[id]} /><RollingNumber value={-owe[id]} className="t-loss" /><span className="t-la loss">{pulledLabel(id)}</span></> : null}
                {collect[id] ? <><RollingNumber value={collect[id]} className="t-gain" /><span className="t-la gain">拉{pulling(id)}家</span></> : null}
                <span className="t-wind">{seatWind(c.state, id)}</span>
              </span>
              {fx.d[id] ? <span key={`f${fx.key}`} className={`float ${fx.d[id] > 0 ? 'gain' : 'loss'}`}>{fmt(fx.d[id])}</span> : null}
            </div>
          );
        })}
        <div className="felt-center">
          <span className="wind-tile">{ended ? '完' : c.info.roundWind}</span>
          <span className="small">{ended ? '已完場' : `${WIND[c.state.dealerTurns % 4]}位 · 第 ${c.info.hand} 鋪`}</span>
          <span className="felt-water">水 {c.state.water}</span>
        </div>
      </section>
    </div>
  );
}

/** 將內容（固定闊度 base）放大縮細塞滿個格，唔變形 */
export function ScaleFit({ base = 380, children }: { base?: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const fit = () => {
      const h = i.offsetHeight || 1;
      setK(Math.max(0.3, Math.min(b.clientWidth / base, b.clientHeight / h)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    ro.observe(i);
    return () => ro.disconnect();
  }, [base]);
  return (
    <div className="scale-fit" ref={box}>
      <div className="scale-fit-inner" ref={inner} style={{ width: base, transform: `translate(-50%, -50%) scale(${k})` }}>{children}</div>
    </div>
  );
}

// ---------- 背景：慢慢飄落嘅麻雀牌 ----------
const ANIM_KEY = 'jeukbou-tv-anim';
export const tvAnimOn = () => { try { return localStorage.getItem(ANIM_KEY) !== '0'; } catch { return true; } };
export const setTvAnim = (on: boolean) => { try { localStorage.setItem(ANIM_KEY, on ? '1' : '0'); } catch { /* 唔緊要 */ } };
const FALL = ['中', '發', '東', '南', '西', '北', '一', '九', '萬', '筒', '索', '白', '春', '梅', '五', '八', '蘭', '三'];

export function FallingTiles() {
  return (
    <div className="stage-fall" aria-hidden="true">
      {FALL.map((t, i) => (
        <span key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${16 + ((i * 7) % 10)}s`, '--delay': `${-((i * 3.3) % 16)}s`, '--r': `${((i * 53) % 60) - 30}deg`, '--s': `${0.8 + ((i * 13) % 6) / 10}` } as CSSProperties}>{t}</span>
      ))}
    </div>
  );
}
