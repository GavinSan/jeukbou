// 幾張枱一齊執位：X 張枱 = X × 4 隻牌（壹貳參肆…），反轉擺好；每人揀一隻，同一隻字 = 同一張枱。
// 可以每人喺自己部機揀，或者同一部機幫人揀，又或者電腦派。揀牌用 transaction，兩個人同時撳都只得一個成功。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Draw } from '../lib/data.ts';
import { UPPER_NUM, tableNameUpper } from '../lib/data.ts';
import { Sheet, clampName, message } from '../ui.tsx';
import { sfx } from '../lib/sound.ts';
import { buzz } from '../lib/haptics.ts';

export interface DrawTable {
  id: string;
  name: string;
  seats: string[];
  names: Record<string, string>;
}

interface Person { id: string; name: string }

const TILE_COLORS = ['#B02E26', '#1F6B45', '#1F3B66', '#8A4A12', '#6B2E83', '#0E7490', '#9D174D', '#4D5B1F', '#7A2A10', '#334155'];

function shuffleArr<T>(a: T[]): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

/** 開始：揀邊啲人參加（可以減走走咗嘅、加新嚟嘅）、用揀牌定電腦派 */
export function DrawSetup({ tables, candidates, ranking, me, canForce, onStart, onClose }: {
  tables: DrawTable[]; candidates: Person[]; ranking: string[]; me: string; canForce: boolean;
  onStart: (d: Draw) => Promise<void>; onClose: () => void;
}) {
  const initial = useMemo(() => tables.flatMap((t) => t.seats.map((id) => ({ id, name: t.names[id] ?? '玩家' }))), [tables]);
  const [roster, setRoster] = useState<Person[]>(initial);
  const [mode, setMode] = useState<'pick' | 'auto'>('pick');
  const [guest, setGuest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = roster.length / 4;
  const ok = roster.length >= 4 && Number.isInteger(n) && n <= UPPER_NUM.length;
  const free = candidates.filter((c) => !roster.some((r) => r.id === c.id));

  async function start() {
    setBusy(true); setError('');
    try {
      const tiles = shuffleArr(Array.from({ length: roster.length }, (_, i) => Math.floor(i / 4)));
      const rank = (id: string) => { const i = ranking.indexOf(id); return i < 0 ? 999 : i; };
      await onStart({
        id: Math.random().toString(36).slice(2, 10), by: me, at: Date.now(), mode, tables: tables.map((t) => t.id),
        players: roster, tiles, picks: {}, order: [...roster].sort((a, b) => rank(a.id) - rank(b.id)).map((p) => p.id),
        status: canForce ? 'picking' : 'propose', approvals: [me],
      });
      onClose();
    } catch (err) { setError(message(err)); setBusy(false); }
  }

  return (
    <Sheet onClose={onClose} label="一齊執位">
      <h2>一齊執位</h2>
      <div className="field">
        <span>參加嘅人（{roster.length}）{ok ? `・${n} 張枱` : '・要 4 嘅倍數'}</span>
        <div className="chips-row">
          {roster.map((p) => (
            <span key={p.id} className="person-chip">
              {p.name}
              <button type="button" aria-label={`${p.name} 走咗`} onClick={() => setRoster((l) => l.filter((x) => x.id !== p.id))}>×</button>
            </span>
          ))}
        </div>
      </div>
      {free.length > 0 && (
        <div className="field">
          <span>加新嚟嘅人</span>
          <div className="chips-row">{free.map((c) => <button key={c.id} type="button" className="pill" onClick={() => setRoster((l) => [...l, c])}>＋ {c.name}</button>)}</div>
        </div>
      )}
      <div className="row">
        <input className="input grow" value={guest} onChange={(e) => setGuest(clampName(e.target.value))} placeholder="加訪客名" aria-label="訪客名" />
        <button type="button" className="btn plain" disabled={!guest.trim()} onClick={() => { setRoster((l) => [...l, { id: `guest-${Math.random().toString(36).slice(2, 10)}`, name: guest.trim() }]); setGuest(''); }}>加</button>
      </div>
      <div className="seg wide" role="radiogroup" aria-label="點樣執位">
        <button type="button" role="radio" aria-checked={mode === 'pick'} aria-pressed={mode === 'pick'} onClick={() => setMode('pick')}>每人揀牌</button>
        <button type="button" role="radio" aria-checked={mode === 'auto'} aria-pressed={mode === 'auto'} onClick={() => setMode('auto')}>電腦派</button>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy || !ok} onClick={start}>
        {!ok ? '人數要係 4 嘅倍數' : canForce ? '開始' : '提議（每張枱要一個人同意）'}
      </button>
    </Sheet>
  );
}

