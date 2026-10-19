// 掉位：抽風牌（四隻風牌冚住，逐隻反開，邊個攞到東就坐東），或者自己揀邊個坐邊
import { useEffect, useState } from 'react';
import { sfx } from '../lib/sound.ts';
import { Hint } from '../ui.tsx';

const WINDS = ['東', '南', '西', '北'];

export function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  const bytes = new Uint32Array(a.length);
  crypto.getRandomValues(bytes);
  for (let i = a.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** players = 掉位前嘅次序；result[i] = 坐第 i 個風位嘅人 */
export default function SeatDraw({ players, name, onConfirm, onCancel, busy }: {
  players: string[];
  name: (id: string) => string;
  onConfirm: (seats: string[]) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<'draw' | 'pick'>('draw');
  const [result, setResult] = useState<string[] | null>(null);
  const [shown, setShown] = useState(0);
  const [order, setOrder] = useState<string[]>(players);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    if (!result) return;
    if (shown >= players.length) return;
    const t = window.setTimeout(() => { setShown((n) => n + 1); sfx.tap(); }, shown === 0 ? 250 : 420);
    return () => window.clearTimeout(t);
  }, [result, shown, players.length]);

  function draw() {
    setResult(shuffle(players));
    setShown(0);
  }

  // 每個人抽到邊個風
  const windOf = (p: string) => (result ? result.indexOf(p) : -1);

  /** 自己揀：撳一個位，再撳另一個位，兩個人對調 */
  function tapSeat(i: number) {
    if (sel === null) { setSel(i); sfx.tap(); return; }
    if (sel !== i) {
      setOrder((o) => { const n = [...o]; [n[sel], n[i]] = [n[i], n[sel]]; return n; });
      sfx.chips();
    }
    setSel(null);
  }

  const tabs = (
    <div className="seg wide" role="tablist" aria-label="掉位方法">
      <button type="button" role="tab" aria-selected={mode === 'draw'} aria-pressed={mode === 'draw'} onClick={() => setMode('draw')}>抽風牌</button>
      <button type="button" role="tab" aria-selected={mode === 'pick'} aria-pressed={mode === 'pick'} onClick={() => { setMode('pick'); setSel(null); }}>自己揀</button>
    </div>
  );

  if (mode === 'pick') {
    const changed = order.some((p, i) => p !== players[i]);
    return (
      <div className="stack">
        <h2>掉位</h2>
        {tabs}
        <Hint>撳一個位，再撳另一個位，兩人對調。坐東位的做首莊。</Hint>
        <div className="pick-seats">
          {order.map((p, i) => (
            <button
              key={WINDS[i]}
              type="button"
              className={`pick-seat${sel === i ? ' on' : ''}`}
              aria-pressed={sel === i}
              aria-label={`${WINDS[i]}位：${name(p)}`}
              onClick={() => tapSeat(i)}
            >
              <span className="pick-wind">{WINDS[i]}</span>
              <span className="ellipsis">{name(p)}</span>
              {i === 0 && <small>首莊</small>}
            </button>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn grow" disabled={busy || !changed} onClick={() => onConfirm(order)}>{changed ? '確認座位' : '未有改動'}</button>
          <button type="button" className="btn plain" onClick={changed ? () => { setOrder(players); setSel(null); } : onCancel}>{changed ? '還原' : '取消'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <h2>掉位</h2>
      {tabs}
      <Hint>每人抽一隻風牌，抽到東的坐東位做首莊，其後南、西、北。</Hint>
      <div className="draw-row">
        {players.map((p, i) => {
          const w = windOf(p);
          const open = result !== null && i < shown;
          return (
            <div key={p} className="draw-cell">
              <div className={`draw-tile${open ? ' open' : ''}`}>
                <span className="draw-back" />
                <span className="draw-face">{w >= 0 ? WINDS[w] : ''}</span>
              </div>
              <span className="ellipsis small">{name(p)}</span>
            </div>
          );
        })}
      </div>
      {result && shown >= players.length ? (
        <>
          <p className="center-text">{result.map((p, i) => `${WINDS[i]}：${name(p)}`).join('　')}</p>
          <div className="row">
            <button type="button" className="btn grow" disabled={busy} onClick={() => onConfirm(result)}>確認座位</button>
            <button type="button" className="btn plain" onClick={draw}>重新抽</button>
          </div>
        </>
      ) : (
        <div className="row">
          <button type="button" className="btn grow" disabled={result !== null} onClick={draw}>抽風牌</button>
          <button type="button" className="btn plain" onClick={onCancel}>取消</button>
        </div>
      )}
    </div>
  );
}
