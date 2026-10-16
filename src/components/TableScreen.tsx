// 一張枱：綠絨布枱面 + 撳人入數。資料由外面傳入，所以示範模式都用到。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyEvent, seatWind } from '../engine/table.ts';
import type { Line, TableEvent } from '../engine/table.ts';
import type { Rules } from '../engine/rules.ts';
import type { TableDoc, UndoEvent } from '../lib/data.ts';
import type { Computed } from '../lib/score.ts';
import { ago, describe } from '../lib/score.ts';
import { Chips, RollingNumber, Sheet, TopBar, message, useNow } from '../ui.tsx';

const SPOTS = ['s-bottom', 's-right', 's-top', 's-left'];
const QUICK_FANS = [3, 5, 8, 10, 13, 15, 20, 30, 40, 60];
const SPECIALS = [
  { k: '暗槓', v: 5, dir: 'collect' as const },
  { k: '一台花', v: 5, dir: 'collect' as const },
  { k: '一台草', v: 2, dir: 'collect' as const },
  { k: '圍骰', v: 5, dir: 'collect' as const },
  { k: '骰開一二三', v: 5, dir: 'pay' as const },
  { k: '叫碰唔碰', v: 5, dir: 'pay' as const },
  { k: '被追（番子）', v: 5, dir: 'pay' as const },
  { k: '被追（其他）', v: 10, dir: 'pay' as const },
];
const KIND: Record<Line['kind'], string> = { pending: '擺低', settle: '找數', instant: '即時', water: '抽水' };

interface Entry {
  winners: string[];
  /** undefined = 未揀；null = 自摸 */
  loser: string | null | undefined;
  fans: Record<string, number>;
  step: 'who' | 'fan';
  current: string;
}

type More = null | 'menu' | 'falseWin' | 'special' | 'draw' | 'end';

export interface TableScreenProps {
  table: TableDoc;
  computed: Computed;
  rules: Rules;
  me: string | null;
  back: string;
  subtitle?: string;
  onPush: (event: TableEvent | UndoEvent) => Promise<void>;
}

