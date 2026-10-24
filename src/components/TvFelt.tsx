// 電視（AirPlay）用嘅枱面：綠絨布，四隻牌塞滿四個角（左上東位、左下南位、右下西位、右上北位；莊跟位行），
// 淨係睇唔撳；分數一變就飄「+N」。ScaleFit 將佢放大縮細塞滿個格（幾多張枱都一版睇晒）。
// TileBody／WindCube 枱頁都用。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Computed } from '../lib/score.ts';
import { Chips, RollingNumber, fmt, tone } from '../ui.tsx';
import TileFace from './TileFace.tsx';
import type { TileCode } from './TileFace.tsx';

const WIND = ['東', '南', '西', '北'];
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

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

/** 名嘅闊度（中文字當兩格）：長名細字，唔好逼爆個格 */
export function nameCls(nm: string): string {
  let w = 0;
  for (const ch of nm) w += /[\u2e80-\uffff]/.test(ch) ? 2 : 1;
  return w > 14 ? ' xlong' : w > 9 ? ' long' : '';
}

/** 起莊嗰個位（東圈東位）：圈風牌擺喺佢前面，打完四圈換位先郁 */
export const startSeatOf = (st: { dealerSeat: number; dealerTurns: number }) => (((st.dealerSeat - st.dealerTurns) % 4) + 4) % 4;

/** 圈風牌：正方形、少少立體 */
export function WindCube({ wind, className = '' }: { wind: string; className?: string }) {
  return <span className={`wind-cube ${className}`} aria-label={`${wind}圈`}><b>{wind}</b></span>;
}

/** 牌入面嘅內容（枱頁、電視共用）：名 → 籌碼 → 分數 → 拉／被拉 tag；門風喺右上角 */
export function TileBody({ name, settled, owe, collect, pulledLabel, pulling, wind, pop, score, chipsBelow, day }: {
  name: string; settled: number; owe?: number; collect?: number; pulledLabel: string; pulling: number; wind: string; pop?: boolean;
  /** 電視：籌碼擺喺大數字下面 */
  chipsBelow?: boolean;
  /** 電視：當日大數（成個大局所有枱加埋） */
  day?: number;
  /** 想用其他方式顯示分數（例如 RollingNumber 以外） */
  score?: ReactNode;
}) {
  const chips = owe ? <span className="t-chips"><Chips key={`c${owe}`} amount={owe} pop={pop} /><RollingNumber value={-owe} className="t-loss" /></span> : null;
  return (
    <>
      <span className="t-wind">{wind}</span>
      <span className={`t-name${nameCls(name)}`}><span className="t-name-text">{name}</span></span>
      {!chipsBelow && chips}
      {score ?? <RollingNumber value={settled} className={`t-score t-${tone(settled)}`} />}
      {chipsBelow && chips}
      {owe || collect ? (
        <span className="t-tags">
          {owe ? <span className="t-la loss" title="被拉緊第幾拉">{pulledLabel}</span> : null}
          {collect ? <span className="t-la gain" title="拉緊幾多家"><b className="num">+{collect}</b>拉{pulling}家</span> : null}
        </span>
      ) : null}
      {day !== undefined && <span className="t-day">今日<b className={`num t-${tone(day)}`}>{fmt(day)}</b></span>}
    </>
  );
}

/** 拉／被拉數據 */
export function chainInfo(c: Computed) {
  const owe: Record<string, number> = {};
  const collect: Record<string, number> = {};
  for (const ch of c.state.chains) {
    owe[ch.pulled] = (owe[ch.pulled] ?? 0) + ch.owed;
    collect[ch.puller] = (collect[ch.puller] ?? 0) + ch.owed;
  }
  const pulling = (id: string) => c.state.chains.filter((ch) => ch.puller === id).length;
  const pulledLabel = (id: string) => `被拉${c.state.chains.filter((ch) => ch.pulled === id).map((ch) => CN[ch.count] ?? ch.count).join('・')}`;
  return { owe, collect, pulling, pulledLabel };
}

// 電視：跟「位」擺（起莊嗰個位 = 東位），東位永遠喺左上、南位左下、西位右下、北位右上（同真枱一樣逆時針）；
// 人唔郁，莊跟位行：東圈北位 = 北位（右上）做莊。四隻牌塞滿綠絨，枱名、圈、位、鋪數放上面
const QUADS = ['q-tl', 'q-bl', 'q-br', 'q-tr'];

