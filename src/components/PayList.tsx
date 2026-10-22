// 轉賬列表：邊個俾邊個、幾多、已轉未轉；撳人睇佢嘅 Interac email
import { useState } from 'react';
import type { PayItem } from '../lib/pay.ts';
import { Sheet } from '../ui.tsx';
import { Link } from '../lib/router.tsx';
import { money } from './SettleScreen.tsx';

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

export interface PayPeople {
  me: string | null;
  names: Record<string, string>;
  emails: Record<string, string>;
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
        const email = pp.emails[id];
        return (
          <div key={id} className="pay-person">
            <b>{pp.names[id] ?? '玩家'}</b>
            {email ? (
              <div className="pay-email-row">
                <span className="grow exp-text"><span className="ellipsis pay-email-text">{email}</span><small className="muted">Interac e-Transfer</small></span>
                <button type="button" className={`btn small-btn${copied === id ? ' done' : ''}`} onClick={() => copy(id, email)}>{copied === id ? '✓ 已複製' : '複製 email'}</button>
              </div>
            ) : (
              <p className="muted small">未有填 Interac email（佢可以喺「設定」加）。</p>
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
                {it.dir === 'pay' && !it.paid && pp.emails[counter.split(' + ')[0]] && <small className="pay-hint">Interac：{pp.emails[counter.split(' + ')[0]]}</small>}
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
              {onToggle && canToggle(it) ? (
                <button type="button" className={`tf-paid${it.paid ? ' on' : ''}`} aria-pressed={it.paid} disabled={busyKey === it.key} onClick={() => onToggle(it, !it.paid)}>
                  {it.paid ? '✓ 已轉' : '標記已轉'}
                </button>
              ) : (
                <span className={`tf-paid static${it.paid ? ' on' : ''}`}>{it.paid ? '✓ 已轉' : '未轉'}</span>
              )}
            </li>
          );
        })}
      </ul>
      {who && <PersonSheet ids={who.ids} pp={pp} amount={who.amount} onClose={() => setWho(null)} />}
    </>
  );
}