export default function TableScreen({ table, computed: c, rules, me, back, subtitle, onPush }: TableScreenProps) {
  const now = useNow();
  const name = useCallback((id: string) => table.names[id] ?? '玩家', [table.names]);
  const seats = table.seats;
  const ended = c.state.ended;

  // 自己坐喺下面
  const rotate = me && seats.includes(me) ? seats.indexOf(me) : 0;
  const spotOf = (i: number) => SPOTS[(i - rotate + 4) % 4];

  const [entry, setEntry] = useState<Entry | null>(null);
  const [more, setMore] = useState<More>(null);
  const [who, setWho] = useState('');
  const [special, setSpecial] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [dealing, setDealing] = useState(true);
  const [fx, setFx] = useState<{ won: string[]; hit: string[]; key: number }>({ won: [], hit: [], key: 0 });

  useEffect(() => { const t = setTimeout(() => setDealing(false), 900); return () => clearTimeout(t); }, []);

  // 有新一鋪（包括其他手機入嘅）就郁吓啲牌
  const lastSeq = c.steps.length ? c.steps[c.steps.length - 1].seq : 0;
  const seen = useRef(lastSeq);
  useEffect(() => {
    if (lastSeq <= seen.current) { seen.current = lastSeq; return; }
    seen.current = lastSeq;
    const last = c.steps[c.steps.length - 1];
    const ev = last.event;
    let won: string[] = [];
    let hit: string[] = [];
    if (ev.type === 'win') {
      won = ev.winners.map((w) => w.player);
      hit = ev.loser ? [ev.loser] : seats.filter((s) => !won.includes(s));
    } else if (ev.type === 'falseWin') {
      hit = [ev.player];
    }
    setFx((f) => ({ won, hit, key: f.key + 1 }));
    const t = setTimeout(() => setFx((f) => ({ ...f, won: [], hit: [] })), 900);
    return () => clearTimeout(t);
  }, [lastSeq, c.steps, seats]);

  const owe: Record<string, number> = {};
  const collect: Record<string, number> = {};
  for (const ch of c.state.chains) {
    owe[ch.pulled] = (owe[ch.pulled] ?? 0) + ch.owed;
    collect[ch.puller] = (collect[ch.puller] ?? 0) + ch.owed;
  }

  const every = rules.la.settleEvery;
  const settleable = rules.la.enabled && every > 0 && !ended
    ? c.state.chains.filter((ch) => ch.count % every === 0 && !dismissed.includes(`${ch.puller}>${ch.pulled}#${ch.count}`))
    : [];

  async function push(event: TableEvent | UndoEvent, done: string) {
    setError('');
    setBusy(true);
    try {
      if (event.type !== 'undo') applyEvent(c.state, event, rules);
      await onPush(event);
      setEntry(null);
      setMore(null);
      setWho('');
      setToast(done);
      setTimeout(() => setToast(''), 2200);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  // ---------- 食糊 ----------
  function startWin(id: string) {
    if (ended) return;
    setError('');
    setEntry({ winners: [id], loser: undefined, fans: {}, step: 'who', current: id });
  }

  const draft: TableEvent | null = useMemo(() => {
    if (!entry || entry.loser === undefined) return null;
    return {
      type: 'win',
      winners: entry.winners.map((w) => ({ player: w, fan: entry.fans[w] ?? 0 })),
      loser: entry.loser,
    };
  }, [entry]);

  const preview = useMemo((): { lines: Line[]; error: string } => {
    if (!draft) return { lines: [], error: '' };
    try {
      return { lines: applyEvent(c.state, draft, rules).lines, error: '' };
    } catch (err) {
      return { lines: [], error: message(err) };
    }
  }, [draft, c.state, rules]);

  function setFan(id: string, v: number) {
    setEntry((e) => (e ? { ...e, fans: { ...e.fans, [id]: Math.max(0, Math.min(999, Math.round(v))) } } : e));
  }

  const lastStep = c.steps[c.steps.length - 1];
  const log = [...c.steps].reverse().slice(0, showAll ? undefined : 4);
  const sum = (lines: Line[]) => lines.filter((l) => l.kind !== 'water').reduce((a, l) => a + l.amount, 0);

  return (
    <main className="page">
      <TopBar
        back={back}
        title={<div className="stack tight"><h1>{table.name}</h1>{subtitle && <span className="muted small">{subtitle}</span>}</div>}
        right={!ended ? <button type="button" className="iconbtn" aria-label="其他：詐糊、特別事項、流局、完場" onClick={() => { setError(''); setMore('menu'); }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>
        </button> : undefined}
      />

      {settleable.map((ch) => (
        <div key={ch.puller + ch.pulled} className="banner">
          <span className="grow">第 {ch.count} 拉，{name(ch.pulled)} 欠 {name(ch.puller)} <b className="num">{ch.owed}</b>。{name(ch.pulled)} 揀找唔找。</span>
          <button type="button" className="btn danger" disabled={busy} onClick={() => push({ type: 'settle', puller: ch.puller, pulled: ch.pulled }, '已找數')}>找數</button>
          <button type="button" className="textbtn loss" onClick={() => setDismissed((d) => [...d, `${ch.puller}>${ch.pulled}#${ch.count}`])}>唔找</button>
        </div>
      ))}

      <section className={`felt${dealing ? ' deal' : ''}`} aria-label="枱面">
        {seats.map((id, i) => {
          const settled = c.state.settled[id] ?? 0;
          const isDealer = c.info.dealer === id && !ended;
          const cls = ['tile', spotOf(i), fx.won.includes(id) ? 'won' : '', fx.hit.includes(id) ? 'hit' : ''].filter(Boolean).join(' ');
          return (
            <button key={id} type="button" className={cls} onClick={() => startWin(id)} disabled={ended} aria-label={`${name(id)}，${settled} 番，撳嚟入佢食糊`}>
              <span className="t-name"><span className="ellipsis">{name(id)}</span>{isDealer && <span className="dealer-mark">莊{c.state.streak ? c.state.streak : ''}</span>}</span>
              <RollingNumber value={settled} className={`t-score t-${tone2(settled)}`} />
              <span className="t-foot">
                {owe[id] ? <><Chips amount={owe[id]} pop={fx.hit.includes(id)} /><span className="t-loss">{owe[id]}</span></> : null}
                {collect[id] ? <span className="t-gain">+{collect[id]}</span> : null}
                <span className="t-wind">{seatWind(c.state, id)}</span>
              </span>
            </button>
          );
        })}
        <div className="felt-center">
          <span className="wind-tile">{ended ? '完' : c.info.roundWind}</span>
          <span className="small">{ended ? '已完場' : `第 ${c.info.hand} 鋪`}</span>
        </div>
      </section>

      {!ended && <p className="hint">撳食糊嗰個人入數</p>}

      <section className="stack">
        <div className="section-head">
          <h2>紀錄</h2>
          {lastStep && !ended && (
            <button type="button" className="textbtn loss" disabled={busy} onClick={() => push({ type: 'undo', target: lastStep.seq }, '已撤回')}>撤回最後一鋪</button>
          )}
        </div>
        {c.skipped.length > 0 && <p className="banner small">{c.skipped.map((s) => `第 ${s.seq} 項計唔到：${s.message}`).join('；')}</p>}
        {c.steps.length === 0 ? (
          <p className="muted">未有紀錄。撳上面食糊嗰個人就開始。</p>
        ) : (
          <ul className="log list">
            {log.map((st) => (
              <li key={st.seq}>
                <span className="who">
                  {describe(st.event, name)}
                  {st.result.lines.length > 0 && <span className="detail"><br />{st.result.lines.filter((l) => l.kind !== 'water').map((l) => `${name(l.from)}→${l.to ? name(l.to) : '水'} ${l.amount}`).join('，')}</span>}
                </span>
                <span className="when">{ago(st.at, now)}</span>
              </li>
            ))}
          </ul>
        )}
        {c.steps.length > 4 && (
          <button type="button" className="textbtn" onClick={() => setShowAll((v) => !v)}>{showAll ? '收埋' : `睇晒 ${c.steps.length} 鋪`}</button>
        )}
      </section>

      {entry && (
        <Sheet onClose={() => setEntry(null)} label="入數">
          {entry.step === 'who' ? (
            <>
              <h2>{entry.winners.map(name).join('、')} 食糊</h2>
              <div className="field">
                <span>邊個出銃？</span>
                <div className="choices">
                  {seats.filter((s) => !entry.winners.includes(s)).map((s) => (
                    <button key={s} type="button" className="choice loser" aria-pressed={entry.loser === s} onClick={() => setEntry({ ...entry, loser: s })}>
                      <span className="ellipsis">{name(s)}</span>
                      {c.state.chains.some((ch) => ch.pulled === s && entry.winners.includes(ch.puller)) && <small>被拉緊</small>}
                    </button>
                  ))}
                  {entry.winners.length === 1 && (
                    <button type="button" className="choice" aria-pressed={entry.loser === null} onClick={() => setEntry({ ...entry, loser: null })}>自摸<small>三家俾</small></button>
                  )}
                </div>
              </div>
              {entry.loser && (
                <div className="field">
                  <span>一炮多響？撳埋另外食糊嘅人</span>
                  <div className="choices">
                    {seats.filter((s) => s !== entry.loser && s !== entry.winners[0]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="choice"
                        aria-pressed={entry.winners.includes(s)}
                        onClick={() => setEntry({ ...entry, winners: entry.winners.includes(s) ? entry.winners.filter((x) => x !== s) : [...entry.winners, s] })}
                      >
                        <span className="ellipsis">{name(s)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" className="btn big" disabled={entry.loser === undefined} onClick={() => setEntry({ ...entry, step: 'fan', current: entry.winners[0] })}>
                下一步：番數
              </button>
            </>
          ) : (
            <>
              <div className="between">
                <h2>{entry.loser === null ? `${name(entry.winners[0])} 自摸` : `${entry.winners.map(name).join('、')} 食 ${name(entry.loser ?? '')}`}</h2>
                <button type="button" className="textbtn" onClick={() => setEntry({ ...entry, step: 'who' })}>改</button>
              </div>
              {entry.winners.length > 1 && (
                <div className="choices">
                  {entry.winners.map((w) => (
                    <button key={w} type="button" className="choice" aria-pressed={entry.current === w} onClick={() => setEntry({ ...entry, current: w })}>
                      <span className="ellipsis">{name(w)}</span><small>{entry.fans[w] ?? 0} 番</small>
                    </button>
                  ))}
                </div>
              )}
              <div className="fan-box">
                <button type="button" className="stepper" aria-label="減一番" onClick={() => setFan(entry.current, (entry.fans[entry.current] ?? 0) - 1)}>−</button>
                <input
                  id="fan"
                  className="fan-value"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={entry.fans[entry.current] ?? 0}
                  onChange={(e) => setFan(entry.current, Number(e.target.value) || 0)}
                  aria-label={`${name(entry.current)} 番數`}
                />
                <button type="button" className="stepper" aria-label="加一番" onClick={() => setFan(entry.current, (entry.fans[entry.current] ?? 0) + 1)}>+</button>
              </div>
              <p className="center-text muted small">{name(entry.current)} 牌型幾多番？底 {rules.base}、莊、雙響會自動加</p>
              <div className="quick">
                {QUICK_FANS.map((n) => (
                  <button key={n} type="button" aria-pressed={(entry.fans[entry.current] ?? 0) === n} onClick={() => setFan(entry.current, n)}>{n}</button>
                ))}
              </div>
              {preview.lines.length > 0 && (
                <div className="preview" aria-live="polite">
                  {preview.lines.filter((l) => l.kind !== 'water').map((l, i) => (
                    <div key={i} className="pv">
                      <span className={`tag ${l.kind}`}>{KIND[l.kind]}</span>
                      <span>{name(l.from)} → {l.to ? name(l.to) : '水'}</span>
                      <span className="num">{l.amount}</span>
                    </div>
                  ))}
                </div>
              )}
              {preview.error && <p className="error">{preview.error}</p>}
              <button type="button" className="btn big" disabled={busy || !draft || !!preview.error} onClick={() => draft && push(draft, '已入數')}>
                入數{draft ? `，共 ${sum(preview.lines)}` : ''}
              </button>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </Sheet>
      )}

      {more && (
        <Sheet onClose={() => setMore(null)} label="其他">
          {more === 'menu' && (
            <>
              <h2>其他</h2>
              <div className="choices">
                <button type="button" className="choice" onClick={() => setMore('falseWin')}>詐糊<small>俾每家 {rules.falseWinPenalty}</small></button>
                <button type="button" className="choice" onClick={() => setMore('special')}>特別事項<small>花、槓、骰</small></button>
                <button type="button" className="choice" onClick={() => setMore('draw')}>流局<small>冇人食</small></button>
                <button type="button" className="choice loser" onClick={() => setMore('end')}>完場<small>全部找數</small></button>
              </div>
            </>
          )}
          {(more === 'falseWin' || more === 'special') && (
            <>
              <h2>{more === 'falseWin' ? '邊個詐糊？' : '特別事項'}</h2>
              {more === 'special' && (
                <label className="field">
                  <span>邊樣嘢（即時找，唔影響拉）</span>
                  <select id="special" value={special} onChange={(e) => setSpecial(Number(e.target.value))}>
                    {SPECIALS.map((s, i) => <option key={s.k} value={i}>{s.k}，{s.dir === 'collect' ? '收' : '俾'}每家 {s.v}</option>)}
                  </select>
                </label>
              )}
              <div className="choices">
                {seats.map((s) => (
                  <button key={s} type="button" className={`choice${more === 'falseWin' ? ' loser' : ''}`} aria-pressed={who === s} onClick={() => setWho(s)}>
                    <span className="ellipsis">{name(s)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn big"
                disabled={busy || !who}
                onClick={() => {
                  if (more === 'falseWin') push({ type: 'falseWin', player: who }, '已入數');
                  else { const s = SPECIALS[special]; push({ type: 'special', player: who, label: s.k, amount: s.v, direction: s.dir }, '已入數'); }
                }}
              >
                入數
              </button>
            </>
          )}
          {more === 'draw' && (
            <>
              <h2>流局</h2>
              <p className="muted">冇人輸贏，拉住嘅數留低。{rules.dealer.drawKeepsDealer ? '莊家冧莊。' : '過莊。'}</p>
              <button type="button" className="btn big" disabled={busy} onClick={() => push({ type: 'draw' }, '已入流局')}>確認流局</button>
            </>
          )}
          {more === 'end' && (
            <>
              <h2>完場</h2>
              <p className="muted">所有拉住嘅數即刻找晒，之後呢張枱唔可以再入數。</p>
              <button type="button" className="btn big danger" disabled={busy} onClick={() => push({ type: 'end' }, '已完場')}>確認完場</button>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </Sheet>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

const tone2 = (n: number) => (n > 0 ? 'gain' : n < 0 ? 'loss' : 'even');