export function TvFelt({ c, names, title, me, day }: { c: Computed; names: Record<string, string>; title?: string; me?: string | null; day?: Record<string, number> }) {
  const name = (id: string) => names[id] ?? '玩家';
  const seats = c.state.seats;
  const ended = c.state.ended;
  const { owe, collect, pulling, pulledLabel } = chainInfo(c);
  const fx = useDeltas(Object.fromEntries(seats.map((id) => [id, (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0)])));
  const s0 = startSeatOf(c.state);
  return (
    <div className="tv-felt-wrap">
      <div className="tv-felt-info">
        {title && <b className="tv-felt-name">{title}</b>}
        <span className="tv-felt-meta">{ended ? '已完場' : `${c.info.roundWind}圈${WIND[c.state.dealerTurns % 4]}位・第 ${c.info.hand} 鋪`}</span>
        <span className="tv-felt-water">水 {c.state.water}</span>
      </div>
      <section className="felt tv-felt quad" aria-label={title ?? '枱面'}>
        {seats.map((id, i) => {
          const settled = c.state.settled[id] ?? 0;
          const isDealer = c.info.dealer === id && !ended;
          const pos = (i - s0 + 4) % 4;
          const w = WIND[pos];
          return (
            <div key={id} className={`tile ${QUADS[pos]}${isDealer ? ' is-dealer' : ''}${id === me ? ' is-me' : ''}`}>
              {isDealer && <span className="dealer-mark tv-dealer-mark">莊{c.state.streak ? c.state.streak : ''}</span>}
              <TileBody name={name(id)} settled={settled} owe={owe[id]} collect={collect[id]} pulledLabel={pulledLabel(id)} pulling={pulling(id)} wind={w} chipsBelow day={day ? (day[id] ?? 0) : undefined} />
              {fx.d[id] ? <span key={`f${fx.key}`} className={`float ${fx.d[id] > 0 ? 'gain' : 'loss'}`}>{fmt(fx.d[id])}</span> : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/**
 * 將內容放大縮細塞滿個格。
 * 一般：固定闊度 base，唔變形。
 * minW + minH（電視）：內容最少要咁大；揀最大嘅比例，之後內容伸到啱啱塞滿成個格（綠絨、牌跟住伸，字跟住大）
 */
export function ScaleFit({ base = 380, minW, minH, children }: { base?: number; minW?: number; minH?: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [d, setD] = useState<{ k: number; w: number; h?: number }>({ k: 1, w: minW ?? base });
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const fit = () => {
      if (minW && minH) {
        const cw = b.clientWidth || minW;
        const ch = b.clientHeight || minH;
        const k = Math.max(0.2, Math.min(cw / minW, ch / minH));
        setD({ k, w: cw / k, h: ch / k });
        return;
      }
      const h = i.offsetHeight || 1;
      setD({ k: Math.max(0.3, Math.min(b.clientWidth / base, b.clientHeight / h)), w: base });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    if (!(minW && minH)) ro.observe(i);
    return () => ro.disconnect();
  }, [base, minW, minH]);
  return (
    <div className={`scale-fit${minW && minH ? ' fill' : ''}`} ref={box}>
      <div className="scale-fit-inner" ref={inner} style={{ width: d.w, height: d.h, transform: `translate(-50%, -50%) scale(${d.k})` }}>{children}</div>
    </div>
  );
}

// ---------- 背景：慢慢飄落嘅麻雀牌（開關記喺呢部機） ----------
const ANIM_KEY = 'jeukbou-tv-anim';
export const tvAnimOn = () => { try { return localStorage.getItem(ANIM_KEY) !== '0'; } catch { return true; } };
export const setTvAnim = (on: boolean) => { try { localStorage.setItem(ANIM_KEY, on ? '1' : '0'); } catch { /* 唔緊要 */ } };
// 背景跌落嚟嘅牌：萬、筒、索各幾隻，加字牌同花，全部係真牌面
const FALL: TileCode[] = ['1m', '5p', 'E', '9s', 'C', '3m', 'f1', '7p', 'F', '2s', 'N', '8m', 'P', '4p', 'f6', '6s', 'S', '9m', '1p', 'W', '5s', 'f3'];
export function FallingTiles() {
  return (
    <div className="stage-fall tiles" aria-hidden="true">
      {FALL.map((t, i) => (
        <span key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${18 + ((i * 7) % 11)}s`, '--delay': `${-((i * 3.1) % 18)}s`, '--r': `${((i * 53) % 70) - 35}deg`, '--s': `${0.75 + ((i * 13) % 7) / 10}` } as CSSProperties}><TileFace code={t} size={40} /></span>
      ))}
    </div>
  );
}
