// 轉賬列表：邊個俾邊個、幾多、已轉未轉；撳人睇佢嘅收款資料（轉數快、Interac、PayMe…）
import { useState } from 'react';
import type { PayItem } from '../lib/pay.ts';
import { Sheet } from '../ui.tsx';
import { Link } from '../lib/router.tsx';
import { money } from './SettleScreen.tsx';
import { PayMethodCard } from './PayMethods.tsx';
import { methodsOf, payLine } from '../lib/payMethods.ts';
import type { PayMethod } from '../lib/payMethods.ts';

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

export interface PayPeople {
  me: string | null;
  names: Record<string, string>;
  emails: Record<string, string>;
  /** 每人顯示咗嘅收款方法 */
  pays?: Record<string, PayMethod[]>;
}

function nameOfKey(key: string, pp: PayPeople): string {
  return key.split(' + ').map((id) => (id === pp.me ? '你' : pp.names[id] ?? '玩家')).join(' + ');
}

/** 撳人：Interac email、複製 */
export function PersonSheet({ ids, pp, amount, onClose }: { ids: string[]; pp: PayPeople; amount?: number; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch { /* 唔得就算 */ }
  };
  return (
    <Sheet onClose={onClose} label="收款資料">
      <h2>收款資料</h2>
      {ids.map((id) => {
        const list = methodsOf(pp.pays?.[id], pp.emails[id]);
        return (
          <div key={id} className="pay-person">
            <b>{pp.names[id] ?? '玩家'}</b>
            {list.length ? list.map((m) => <PayMethodCard key={m.id} m={m} />) : (
              <p className="muted small">未有填收款資料（佢可以喺「設定 → 收款資料」加）。</p>
            )}
          </div>
        );
      })}
      {amount !== undefined && (
        <button type="button" className="btn big" onClick={() => copy('amt', amount.toFixed(2))}>{copied === 'amt' ? '已複製金額' : `複製金額 ${money(amount)}`}</button>
      )}
    </Sheet>
  );
}

export function PayRows({ items, pp, showSession, busyKey, onToggle, canToggle = () => true, onRemind, canRemind = (it) => it.dir === 'get' }: {
  items: PayItem[]; pp: PayPeople; showSession?: boolean; busyKey?: string; onToggle?: (it: PayItem, on: boolean) => void;
  /** 只有俾錢嗰個先標記得 */
  canToggle?: (it: PayItem) => boolean;
  /** 催找數（收錢嗰個或者超級管理員）：回覆一句結果 */
  onRemind?: (items: PayItem[]) => Promise<string>;
  canRemind?: (it: PayItem) => boolean;
}) {
  const [who, setWho] = useState<{ ids: string[]; amount: number } | null>(null);
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const remind = async (it: PayItem) => {
    const k = `${it.sid}-${it.key}`;
    setReminded((m) => ({ ...m, [k]: '…' }));
    try { const r = await onRemind!([it]); setReminded((m) => ({ ...m, [k]: r })); } catch (err) { setReminded((m) => ({ ...m, [k]: err instanceof Error ? err.message : '催唔到' })); }
  };
  return (
    <>
      <ul className="pay-list">
        {items.map((it) => {
          const counter = it.dir === 'pay' ? it.to : it.from;
          return (
            <li key={`${it.sid}-${it.key}`} className={`pay-row${it.paid ? ' done' : ''} ${it.dir}`}>
              <button type="button" className="pay-main" aria-label="收款資料" onClick={() => setWho({ ids: (it.dir === 'get' ? it.from : it.to).split(' + '), amount: it.amount })}>
                <span className="pay-text">
                <span className="pay-names">
                  <span className="pay-from">{nameOfKey(it.from, pp)}</span>
                  <span className="pay-arrow" aria-label="俾">→</span>
                  <span className="pay-to">{nameOfKey(it.to, pp)}</span>
                </span>
                {it.dir === 'pay' && !it.paid && (() => { const id = counter.split(' + ')[0]; const first = methodsOf(pp.pays?.[id], pp.emails[id])[0]; return first ? <small className="pay-hint">{payLine(first)}</small> : null; })()}
              </span>
              </button>
              <b className={`num pay-amt ${it.dir === 'pay' ? 'loss' : it.dir === 'get' ? 'gain' : ''}`}>{money(it.amount)}</b>
              {showSession && (
                <Link to={`/g/${it.gid}/s/${it.sid}/pay`} className="pay-session" ariaLabel={`睇 ${it.sname || md(it.at)} 嘅數`}>
                  <span className="ellipsis">{it.gname} · {it.sname || md(it.at)}</span><span className="chev" aria-hidden="true">›</span>
                </Link>
              )}
              {onRemind && !it.paid && canRemind(it) && (
                <button type="button" className="pay-remind" disabled={!!reminded[`${it.sid}-${it.key}`]} onClick={() => remind(it)}>
                  {reminded[`${it.sid}-${it.key}`] ? (reminded[`${it.sid}-${it.key}`] === '…' ? '催緊…' : reminded[`${it.sid}-${it.key}`]) : '💸 催找數'}
                </button>
              )}
              {(() => {
                // 狀態：未轉 → （要確認嘅話）等確認 → 搞掂。收錢嘅人可以直接撳「已收到」
                const recv = it.dir === 'get';
                const label = it.paid ? (recv ? '✓ 已收' : '✓ 已轉') : it.pending ? (recv || it.dir === 'other' ? '確認收到' : '等對方確認') : recv ? '已收到' : '標記已轉';
                const on = !(it.paid || (it.pending && it.dir === 'pay'));
                return onToggle && canToggle(it) ? (
                  <button type="button" className={`tf-paid${it.paid ? ' on' : ''}${it.pending ? ' pending' : ''}`} aria-pressed={it.paid} disabled={busyKey === it.key} onClick={() => onToggle(it, on)}>{label}</button>
                ) : (
                  <span className={`tf-paid static${it.paid ? ' on' : ''}${it.pending ? ' pending' : ''}`}>{it.paid ? '✓ 已轉' : it.pending ? '等確認' : '未轉'}</span>
                );
              })()}
            </li>
          );
        })}
      </ul>
      {who && <PersonSheet ids={who.ids} pp={pp} amount={who.amount} onClose={() => setWho(null)} />}
    </>
  );
}

