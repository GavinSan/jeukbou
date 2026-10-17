// 掉位：四隻風牌冚住，逐隻反開，邊個攞到東就坐東
import { useEffect, useState } from 'react';
import { sfx } from '../lib/sound.ts';

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
  const [result, setResult] = useState<string[] | null>(null);
  const [shown, setShown] = useState(0);

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

  return (
    <div className="stack">
      <h2>掉位</h2>
      <p className="muted small">每人抽一隻風牌，抽到東嘅坐東做第一個莊，跟住南、西、北。</p>
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
            <button type="button" className="btn grow" disabled={busy} onClick={() => onConfirm(result)}>就咁坐</button>
            <button type="button" className="btn plain" onClick={draw}>再掉</button>
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
