// 埋數：麻雀數（連水）同晚餐等開支分開計，亦可以合併；GP 合計；最少轉賬
import { useMemo, useState } from 'react';
import { settleSession } from '../engine/settlement.ts';
import type { MoneyRounding } from '../engine/settlement.ts';
import type { Expense } from '../engine/settlement.ts';
import { isGuest, pairActive } from '../lib/data.ts';
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
  /** 每人番數（已找 + 枱面，已扣水） */
  fan: Record<string, number>;
  water: number;
  /** 未完場嘅枱數 */
  unfinished: number;
  config: SettleConfig;
  /** 局主先改到設定 */
  canEdit: boolean;
  /** 可以收水嘅人（成員 + 今晚玩家） */
  accounts: Player[];
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
const ROUND_LABEL: Record<MoneyRounding, string> = { up: '每人金額向上取整', round: '每人金額四捨五入', none: '' };

export function money(n: number, signed = false): string {
  const abs = Math.abs(Math.round(n * 100) / 100);
  const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const sign = n < -0.004 ? '−' : signed && n > 0.004 ? '+' : '';
  return `${sign}$${txt}`;
}

const tone = (n: number) => (n > 0.004 ? 'gain' : n < -0.004 ? 'loss' : 'even');
const fanTxt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

type SheetKind = null | 'config' | 'expense' | 'pair';
type View = 'game' | 'expense' | 'combined';