const dm = (t: number) => { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}`; };

/** 欠數卡：同一班人（例如 A + C）要俾嘅數合埋一張卡；撳開分收錢嘅人，再逐日列返。
 *  一個掣一次過催晒（收錢嗰個或者超級管理員先有） */
export function DebtCards({ items, pp, onRemind, canRemind = () => false, onPerson, label, tone = 'loss' }: {
  items: PayItem[]; pp: PayPeople;
  onRemind?: (items: PayItem[]) => Promise<string>;
  canRemind?: (it: PayItem) => boolean;
  /** 撳收錢嘅人：睇 Interac email */
  onPerson?: (ids: string[], amount: number) => void;
  /** 卡頭：「A + C 要找」 */
  label?: (fromName: string) => string;
  /** 總數顏色：要收 = gain、要俾 = loss */
  tone?: 'gain' | 'loss';
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [nudged, setNudged] = useState<Record<string, string>>({});
  const cards = new Map<string, { from: string; total: number; to: Map<string, { to: string; total: number; rows: PayItem[] }> }>();
  for (const it of items) {
    const c = cards.get(it.from) ?? { from: it.from, total: 0, to: new Map() };
    c.total += it.amount;
    const r = c.to.get(it.to) ?? { to: it.to, total: 0, rows: [] };
    r.total += it.amount;
    r.rows.push(it);
    c.to.set(it.to, r);
    cards.set(it.from, c);
  }
  // 同自己有關（自己要俾，或者俾自己）嘅卡排最頂，之後大數先
  const involved = (c: { from: string; to: Map<string, unknown> }) => !!pp.me && (c.from.split(' + ').includes(pp.me) || [...c.to.keys()].some((k) => k.split(' + ').includes(pp.me!)));
  const list = [...cards.values()].sort((a, b) => Number(involved(b)) - Number(involved(a)) || b.total - a.total);
  if (!list.length) return null;
  return (
    <div className="debt-cards">
      {list.map((c) => {
        const fromName = nameOfKey(c.from, pp);
        const isOpen = !!open[c.from];
        const all = [...c.to.values()].flatMap((r) => r.rows);
        const nudgeable = onRemind ? all.filter((it) => !it.paid && canRemind(it)) : [];
        const st = nudged[c.from];
        return (
          <section key={c.from} className={`debt-card${isOpen ? ' open' : ''}`}>
            <button type="button" className="debt-head" aria-expanded={isOpen} onClick={() => setOpen((m) => ({ ...m, [c.from]: !isOpen }))}>
              <span className="grow debt-title">
                <b>{label ? label(fromName) : `${fromName} 要找數`}</b>
                <small className="muted">{c.to.size > 1 ? `俾 ${c.to.size} 個人・` : `俾 ${nameOfKey([...c.to.keys()][0], pp)}・`}{all.length} 筆</small>
              </span>
              <b className={`num debt-total ${tone}`}>{money(c.total)}</b>
              <svg className="debt-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {isOpen && (
              <div className="debt-body">
                {[...c.to.values()].sort((a, b) => b.total - a.total).map((r) => (
                  <div key={r.to} className="debt-to">
                    <button type="button" className="debt-to-head" onClick={() => onPerson?.(r.to.split(' + '), r.total)}>
                      <span className="grow">{fromName} → <b>{nameOfKey(r.to, pp)}</b></span>
                      <b className="num">{money(r.total)}</b>
                    </button>
                    <ul className="debt-rows">
                      {[...r.rows].sort((a, b) => a.at - b.at).map((it) => (
                        <li key={`${it.sid}-${it.key}`}>
                          <Link to={`/g/${it.gid}/s/${it.sid}/pay`} className="debt-row" ariaLabel={`睇 ${it.sname || dm(it.at)} 嘅數`}>
                            <span className="debt-date num">{dm(it.at)}</span>
                            <span className="grow ellipsis muted">{it.gname}・{it.sname}</span>
                            <span className="num">{money(it.amount)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {nudgeable.length > 0 && (
              <button type="button" className="pay-remind debt-remind" disabled={!!st} onClick={async () => {
                setNudged((m) => ({ ...m, [c.from]: '…' }));
                try { const t = await onRemind!(nudgeable); setNudged((m) => ({ ...m, [c.from]: t })); } catch (err) { setNudged((m) => ({ ...m, [c.from]: err instanceof Error ? err.message : '催唔到' })); }
              }}>{st ? (st === '…' ? '催緊…' : st) : `💸 催 ${fromName} 找數`}</button>
            )}
          </section>
        );
      })}
    </div>
  );
}
