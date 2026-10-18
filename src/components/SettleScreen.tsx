// 埋數：打牌輸贏換錢，加晚餐等開支、處理水、GP 合計，最後列出最少轉賬
import { useMemo, useState } from 'react';
import { WATER, settleSession } from '../engine/settlement.ts';
import type { Expense } from '../engine/settlement.ts';
import { DEFAULT_SETTLE, isGuest, pairActive } from '../lib/data.ts';
import type { ExpenseDoc, PairDoc, SettleConfig } from '../lib/data.ts';
import { Hint, Sheet, TopBar, message } from '../ui.tsx';

export interface Player {
  id: string;
  name: string;
}

export interface SettleScreenProps {
  title: string;
  back: string;
  players: Player[];
  /** 每人番數（已找 + 枱面） */
  fan: Record<string, number>;
  water: number;
  /** 未完場嘅枱數 */
  unfinished: number;
  config?: SettleConfig;
  expenses: ExpenseDoc[];
  pairs: PairDoc[];
  me: string | null;
  onSaveConfig: (c: SettleConfig) => Promise<void>;
  onAddExpense: (e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>) => Promise<void>;
  onDeleteExpense: (id: string) => Promise<void>;
  onProposePair: (a: string, b: string) => Promise<void>;
  onAcceptPair: (id: string) => Promise<void>;
  onDeletePair: (id: string) => Promise<void>;
}

const LABELS = ['晚餐', '宵夜', '飲品', '的士', '場租', '其他'];
const CURRENCIES = ['CAD', 'HKD', 'USD'];

export function money(n: number, signed = false): string {
  const abs = Math.abs(Math.round(n * 100) / 100);
  const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const sign = n < -0.004 ? '−' : signed && n > 0.004 ? '+' : '';
  return `${sign}$${txt}`;
}

const tone = (n: number) => (n > 0.004 ? 'gain' : n < -0.004 ? 'loss' : 'even');

type SheetKind = null | 'rate' | 'expense' | 'pair';

