// 埋數：麻雀數（連水）同晚餐等開支分開計，亦可以合併；Group 一齊計；最少轉賬
import { useMemo, useState } from 'react';
import { effectiveGroups, settleSession } from '../engine/settlement.ts';
import type { MoneyRounding } from '../engine/settlement.ts';
import type { Expense } from '../engine/settlement.ts';
import { isGuest, pairActive, teamActive } from '../lib/data.ts';
import type { ExpenseDoc, PairDoc, SettleConfig, TeamDoc } from '../lib/data.ts';
import { Hint, NumInput, Sheet, TopBar, message } from '../ui.tsx';
import { go } from '../lib/router.tsx';

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
  /** 牌友圈嘅預設 Group（每次自動一齊計） */
  teams?: TeamDoc[];
  /** 管理預設 Group 嘅頁 */
  teamsHref?: string;
  me: string | null;
  onSaveConfig: (c: SettleConfig) => Promise<void>;
  /** 埋數設定喺家規頁 */
  settingsHref?: string;
  /** 水由誰保管：場主（或局主）改得，只可以揀局入面嘅人 */
  canSetWater?: boolean;
  waterOptions?: Player[];
  onSetWaterTo?: (uid: string) => Promise<void>;
  /** 埋數（完場並鎖定） */
  closing?: {
    closed: { by: string; at: number } | null;
    request: { by: string; approvals: string[] } | null;
    /** 要同意嘅人（有帳戶嘅玩家） */
    needed: string[];
    isHost: boolean;
    onClose: () => Promise<void>;
    onRequest: () => Promise<void>;
    onApprove: () => Promise<void>;
    onCancel: () => Promise<void>;
  };
  onAddExpense: (e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>) => Promise<void>;
  onDeleteExpense: (id: string) => Promise<void>;
  onProposePair: (a: string, b: string) => Promise<void>;
  onAcceptPair: (id: string) => Promise<void>;
  onDeletePair: (id: string) => Promise<void>;
}

const LABELS = ['晚餐', '宵夜', '飲品', '的士', '場租', '其他'];
const CURRENCIES = ['CAD', 'HKD', 'USD'];
const ROUND_LABEL: Record<MoneyRounding, string> = { up: '每人金額向上取整', round: '每人金額四捨五入', none: '' };

