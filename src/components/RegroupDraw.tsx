// 幾張枱一齊執位：X 張枱 = X × 4 隻牌（壹貳參肆…），反轉擺好；每人揀一隻，同一隻字 = 同一張枱。
// 可以每人喺自己部機揀，或者同一部機幫人揀，又或者電腦派。揀牌用 transaction，兩個人同時撳都只得一個成功。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react';
import type { Draw } from '../lib/data.ts';
import { UPPER_NUM, drawNext, tableNameUpper } from '../lib/data.ts';
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

/** 名單一行：向左掃出「移除」，掃晒就直接移除 */
function SwipeRow({ name, note, onRemove }: { name: string; note?: string; onRemove: () => void }) {
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; w: number; locked: boolean | null } | null>(null);
  // 掃完放手，瀏覽器仲會補一下 click：唔好當係「撳一下收返」
  const swiped = useRef(false);
  const REVEAL = 88;
  function down(e: RPointerEvent<HTMLDivElement>) {
    swiped.current = false;
    start.current = { x: e.clientX, y: e.clientY, base: dx, w: e.currentTarget.offsetWidth, locked: null };
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const st = start.current;
    if (!st) return;
    const mx = e.clientX - st.x;
    const my = e.clientY - st.y;
    if (st.locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      st.locked = Math.abs(mx) > Math.abs(my);
      if (st.locked) { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); }
    }
    if (st.locked) setDx(Math.min(0, Math.max(-st.w, st.base + mx)));
  }
  function up() {
    const st = start.current;
    start.current = null;
    setDrag(false);
    if (!st?.locked) return;
    swiped.current = true;
    if (-dx > st.w * 0.6) { setDx(-st.w); buzz('tap'); setTimeout(onRemove, 160); return; }
    setDx(-dx > REVEAL / 2 ? -REVEAL : 0);
  }
  return (
    <div className="swipe-row">
      <button type="button" className="swipe-del" onClick={onRemove} tabIndex={dx ? 0 : -1} aria-label={`移除 ${name}`}>移除</button>
      <div
        className={`swipe-front${drag ? ' dragging' : ''}`}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => { if (swiped.current) { swiped.current = false; return; } if (dx) setDx(0); }}
      >
        <span className="swipe-av" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="grow ellipsis">{name}</span>
        {note && <small className="muted">{note}</small>}
        <button type="button" className="swipe-x" aria-label={`${name} 走咗`} onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
      </div>
    </div>
  );
}