export default function SettleScreen(p: SettleScreenProps) {
  const cfg = { ...DEFAULT_SETTLE, ...p.config };
  const ids = p.players.map((x) => x.id);
  const nameOf = (id: string) => (id === WATER ? '水' : p.players.find((x) => x.id === id)?.name ?? '玩家');
  const accountName = (key: string) => key.split(' + ').map(nameOf).join(' + ');

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const activePairs = p.pairs.filter(pairActive).map((x) => [x.a, x.b] as [string, string]);
  const expenses: Expense[] = p.expenses.map((e) => ({ label: e.label, payer: e.payer, amount: e.amount, sharedBy: e.sharedBy }));

  const result = useMemo(() => {
    try {
      return { r: settleSession({ fan: p.fan, water: p.water, perUnit: cfg.perUnit, expenses, waterTo: cfg.waterTo, players: ids, pairs: activePairs }), error: '' };
    } catch (err) {
      return { r: null, error: message(err) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fan, p.water, cfg.perUnit, cfg.waterTo, JSON.stringify(expenses), ids.join(','), JSON.stringify(activePairs)]);
  const r = result.r;

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
      setSheet(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function shareText(): string {
    if (!r) return '';
    const lines = [`${p.title} 埋數（${cfg.perUnit} 番 = ${cfg.currency} $1）`];
    for (const t of r.transfers) lines.push(`${accountName(t.from)} → ${accountName(t.to)} ${money(t.amount)}`);
    if (!r.transfers.length) lines.push('不用轉賬');
    return lines.join('\n');
  }

  async function share() {
    const text = shareText();
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 用戶取消 */ }
  }

  const rows = r ? p.players.map((pl) => ({ ...pl, game: r.game[pl.id] ?? 0, expense: r.expense[pl.id] ?? 0, water: r.waterShare[pl.id] ?? 0, net: r.net[pl.id] ?? 0 })).sort((a, b) => b.net - a.net) : [];

  return (
    <main className="page">
      <TopBar back={p.back} title={<div className="stack tight"><h1>埋數</h1><span className="muted small">{p.title}</span></div>} />

      {p.unfinished > 0 && <p className="banner calm small">有 {p.unfinished} 枱未完場，枱面（拉住未找）已計入。</p>}

      <button type="button" className="rate" onClick={() => setSheet('rate')}>
        <span className="rate-fan"><b className="num">{cfg.perUnit}</b> 番</span>
        <span className="rate-eq">=</span>
        <span className="rate-cash"><b className="num">$1</b> {cfg.currency}</span>
        <span className="rate-edit">修改</span>
      </button>

      {result.error && <p className="error">{result.error}</p>}

      {r && (
        <section className="stack">
          <div className="section-head">
            <h2>轉賬</h2>
            <button type="button" className="textbtn" onClick={share}>{copied ? '已複製' : '分享'}</button>
          </div>
          {r.transfers.length ? (
            <ol className="transfers">
              {r.transfers.map((t, i) => (
                <li key={i}>
                  <span className="tf-from ellipsis">{accountName(t.from)}</span>
                  <span className="tf-arrow" aria-label="付給">
                    <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true"><path d="M1 6h24M20 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <span className="tf-to ellipsis">{accountName(t.to)}</span>
                  <b className="num tf-amt">{money(t.amount)}</b>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">不用轉賬。</p>
          )}
          <Hint>已用最少轉賬次數計算。</Hint>
        </section>
      )}

      {r && (
        <section className="stack">
          <h2>每人明細</h2>
          <div className="ledger settle-table">
            <div className="st-row st-head">
              <span>玩家</span><span>打牌</span><span>開支</span><span>水</span><span>合計</span>
            </div>
            {rows.map((row) => (
              <div key={row.id} className={`st-row${row.id === p.me ? ' me' : ''}`}>
                <span className="ellipsis">{row.name}</span>
                <span className={`num ${tone(row.game)}`}>{money(row.game, true)}</span>
                <span className={`num ${tone(row.expense)}`}>{Math.abs(row.expense) > 0.004 ? money(row.expense, true) : '·'}</span>
                <span className={`num ${tone(row.water)}`}>{Math.abs(row.water) > 0.004 ? money(row.water, true) : '·'}</span>
                <b className={`num ${tone(row.net)}`}>{money(row.net, true)}</b>
              </div>
            ))}
          </div>
          <Hint>開支：自己付了的錢為正，要分擔的為負。</Hint>
        </section>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>開支</h2>
          <button type="button" className="textbtn" onClick={() => { setError(''); setSheet('expense'); }}>＋ 新增</button>
        </div>
        {p.expenses.length ? (
          <ul className="list exp-list">
            {p.expenses.map((e) => (
              <li key={e.id} className="exp-row">
                <span className="exp-tag">{e.kind === 'transfer' ? '轉' : e.label.slice(0, 1)}</span>
                <span className="grow exp-text">
                  <span>{e.kind === 'transfer' ? `${nameOf(e.payer)} 已付 ${nameOf(e.sharedBy[0] ?? '')}` : e.label}</span>
                  <small className="muted">
                    {e.kind === 'transfer'
                      ? '已轉賬'
                      : `${nameOf(e.payer)} 付款 · ${e.sharedBy[0] === WATER ? '由水支付' : e.sharedBy.length === ids.length ? '全部人分' : `${e.sharedBy.length} 人分`}`}
                  </small>
                </span>
                <b className="num">{money(e.amount)}</b>
                <button type="button" className="iconbtn small" aria-label={`刪除 ${e.label}`} disabled={busy} onClick={() => run(() => p.onDeleteExpense(e.id))}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">未有開支。晚餐、的士、場租等可在此分。</p>
        )}
      </section>

      {r && p.water > 0 && (
        <section className="panel">
          <div className="between">
            <h3>水</h3>
            <span className="muted small">抽 {p.water} 番 = {money(r.water.collected)}</span>
          </div>
          <div className="water-bar">
            <span>已用 <b className="num">{money(r.water.spent)}</b></span>
            <span>{r.water.left >= 0 ? '剩' : '不足'} <b className={`num ${r.water.left < 0 ? 'loss' : ''}`}>{money(Math.abs(r.water.left))}</b></span>
          </div>
          <div className="row">
            <span className="grow small muted">{r.water.left >= 0 ? '剩水給' : '不足由'}</span>
            <select
              className="input small-select"
              value={cfg.waterTo}
              aria-label="剩水分配"
              onChange={(e) => run(() => p.onSaveConfig({ ...cfg, waterTo: e.target.value }))}
            >
              <option value="split">全部人平分</option>
              {p.players.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          </div>
        </section>
      )}

      <section className="stack">
        <div className="section-head">
          <h2>GP 合計</h2>
          <button type="button" className="textbtn" onClick={() => { setError(''); setSheet('pair'); }}>＋ 新增</button>
        </div>
        {p.pairs.length ? (
          <ul className="list exp-list">
            {p.pairs.map((pr) => {
              const active = pairActive(pr);
              const waiting = [pr.a, pr.b].filter((id) => !isGuest(id) && !pr.accepted.includes(id));
              return (
                <li key={pr.id} className="exp-row">
                  <span className="grow exp-text">
                    <span>{nameOf(pr.a)} + {nameOf(pr.b)}</span>
                    <small className={active ? 'gain' : 'muted'}>{active ? '已生效' : `等待 ${waiting.map(nameOf).join('、')} 同意`}</small>
                  </span>
                  {p.me && waiting.includes(p.me) && <button type="button" className="btn" disabled={busy} onClick={() => run(() => p.onAcceptPair(pr.id))}>同意</button>}
                  <button type="button" className="iconbtn small" aria-label="取消 GP" disabled={busy} onClick={() => run(() => p.onDeletePair(pr.id))}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Hint className="muted">兩人一齊計數，只轉一次賬。雙方同意後生效。</Hint>
        )}
      </section>

      {error && !sheet && <p className="error" role="alert">{error}</p>}

      {sheet === 'rate' && <RateSheet cfg={cfg} busy={busy} error={error} onClose={() => setSheet(null)} onSave={(c) => run(() => p.onSaveConfig(c))} />}
      {sheet === 'expense' && <ExpenseSheet players={p.players} me={p.me} hasWater={p.water > 0} busy={busy} error={error} onClose={() => setSheet(null)} onSave={(e) => run(() => p.onAddExpense(e))} />}
      {sheet === 'pair' && (
        <PairSheet
          players={p.players.filter((pl) => !p.pairs.some((pr) => pr.a === pl.id || pr.b === pl.id))}
          busy={busy}
          error={error}
          onClose={() => setSheet(null)}
          onSave={(a, b) => run(() => p.onProposePair(a, b))}
        />
      )}
    </main>
  );
}

function RateSheet({ cfg, busy, error, onClose, onSave }: { cfg: SettleConfig; busy: boolean; error: string; onClose: () => void; onSave: (c: SettleConfig) => void }) {
  const [per, setPer] = useState(String(cfg.perUnit));
  const [cur, setCur] = useState(cfg.currency);
  const n = Number(per);
  return (
    <Sheet onClose={onClose} label="匯率">
      <h2>匯率</h2>
      <div className="rate-edit-row">
        <input className="input num big-input" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} aria-label="幾多番" />
        <span>番 = $1</span>
      </div>
      <div className="seg" role="group" aria-label="貨幣">
        {CURRENCIES.map((c) => <button key={c} type="button" aria-pressed={cur === c} onClick={() => setCur(c)}>{c}</button>)}
        <input className="seg-input" value={CURRENCIES.includes(cur) ? '' : cur} placeholder="其他" maxLength={6} onChange={(e) => setCur(e.target.value.toUpperCase())} aria-label="其他貨幣" />
      </div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy || !(n > 0) || !cur.trim()} onClick={() => onSave({ ...cfg, perUnit: n, currency: cur.trim() })}>儲存</button>
    </Sheet>
  );
}

function ExpenseSheet({ players, me, hasWater, busy, error, onClose, onSave }: {
  players: Player[]; me: string | null; hasWater: boolean; busy: boolean; error: string; onClose: () => void;
  onSave: (e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>) => void;
}) {
  const [kind, setKind] = useState<'expense' | 'transfer'>('expense');
  const [label, setLabel] = useState('晚餐');
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState(me && players.some((x) => x.id === me) ? me : '');
  const [shared, setShared] = useState<string[]>(players.map((x) => x.id));
  const [byWater, setByWater] = useState(false);
  const [to, setTo] = useState('');
  const n = Number(amount);
  const finalLabel = label === '其他' ? custom.trim() || '其他' : label;
  const each = shared.length ? n / shared.length : 0;
  const ok = n > 0 && payer && (kind === 'transfer' ? to && to !== payer : byWater || shared.length > 0);

  return (
    <Sheet onClose={onClose} label="新增開支">
      <div className="seg wide" role="group" aria-label="類別">
        <button type="button" aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>開支</button>
        <button type="button" aria-pressed={kind === 'transfer'} onClick={() => setKind('transfer')}>已轉賬</button>
      </div>

      {kind === 'expense' && (
        <div className="field">
          <span>項目</span>
          <div className="chips-row">
            {LABELS.map((l) => <button key={l} type="button" className="pill" aria-pressed={label === l} onClick={() => setLabel(l)}>{l}</button>)}
          </div>
          {label === '其他' && <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="項目名稱" maxLength={20} aria-label="項目名稱" />}
        </div>
      )}

      <div className="field">
        <span>金額</span>
        <div className="money-input">
          <span>$</span>
          <input className="input num big-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" aria-label="金額" />
        </div>
      </div>

      <div className="field">
        <span>{kind === 'transfer' ? '誰付' : '誰付款'}</span>
        <div className="choices">
          {players.map((pl) => (
            <button key={pl.id} type="button" className="choice" aria-pressed={payer === pl.id} onClick={() => setPayer(pl.id)}>
              <span className="ellipsis">{pl.name}</span>
            </button>
          ))}
        </div>
      </div>

      {kind === 'transfer' ? (
        <div className="field">
          <span>付給誰</span>
          <div className="choices">
            {players.filter((pl) => pl.id !== payer).map((pl) => (
              <button key={pl.id} type="button" className="choice" aria-pressed={to === pl.id} onClick={() => setTo(pl.id)}>
                <span className="ellipsis">{pl.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="field">
          <div className="between">
            <span>誰分</span>
            {hasWater && (
              <label className="row small">
                <span className="muted">由水支付</span>
                <button type="button" role="switch" className="switch" aria-checked={byWater} aria-label="由水支付" onClick={() => setByWater((v) => !v)} />
              </label>
            )}
          </div>
          {!byWater && (
            <>
              <div className="choices">
                {players.map((pl) => {
                  const on = shared.includes(pl.id);
                  return (
                    <button key={pl.id} type="button" className="choice" aria-pressed={on} onClick={() => setShared((s) => (on ? s.filter((x) => x !== pl.id) : [...s, pl.id]))}>
                      <span className="ellipsis">{pl.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="between small">
                <button type="button" className="textbtn" onClick={() => setShared(shared.length === players.length ? [] : players.map((x) => x.id))}>{shared.length === players.length ? '全部取消' : '全選'}</button>
                {n > 0 && shared.length > 0 && <span className="muted">每人約 {money(each)}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <button
        type="button"
        className="btn big"
        disabled={busy || !ok}
        onClick={() => onSave(kind === 'transfer'
          ? { kind, label: '已轉賬', payer, amount: n, sharedBy: [to] }
          : { kind, label: finalLabel, payer, amount: n, sharedBy: byWater ? [WATER] : shared })}
      >
        {ok ? `新增 ${money(n)}` : '新增'}
      </button>
    </Sheet>
  );
}

function PairSheet({ players, busy, error, onClose, onSave }: { players: Player[]; busy: boolean; error: string; onClose: () => void; onSave: (a: string, b: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <Sheet onClose={onClose} label="新增 GP">
      <h2>新增 GP</h2>
      <Hint>選兩位玩家。有帳戶的玩家需要按「同意」才生效。</Hint>
      <div className="choices">
        {players.map((pl) => {
          const on = picked.includes(pl.id);
          return (
            <button key={pl.id} type="button" className="choice" aria-pressed={on} onClick={() => setPicked((s) => (on ? s.filter((x) => x !== pl.id) : s.length < 2 ? [...s, pl.id] : s))}>
              <span className="ellipsis">{pl.name}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy || picked.length !== 2} onClick={() => onSave(picked[0], picked[1])}>新增</button>
    </Sheet>
  );
}