export default function SettleScreen(p: SettleScreenProps) {
  const cfg = p.config;
  const ids = p.players.map((x) => x.id);
  const nameOf = (id: string) => p.players.find((x) => x.id === id)?.name ?? p.accounts.find((x) => x.id === id)?.name ?? '玩家';
  const accountName = (key: string) => key.split(' + ').map(nameOf).join(' + ');

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [view, setView] = useState<View>('game');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const activePairs = p.pairs.filter(pairActive).map((x) => [x.a, x.b] as [string, string]);
  const expenses: Expense[] = p.expenses.map((e) => ({ label: e.label, payer: e.payer, amount: e.amount, sharedBy: e.sharedBy }));

  const result = useMemo(() => {
    try {
      return {
        r: settleSession({
          fan: p.fan, water: p.water, waterTo: cfg.waterTo, perUnit: cfg.perUnit, rounding: cfg.rounding,
          expenses, players: ids, pairs: activePairs,
        }),
        error: '',
      };
    } catch (err) {
      return { r: null, error: message(err) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fan, p.water, cfg.perUnit, cfg.waterTo, cfg.rounding, JSON.stringify(expenses), ids.join(','), JSON.stringify(activePairs)]);
  const r = result.r;
  const led = r ? (view === 'game' ? r.gameLedger : view === 'expense' ? r.expenseLedger : r.combined) : null;

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
    const out = [`${p.title} 埋數（${cfg.perUnit} 番 = ${cfg.currency} $1${ROUND_LABEL[cfg.rounding] ? `，${ROUND_LABEL[cfg.rounding]}` : ''}）`];
    const block = (title: string, ts: { from: string; to: string; amount: number }[]) => {
      out.push('', `【${title}】`);
      if (!ts.length) out.push('不用轉賬');
      for (const t of ts) out.push(`${accountName(t.from)} → ${accountName(t.to)} ${money(t.amount)}`);
    };
    block('麻雀（連水）', r.gameLedger.transfers);
    if (p.expenses.length) block('開支', r.expenseLedger.transfers);
    out.push('', `水：${p.water} 番，${money(r.water.total)} 由 ${nameOf(r.water.to)} 保管`);
    return out.join('\n');
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

  const gameRows = r ? p.players.map((pl) => ({ ...pl, fan: p.fan[pl.id] ?? 0, cash: r.game[pl.id] ?? 0 })).sort((a, b) => b.fan - a.fan) : [];

  return (
    <main className="page">
      <TopBar back={p.back} title={<div className="stack tight"><h1>埋數</h1><span className="muted small">{p.title}</span></div>} />

      {p.unfinished > 0 && <p className="banner calm small">有 {p.unfinished} 枱未完場，枱面（拉住未找）已計入。</p>}

      <button type="button" className="rate" onClick={() => setSheet('config')}>
        <span className="rate-fan"><b className="num">{cfg.perUnit}</b> 番</span>
        <span className="rate-eq">=</span>
        <span className="rate-cash"><b className="num">$1</b> {cfg.currency}</span>
        <span className="rate-edit">{p.canEdit ? '設定' : '查看'}</span>
      </button>
      <p className="rate-note muted small">{ROUND_LABEL[cfg.rounding] || '計到仙'} · 水由 {nameOf(cfg.waterTo)} 保管</p>

      {result.error && <p className="error">{result.error}</p>}

      {r && led && (
        <section className="stack">
          <div className="section-head">
            <h2>轉賬</h2>
            <button type="button" className="textbtn" onClick={share}>{copied ? '已複製' : '分享'}</button>
          </div>
          <div className="seg wide" role="group" aria-label="轉賬類別">
            <button type="button" aria-pressed={view === 'game'} onClick={() => setView('game')}>麻雀＋水</button>
            <button type="button" aria-pressed={view === 'expense'} onClick={() => setView('expense')}>開支</button>
            <button type="button" aria-pressed={view === 'combined'} onClick={() => setView('combined')}>合併</button>
          </div>
          {led.transfers.length ? (
            <ol className="transfers">
              {led.transfers.map((t, i) => (
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
            <p className="muted">{view === 'expense' && !p.expenses.length ? '未有開支。' : '不用轉賬。'}</p>
          )}
          <Hint>{view === 'combined' ? '麻雀、水同開支一次過轉，次數最少。' : '已用最少轉賬次數計算。'}</Hint>
        </section>
      )}

      {r && (
        <section className="stack">
          <h2>麻雀</h2>
          <div className="ledger settle-table">
            <div className="st-row st-head three"><span>玩家</span><span>番</span><span>金額</span></div>
            {gameRows.map((row) => (
              <div key={row.id} className={`st-row three${row.id === p.me ? ' me' : ''}`}>
                <span className="ellipsis">{row.name}</span>
                <span className={`num ${tone(row.fan)}`}>{fanTxt(row.fan)}</span>
                <b className={`num ${tone(row.cash)}`}>{money(row.cash, true)}</b>
              </div>
            ))}
            <div className="st-row three st-water">
              <span className="ellipsis">水（{nameOf(r.water.to)} 保管）</span>
              <span className="num">{p.water}</span>
              <b className="num">{money(r.water.total, true)}</b>
            </div>
          </div>
          {cfg.rounding !== 'none' && Math.abs(r.water.rounding) > 0.004 && (
            <Hint>水 {money(r.water.raw)}，取整差額 {money(r.water.rounding, true)}，合共 {money(r.water.total)}。</Hint>
          )}
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
                    {e.kind === 'transfer' ? '已轉賬' : `${nameOf(e.payer)} 付款 · ${e.sharedBy.length === ids.length ? '全部人分' : `${e.sharedBy.length} 人分`}`}
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
          <p className="muted">未有開支。晚餐、的士、場租等在此分，與麻雀數分開。</p>
        )}
        {r && p.expenses.length > 0 && (
          <div className="exp-net">
            {p.players.filter((pl) => Math.abs(r.expense[pl.id] ?? 0) > 0.004).map((pl) => (
              <span key={pl.id}>{pl.name} <b className={`num ${tone(r.expense[pl.id])}`}>{money(r.expense[pl.id], true)}</b></span>
            ))}
          </div>
        )}
      </section>

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

      {sheet === 'config' && <ConfigSheet cfg={cfg} canEdit={p.canEdit} accounts={p.accounts} busy={busy} error={error} onClose={() => setSheet(null)} onSave={(c) => run(() => p.onSaveConfig(c))} />}
      {sheet === 'expense' && <ExpenseSheet players={p.players} me={p.me} busy={busy} error={error} onClose={() => setSheet(null)} onSave={(e) => run(() => p.onAddExpense(e))} />}
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

function ConfigSheet({ cfg, canEdit, accounts, busy, error, onClose, onSave }: {
  cfg: SettleConfig; canEdit: boolean; accounts: Player[]; busy: boolean; error: string; onClose: () => void; onSave: (c: SettleConfig) => void;
}) {
  const [per, setPer] = useState(String(cfg.perUnit));
  const [cur, setCur] = useState(cfg.currency);
  const [waterTo, setWaterTo] = useState(cfg.waterTo);
  const [rounding, setRounding] = useState<MoneyRounding>(cfg.rounding);
  const n = Number(per);
  const d = !canEdit;
  return (
    <Sheet onClose={onClose} label="埋數設定">
      <h2>埋數設定</h2>
      {!canEdit && <p className="muted small">只有局主可修改。</p>}
      <div className="field">
        <span>匯率</span>
        <div className="rate-edit-row">
          <input className="input num big-input" inputMode="decimal" value={per} disabled={d} onChange={(e) => setPer(e.target.value)} aria-label="幾多番" />
          <span>番 = $1</span>
        </div>
      </div>
      <div className="field">
        <span>貨幣</span>
        <div className="seg" role="group" aria-label="貨幣">
          {CURRENCIES.map((c) => <button key={c} type="button" disabled={d} aria-pressed={cur === c} onClick={() => setCur(c)}>{c}</button>)}
          <input className="seg-input" value={CURRENCIES.includes(cur) ? '' : cur} disabled={d} placeholder="其他" maxLength={6} onChange={(e) => setCur(e.target.value.toUpperCase())} aria-label="其他貨幣" />
        </div>
      </div>
      <div className="field">
        <span>水由誰保管</span>
        <select className="input" value={waterTo} disabled={d} onChange={(e) => setWaterTo(e.target.value)} aria-label="水由誰保管">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="field">
        <span>金額取整（差額計入水）</span>
        <div className="seg wide" role="group" aria-label="金額取整">
          {(['up', 'round', 'none'] as const).map((k) => (
            <button key={k} type="button" disabled={d} aria-pressed={rounding === k} onClick={() => setRounding(k)}>{k === 'up' ? '向上' : k === 'round' ? '四捨五入' : '不變'}</button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {canEdit && <button type="button" className="btn big" disabled={busy || !(n > 0) || !cur.trim()} onClick={() => onSave({ perUnit: n, currency: cur.trim(), waterTo, rounding })}>儲存</button>}
    </Sheet>
  );
}

function ExpenseSheet({ players, me, busy, error, onClose, onSave }: {
  players: Player[]; me: string | null; busy: boolean; error: string; onClose: () => void;
  onSave: (e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>) => void;
}) {
  const [kind, setKind] = useState<'expense' | 'transfer'>('expense');
  const [label, setLabel] = useState('晚餐');
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState(me && players.some((x) => x.id === me) ? me : '');
  const [shared, setShared] = useState<string[]>(players.map((x) => x.id));
  const [to, setTo] = useState('');
  const n = Number(amount);
  const finalLabel = label === '其他' ? custom.trim() || '其他' : label;
  const each = shared.length ? n / shared.length : 0;
  const ok = n > 0 && payer && (kind === 'transfer' ? to && to !== payer : shared.length > 0);

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
          <span>誰分</span>
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
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <button
        type="button"
        className="btn big"
        disabled={busy || !ok}
        onClick={() => onSave(kind === 'transfer'
          ? { kind, label: '已轉賬', payer, amount: n, sharedBy: [to] }
          : { kind, label: finalLabel, payer, amount: n, sharedBy: shared })}
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