/** 金額輸入：淨係數字同一個小數點，最多兩位小數，唔會有「01」 */
function cleanMoney(raw: string): string {
  let t = raw.replace(/[^0-9.]/g, '');
  const i = t.indexOf('.');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 2);
  return t.replace(/^0+(?=\d)/, '');
}

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

  const defaults = (p.teams ?? []).filter(teamActive).map((t) => t.members);
  // 今晚有份嘅人（連保管水嗰個）；冇嚟嘅人自動唔計，得返一個人就分開計
  const present = [...ids, cfg.waterTo];
  const activePairs = effectiveGroups(defaults, p.pairs.filter(pairActive).map((x) => [x.a, x.b]), present);
  const tonightDefaults = (p.teams ?? []).filter(teamActive).map((t) => ({ t, here: t.members.filter((m) => ids.includes(m)) })).filter((x) => x.here.length > 0);
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
  // Group 合埋做一格：先合埋番數再取整；成員顯示各自份數（未取整）
  type Block = { key: string; name: string; fan: number; cash: number; members?: typeof gameRows };
  const gameBlocks: Block[] = [];
  if (r) {
    const done = new Set<string>();
    for (const row of gameRows) {
      if (done.has(row.id)) continue;
      const grp = activePairs.find((g) => g.includes(row.id));
      if (!grp) { gameBlocks.push({ key: row.id, name: row.name, fan: row.fan, cash: row.cash }); continue; }
      const members = gameRows.filter((x) => grp.includes(x.id));
      members.forEach((x) => done.add(x.id));
      const key = grp.join(' + ');
      gameBlocks.push({ key, name: accountName(key), fan: members.reduce((a, x) => a + x.fan, 0), cash: r.gameAccounts[key] ?? 0, members });
    }
  }

  return (
    <main className="page">
      <TopBar back={p.back} title={<div className="stack tight"><h1>埋數</h1><span className="muted small">{p.title}</span></div>} />

      {p.unfinished > 0 && <p className="banner calm small">有 {p.unfinished} 枱未完場，枱面（拉住未找）已計入。</p>}

      <button type="button" className="rate" onClick={() => (p.settingsHref ? go(p.settingsHref) : setSheet('config'))}>
        <span className="rate-fan"><b className="num">{cfg.perUnit}</b> 番</span>
        <span className="rate-eq">=</span>
        <span className="rate-cash"><b className="num">$1</b> {cfg.currency}</span>
        <span className="rate-edit">{p.canEdit ? '在家規修改' : '家規'}</span>
      </button>
      <div className="rate-note muted small">
        {ROUND_LABEL[cfg.rounding] && <span>{ROUND_LABEL[cfg.rounding]} · </span>}
        <span>水由</span>
        {p.canSetWater && p.onSetWaterTo && p.waterOptions?.length ? (
          <select className="inline-select" value={cfg.waterTo} aria-label="水由誰保管" onChange={(e) => run(() => p.onSetWaterTo!(e.target.value))}>
            {p.waterOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : <b> {nameOf(cfg.waterTo)} </b>}
        <span>保管</span>
      </div>

      {p.closing && <CloseBar c={p.closing} me={p.me} nameOf={nameOf} busy={busy} run={run} />}

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
            {gameBlocks.map((b) => b.members ? (
              <div key={b.key} className="st-group">
                <div className="st-row three st-group-head">
                  <span className="ellipsis">{b.name}</span>
                  <span className={`num ${tone(b.fan)}`}>{fanTxt(b.fan)}</span>
                  <b className={`num ${tone(b.cash)}`}>{money(b.cash, true)}</b>
                </div>
                {b.members.map((row) => (
                  <div key={row.id} className={`st-row three st-member${row.id === p.me ? ' me' : ''}`}>
                    <span className="ellipsis">{row.name}</span>
                    <span className={`num ${tone(row.fan)}`}>{fanTxt(row.fan)}</span>
                    <span className="num muted">{money(row.cash, true)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div key={b.key} className={`st-row three${b.key === p.me ? ' me' : ''}`}>
                <span className="ellipsis">{b.name}</span>
                <span className={`num ${tone(b.fan)}`}>{fanTxt(b.fan)}</span>
                <b className={`num ${tone(b.cash)}`}>{money(b.cash, true)}</b>
              </div>
            ))}
            <div className="st-row three st-water">
              <span className="ellipsis">水（{nameOf(r.water.to)} 保管）</span>
              <span className="num">{p.water}</span>
              <b className="num">{money(r.water.total, true)}</b>
            </div>
          </div>
          {activePairs.length > 0 && <Hint>Group 先合埋番數，再用一個戶口取整。成員下面嘅灰色金額係各自份數，只供參考。</Hint>}
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
          <h2>Group 一齊計</h2>
          <button type="button" className="textbtn" onClick={() => { setError(''); setSheet('pair'); }}>＋ 今晚加</button>
        </div>
        {tonightDefaults.length > 0 || p.pairs.length > 0 ? (
          <ul className="list exp-list">
            {tonightDefaults.map(({ t, here }) => (
              <li key={t.id} className="exp-row">
                <span className="grow exp-text">
                  <span>{t.members.map(nameOf).join(' + ')}<span className="tag instant">預設</span></span>
                  <small className={here.length > 1 ? 'gain' : 'muted'}>
                    {here.length > 1
                      ? (here.length < t.members.length ? `今晚 ${here.map(nameOf).join('、')} 一齊計（${t.members.filter((m) => !here.includes(m)).map(nameOf).join('、')} 冇嚟）` : '一齊計')
                      : `今晚只有 ${nameOf(here[0])}，分開計`}
                  </small>
                </span>
              </li>
            ))}
            {p.pairs.map((pr) => {
              const active = pairActive(pr);
              const waiting = [pr.a, pr.b].filter((id) => !isGuest(id) && !pr.accepted.includes(id));
              const clash = active && !activePairs.some((g) => g.includes(pr.a) && g.includes(pr.b));
              return (
                <li key={pr.id} className="exp-row">
                  <span className="grow exp-text">
                    <span>{nameOf(pr.a)} + {nameOf(pr.b)}</span>
                    <small className={active && !clash ? 'gain' : 'muted'}>{!active ? `等待 ${waiting.map(nameOf).join('、')} 同意` : clash ? '已在預設 Group，不重複計' : '今晚一齊計'}</small>
                  </span>
                  {p.me && waiting.includes(p.me) && <button type="button" className="btn" disabled={busy} onClick={() => run(() => p.onAcceptPair(pr.id))}>同意</button>}
                  <button type="button" className="iconbtn small" aria-label="取消此 Group" disabled={busy} onClick={() => run(() => p.onDeletePair(pr.id))}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Hint className="muted">幾個人一齊計數，只轉一次賬。</Hint>
        )}
        {p.teamsHref && <button type="button" className="textbtn" onClick={() => go(p.teamsHref!)}>設定預設 Group（每次自動一齊計）</button>}
      </section>

      {error && !sheet && <p className="error" role="alert">{error}</p>}

      {sheet === 'config' && <ConfigSheet cfg={cfg} canEdit={p.canEdit} accounts={p.accounts} busy={busy} error={error} onClose={() => setSheet(null)} onSave={(c) => run(() => p.onSaveConfig(c))} />}
      {sheet === 'expense' && <ExpenseSheet players={p.players} me={p.me} busy={busy} error={error} onClose={() => setSheet(null)} onSave={(e) => run(() => p.onAddExpense(e))} />}
      {sheet === 'pair' && (
        <PairSheet
          players={p.players.filter((pl) => !p.pairs.some((pr) => pr.a === pl.id || pr.b === pl.id) && !activePairs.some((g) => g.includes(pl.id)))}
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
  return (
    <Sheet onClose={onClose} label="埋數設定">
      <h2>埋數設定</h2>
      <SettleConfigForm cfg={cfg} canEdit={canEdit} accounts={accounts} busy={busy} error={error} onSave={onSave} />
    </Sheet>
  );
}

/** 埋數設定表格：埋數頁同家規頁共用 */
export function SettleConfigForm({ cfg, canEdit, accounts, busy, error, onSave }: {
  cfg: SettleConfig; canEdit: boolean; accounts: Player[]; busy: boolean; error: string; onSave: (c: SettleConfig) => void;
}) {
  const [per, setPer] = useState(cfg.perUnit);
  const [cur, setCur] = useState(cfg.currency);
  const waterTo = cfg.waterTo;
  void accounts;
  const [rounding, setRounding] = useState<MoneyRounding>(cfg.rounding);
  const n = per;
  const d = !canEdit;
  return (
    <div className="stack">
      {!canEdit && <p className="muted small">只有局主可修改。</p>}
      <div className="field">
        <span>匯率</span>
        <div className="rate-edit-row">
          <NumInput className="input num" big decimal value={per} min={0.01} max={10000} fallback={cfg.perUnit || 6} disabled={d} onChange={setPer} label="幾多番" />
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
        <span>金額取整（差額計入水）</span>
        <div className="seg wide" role="group" aria-label="金額取整">
          {(['up', 'round', 'none'] as const).map((k) => (
            <button key={k} type="button" disabled={d} aria-pressed={rounding === k} onClick={() => setRounding(k)}>{k === 'up' ? '向上' : k === 'round' ? '四捨五入' : '不變'}</button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {canEdit && <button type="button" className="btn big" disabled={busy || !(n > 0) || !cur.trim()} onClick={() => onSave({ perUnit: n, currency: cur.trim(), waterTo, rounding })}>儲存埋數設定</button>}
    </div>
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
          <input className="input num big-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanMoney(e.target.value))} placeholder="0" aria-label="金額" />
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
    <Sheet onClose={onClose} label="今晚加 Group">
      <h2>今晚加 Group</h2>
      <Hint>只計今晚。選兩位玩家，有帳戶的玩家需要按「同意」才生效。想每次都一齊計，可以設定預設 Group。</Hint>
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

function CloseBar({ c, me, nameOf, busy, run }: {
  c: NonNullable<SettleScreenProps['closing']>; me: string | null; nameOf: (id: string) => string; busy: boolean; run: (t: () => Promise<void>) => Promise<void>;
}) {
  const [ask, setAsk] = useState(false);
  if (c.closed) {
    return (
      <div className="closed-stamp">
        <span className="stamp">已埋數</span>
        <span className="muted small">{nameOf(c.closed.by)} · {new Date(c.closed.at).toLocaleString('zh-HK', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    );
  }
  if (c.request) {
    const got = c.needed.filter((id) => c.request!.approvals.includes(id));
    const waiting = c.needed.filter((id) => !c.request!.approvals.includes(id));
    const mine = !!me && waiting.includes(me);
    return (
      <div className="banner calm close-req">
        <span className="grow">{nameOf(c.request.by)} 申請埋數：已同意 {got.length}/{c.needed.length}{waiting.length ? `，等 ${waiting.map(nameOf).join('、')}` : ''}</span>
        {mine && <button type="button" className="btn" disabled={busy} onClick={() => run(c.onApprove)}>同意</button>}
        {c.isHost && <button type="button" className="btn danger" disabled={busy} onClick={() => run(c.onClose)}>直接埋數</button>}
        {(c.isHost || me === c.request.by) && <button type="button" className="textbtn" disabled={busy} onClick={() => run(c.onCancel)}>取消</button>}
      </div>
    );
  }
  return (
    <>
      <button type="button" className="btn big close-btn" disabled={busy} onClick={() => (c.isHost ? setAsk(true) : run(c.onRequest))}>
        埋數{c.isHost ? '（完場並鎖定）' : '（要全部人同意）'}
      </button>
      {ask && (
        <Sheet onClose={() => setAsk(false)} label="埋數">
          <h2>埋數</h2>
          <p className="muted">所有未完場嘅枱會即刻完場，拉住嘅數會找晒，之後唔可以再入數。</p>
          <button type="button" className="btn big danger" disabled={busy} onClick={() => run(async () => { await c.onClose(); setAsk(false); })}>確認埋數</button>
          <button type="button" className="btn plain" onClick={() => setAsk(false)}>取消</button>
        </Sheet>
      )}
    </>
  );
}