/** 開始：揀邊啲人參加（可以減走走咗嘅、加新嚟嘅）、用揀牌定電腦派 */
export function DrawSetup({ tables, candidates, ranking, me, canForce, onStart, onClose }: {
  tables: DrawTable[]; candidates: Person[]; ranking: string[]; me: string; canForce: boolean;
  onStart: (d: Draw) => Promise<void>; onClose: () => void;
}) {
  // 同一個人唔好出兩次（例如枱資料未同步好）：重複就只留第一個
  const initial = useMemo(() => {
    const out: Person[] = [];
    for (const t of tables) for (const id of t.seats) if (!out.some((p) => p.id === id)) out.push({ id, name: t.names[id] ?? '玩家' });
    return out;
  }, [tables]);
  const tableOf = useMemo(() => Object.fromEntries(tables.flatMap((t) => t.seats.map((id) => [id, t.name]))), [tables]);
  const [roster, setRoster] = useState<Person[]>(initial);
  // 減咗嘅人（包括訪客）記住，等佢可以加返
  const [removed, setRemoved] = useState<Person[]>([]);
  const [mode, setMode] = useState<'pick' | 'auto'>('pick');
  // 由高分到低分輪住揀（預設開）；閂咗就邊個都可以隨時揀
  const [strict, setStrict] = useState(() => { try { return localStorage.getItem('jeukbou-draw-strict') !== '0'; } catch { return true; } });
  const [guest, setGuest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = roster.length;
  const rem = count % 4;
  const n = Math.floor(count / 4);
  const ok = count >= 4 && rem === 0 && n <= UPPER_NUM.length;
  const inRoster = (id: string) => roster.some((r) => r.id === id);
  const pool: Person[] = [];
  for (const p of [...removed, ...initial, ...candidates]) if (!inRoster(p.id) && !pool.some((x) => x.id === p.id)) pool.push(p);
  const remove = (p: Person) => { setRoster((l) => l.filter((x) => x.id !== p.id)); setRemoved((l) => [p, ...l.filter((x) => x.id !== p.id)]); };
  const add = (p: Person) => { setRoster((l) => (l.some((x) => x.id === p.id) ? l : [...l, p])); setRemoved((l) => l.filter((x) => x.id !== p.id)); };
  const status = count < 4 ? `差 ${4 - count} 人先開到枱` : rem === 0 ? `${n} 張枱，啱啱好` : `差 ${4 - rem} 人先夠 ${n + 1} 張枱（或者減 ${rem} 個）`;

  async function start() {
    setBusy(true); setError('');
    try {
      const tiles = shuffleArr(Array.from({ length: roster.length }, (_, i) => Math.floor(i / 4)));
      const rank = (id: string) => { const i = ranking.indexOf(id); return i < 0 ? 999 : i; };
      await onStart({
        id: Math.random().toString(36).slice(2, 10), by: me, at: Date.now(), mode, tables: tables.map((t) => t.id),
        players: roster, tiles, picks: {}, order: [...roster].sort((a, b) => rank(a.id) - rank(b.id)).map((p) => p.id),
        status: canForce ? 'picking' : 'propose', approvals: [me], strict: mode === 'pick' && strict,
      });
      try { localStorage.setItem('jeukbou-draw-strict', strict ? '1' : '0'); } catch { /* 唔緊要 */ }
      onClose();
    } catch (err) { setError(message(err)); setBusy(false); }
  }

  return (
    <Sheet onClose={onClose} label="一齊執位">
      <h2>一齊執位</h2>
      <div className={`draw-count${ok ? ' ok' : ''}`}>
        <b className="num">{count}</b><span>人</span>
        <span className="grow">{status}</span>
      </div>
      <div className="swipe-list" role="list" aria-label="參加嘅人">
        {roster.map((p) => <SwipeRow key={p.id} name={p.name} note={tableOf[p.id] ?? (p.id.startsWith('guest-') ? '訪客' : '新加')} onRemove={() => remove(p)} />)}
        {!roster.length && <p className="muted small">未有人。</p>}
      </div>
      <small className="muted">向左掃移除；掃晒即刻移除。</small>
      {pool.length > 0 && (
        <div className="field">
          <span>加人{removed.length ? '（包括啱啱減咗嘅）' : ''}</span>
          <div className="chips-row">{pool.map((c) => <button key={c.id} type="button" className="pill" onClick={() => add(c)}>＋ {c.name}</button>)}</div>
        </div>
      )}
      <div className="row">
        <input className="input grow" value={guest} onChange={(e) => setGuest(clampName(e.target.value))} placeholder="加訪客名" aria-label="訪客名" />
        <button type="button" className="btn plain" disabled={!guest.trim()} onClick={() => { add({ id: `guest-${Math.random().toString(36).slice(2, 10)}`, name: guest.trim() }); setGuest(''); }}>加</button>
      </div>
      <div className="seg wide" role="radiogroup" aria-label="點樣執位">
        <button type="button" role="radio" aria-checked={mode === 'pick'} aria-pressed={mode === 'pick'} onClick={() => setMode('pick')}>每人揀牌</button>
        <button type="button" role="radio" aria-checked={mode === 'auto'} aria-pressed={mode === 'auto'} onClick={() => setMode('auto')}>電腦派</button>
      </div>
      {mode === 'pick' && (
        <div className="rule-row">
          <span className="grow">由高分到低分輪住揀<small>{strict ? '輪到先揀得，到你會通知你' : '閂咗：邊個都可以隨時揀'}</small></span>
          <button type="button" role="switch" className="switch" aria-checked={strict} aria-label="由高分到低分輪住揀" onClick={() => setStrict((v) => !v)} />
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy || !ok} onClick={start}>
        {!ok ? (count < 4 ? `差 ${4 - count} 人` : `差 ${4 - rem} 人`) : canForce ? `開始（${n} 張枱）` : '提議（每張枱要一個人同意）'}
      </button>
    </Sheet>
  );
}

/** 抽牌板：全部部機同步；揀咗嘅牌反轉，下面寫邊個揀咗 */
export function DrawBoard({ draw, me, tables, canForce, onApprove, onPick, onAuto, onCancel, onApply, onClose }: {
  draw: Draw; me: string; tables: DrawTable[]; canForce: boolean;
  onApprove: () => Promise<void>;
  onPick: (tile: number, player: string) => Promise<'ok' | 'taken' | 'done-already' | 'not-turn'>;
  onAuto: () => Promise<void>;
  onCancel: () => Promise<void>;
  onApply: (plan: { keep: string | null; seats: string[]; names: Record<string, string>; name: string }[], endTables: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const next = drawNext(draw);
  const strict = !!draw.strict && draw.status === 'picking';
  const nameOf = (id: string) => draw.players.find((p) => p.id === id)?.name ?? '玩家';
  const pickedBy = new Map(Object.entries(draw.picks).map(([k, v]) => [Number(k), v]));
  const done = new Set(Object.values(draw.picks));
  const left = draw.order.filter((id) => !done.has(id));
  const [actor, setActor] = useState<string>(() => (draw.players.some((p) => p.id === me) ? me : left[0] ?? ''));
  // 輪住揀：一定係輪到嗰個；自己或者場主（幫冇電話嘅人）先撳得
  const who = strict ? next ?? '' : actor;
  const canPickNow = !strict || who === me || canForce || draw.by === me;
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
    if (draw.status !== 'picking' || pickedBy.has(i) || !who || busy) return;
    if (!canPickNow) { setError(`未到你，等 ${nameOf(who)} 揀先`); return; }
    buzz('tap');
    await act(async () => {
      const r = await onPick(i, who);
      if (r === 'taken') setError('呢隻啱啱俾人揀咗，揀過第二隻');
      if (r === 'not-turn') setError('未輪到，等前面嘅人揀先');
      if (r === 'done-already') setError(`${nameOf(who)} 已經揀咗`);
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
          {strict && draw.mode === 'pick' && (
            <div className={`draw-turn${who === me ? ' mine' : ''}`} role="status">
              {who === me ? <b>到你揀！撳一隻牌</b> : <span>輪到 <b>{nameOf(who)}</b> 揀{canPickNow ? '（佢冇電話可以幫佢撳）' : ''}</span>}
              <small className="muted">次序：{draw.order.map((id) => `${nameOf(id)}${done.has(id) ? '✓' : ''}`).join(' → ')}</small>
            </div>
          )}
          {draw.status === 'picking' && !strict && draw.mode === 'pick' && (
            <div className="draw-actor">
              <span className="small muted">幫邊個揀：</span>
              <div className="chips-row">
                {left.map((id) => (
                  <button key={id} type="button" className="pp-chip" aria-pressed={actor === id} onClick={() => setActor(id)}>
                    <span className="ellipsis">{nameOf(id)}</span>{id === me && <small>你</small>}
                  </button>
                ))}
              </div>
              <small className="muted">高分先揀；冇電話可以喺呢部機幫佢揀。</small>
            </div>
          )}
          <div className={`draw-grid${shuffling && draw.status === 'picking' && !pickedBy.size ? ' shuffling' : ''}`} style={{ '--cols': Math.min(8, Math.max(5, Math.ceil(Math.sqrt(draw.tiles.length * 2.4)))) } as CSSProperties}>
            {draw.tiles.map((t, i) => {
              const owner = pickedBy.get(i);
              const open = owner !== undefined;
              const delay = draw.mode === 'auto' && open ? `${(fresh.indexOf(i) >= 0 ? fresh.indexOf(i) : 0) * 0.12}s` : '0s';
              return (
                <button
                  key={`${startedAt}-${i}`}
                  type="button"
                  className={`draw-tile${open ? ' open' : ''}${owner === me ? ' mine' : ''}`}
                  style={{ '--c': TILE_COLORS[t % TILE_COLORS.length], '--d': delay, '--sx': `${((i * 37) % 7) - 3}`, '--sy': `${((i * 53) % 5) - 2}` } as CSSProperties}
                  disabled={open || draw.status !== 'picking' || !who || !canPickNow}
                  aria-label={open ? `${UPPER_NUM[t]}，${nameOf(owner!)}` : `第 ${i + 1} 隻牌，未揀`}
                  onClick={() => pick(i)}
                >
                  <span className="dt-inner">
                    <span className="dt-back" aria-hidden="true" />
                    <span className="dt-face"><b>{UPPER_NUM[t]}</b>{open && <small className="dt-who">{nameOf(owner!)}</small>}</span>
                  </span>
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