/** 抽牌板：全部部機同步；揀咗嘅牌反轉，下面寫邊個揀咗 */
export function DrawBoard({ draw, me, tables, canForce, onApprove, onPick, onAuto, onCancel, onApply, onClose }: {
  draw: Draw; me: string; tables: DrawTable[]; canForce: boolean;
  onApprove: () => Promise<void>;
  onPick: (tile: number, player: string) => Promise<'ok' | 'taken' | 'done-already'>;
  onAuto: () => Promise<void>;
  onCancel: () => Promise<void>;
  onApply: (plan: { keep: string | null; seats: string[]; names: Record<string, string>; name: string }[], endTables: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const nameOf = (id: string) => draw.players.find((p) => p.id === id)?.name ?? '玩家';
  const pickedBy = new Map(Object.entries(draw.picks).map(([k, v]) => [Number(k), v]));
  const done = new Set(Object.values(draw.picks));
  const left = draw.order.filter((id) => !done.has(id));
  const [actor, setActor] = useState<string>(() => (draw.players.some((p) => p.id === me) ? me : left[0] ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keep, setKeep] = useState<Record<number, boolean>>({});
  // 一開始洗牌動畫
  const [shuffling, setShuffling] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShuffling(false), 1300); return () => clearTimeout(t); }, [draw.id]);
  // 新反開嘅牌：記低次序，令電腦派嗰陣逐隻反
  const seen = useRef<Set<number>>(new Set());
  const fresh: number[] = [];
  for (const i of pickedBy.keys()) if (!seen.current.has(i)) fresh.push(i);
  useEffect(() => {
    if (!fresh.length) return;
    fresh.forEach((i) => seen.current.add(i));
    if (seen.current.size > 0) sfx.tap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh.join(',')]);
  useEffect(() => { if (actor && done.has(actor)) setActor(left[0] ?? ''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [draw.picks]);

  const nTables = Math.max(1, Math.round(draw.tiles.length / 4));
  const groups = Array.from({ length: nTables }, (_, k) => draw.tiles.map((t, i) => (t === k ? pickedBy.get(i) : undefined)).filter((x): x is string => !!x));
  const sameAs = (ids: string[]) => tables.find((t) => t.seats.length === 4 && ids.length === 4 && ids.every((id) => t.seats.includes(id)));
  const startedAt = draw.at;
  const canApply = canForce || draw.by === me;

  async function act(t: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await t(); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }

  async function pick(i: number) {
    if (draw.status !== 'picking' || pickedBy.has(i) || !actor || busy) return;
    buzz('tap');
    await act(async () => {
      const r = await onPick(i, actor);
      if (r === 'taken') setError('呢隻啱啱俾人揀咗，揀過第二隻');
      if (r === 'done-already') setError(`${nameOf(actor)} 已經揀咗`);
      if (r === 'ok') sfx.chips();
    });
  }

  const approvedTables = draw.tables.filter((tid) => (tables.find((t) => t.id === tid)?.seats ?? []).some((p) => draw.approvals.includes(p)));
  const myTable = tables.find((t) => t.seats.includes(me) && draw.tables.includes(t.id));
  const needMe = draw.status === 'propose' && !!myTable && !approvedTables.includes(myTable.id);

  return (
    <Sheet onClose={onClose} label="一齊執位">
      <div className="between"><h2>一齊執位</h2><span className="muted small">{draw.players.length} 人・{nTables} 張枱</span></div>

      {draw.status === 'propose' && (
        <div className="stack tight">
          <p className="banner calm small">{nameOf(draw.by) || '有人'} 提議一齊執位。每張枱有一個人同意就開始（場主、局主可以直接開始）。</p>
          <div className="chips-row">
            {draw.tables.map((tid) => {
              const t = tables.find((x) => x.id === tid);
              const okT = approvedTables.includes(tid);
              return <span key={tid} className={`pay-status${okT ? ' done' : ''}`}>{t?.name ?? '枱'}{okT ? ' ✓' : ' 等同意'}</span>;
            })}
          </div>
          {(needMe || canForce) && <button type="button" className="btn big" disabled={busy} onClick={() => act(onApprove)}>{canForce && !needMe ? '直接開始' : '同意'}</button>}
        </div>
      )}

      {draw.status !== 'propose' && (
        <>
          {draw.status === 'picking' && (
            <div className="draw-actor">
              <span className="small muted">幫邊個揀：</span>
              <div className="chips-row">
                {left.map((id) => (
                  <button key={id} type="button" className="pp-chip" aria-pressed={actor === id} onClick={() => setActor(id)}>
                    <span className="ellipsis">{nameOf(id)}</span>{id === me && <small>你</small>}
                  </button>
                ))}
              </div>
              <small className="muted">次序跟全場排名（高分先揀）；冇電話嘅人可以喺同一部機幫佢揀。</small>
            </div>
          )}
          <div className={`draw-grid${shuffling && draw.status === 'picking' && !pickedBy.size ? ' shuffling' : ''}`} style={{ '--cols': 4 } as CSSProperties}>
            {draw.tiles.map((t, i) => {
              const who = pickedBy.get(i);
              const open = who !== undefined;
              const delay = draw.mode === 'auto' && open ? `${(fresh.indexOf(i) >= 0 ? fresh.indexOf(i) : 0) * 0.12}s` : '0s';
              return (
                <button
                  key={`${startedAt}-${i}`}
                  type="button"
                  className={`draw-tile${open ? ' open' : ''}${who === me ? ' mine' : ''}`}
                  style={{ '--c': TILE_COLORS[t % TILE_COLORS.length], '--d': delay, '--sx': `${((i * 37) % 7) - 3}`, '--sy': `${((i * 53) % 5) - 2}` } as CSSProperties}
                  disabled={open || draw.status !== 'picking' || !actor}
                  aria-label={open ? `${UPPER_NUM[t]}，${nameOf(who!)}` : `第 ${i + 1} 隻牌，未揀`}
                  onClick={() => pick(i)}
                >
                  <span className="dt-inner">
                    <span className="dt-back" aria-hidden="true" />
                    <span className="dt-face"><b>{UPPER_NUM[t]}</b></span>
                  </span>
                  <small className="dt-who">{open ? nameOf(who!) : ' '}</small>
                </button>
              );
            })}
          </div>
        </>
      )}

      {draw.status === 'done' && (
        <div className="stack">
          {groups.map((ids, k) => {
            const same = sameAs(ids);
            const keepIt = same ? keep[k] ?? true : false;
            return (
              <div key={k} className="draw-result">
                <div className="between">
                  <b className="draw-result-name" style={{ color: TILE_COLORS[k % TILE_COLORS.length] }}>{tableNameUpper(k)}</b>
                  {same && (
                    <div className="seg" role="radiogroup" aria-label="原班人馬">
                      <button type="button" aria-pressed={keepIt} onClick={() => setKeep((m) => ({ ...m, [k]: true }))}>繼續之前條數</button>
                      <button type="button" aria-pressed={!keepIt} onClick={() => setKeep((m) => ({ ...m, [k]: false }))}>重新開始</button>
                    </div>
                  )}
                </div>
                <div className="draw-result-people">
                  {ids.map((id) => {
                    const moved = !tables.some((t) => t.seats.includes(id) && ids.every((x) => t.seats.includes(x)));
                    return <span key={id} className={`draw-person${moved ? ' moved' : ''}${id === me ? ' me' : ''}`}>{nameOf(id)}</span>;
                  })}
                </div>
                {same && <small className="muted">{same.name}原班人馬：{keepIt ? '保留原枱同拉住嘅數' : '舊枱完場，由東圈東重新計'}</small>}
              </div>
            );
          })}
          {canApply ? (
            <button type="button" className="btn big" disabled={busy} onClick={() => act(async () => {
              const plan = groups.map((ids, k) => {
                const same = sameAs(ids);
                const keepIt = !!same && (keep[k] ?? true);
                const names = Object.fromEntries(ids.map((id) => [id, nameOf(id)]));
                return { keep: keepIt ? same!.id : null, seats: shuffleArr(ids), names, name: tableNameUpper(k) };
              });
              const kept = new Set(plan.map((p) => p.keep).filter(Boolean) as string[]);
              await onApply(plan, draw.tables.filter((t) => !kept.has(t)));
              onClose();
            })}>確認執位（舊枱完場、開新枱）</button>
          ) : <p className="muted small center-text">等 {nameOf(draw.by)} 或者場主確認。</p>}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="row">
        {draw.status === 'picking' && (canForce || draw.by === me) && <button type="button" className="btn plain grow" disabled={busy} onClick={() => act(onAuto)}>電腦派晒</button>}
        {(canForce || draw.by === me) && <button type="button" className="textbtn loss" disabled={busy} onClick={() => act(async () => { await onCancel(); onClose(); })}>取消執位</button>}
      </div>
    </Sheet>
  );
}
