// 收款資料：唔同地方嘅轉賬方法（轉數快、PayMe、Interac、Zelle、PayPay…），每個自己揀顯示定收埋。
// 編輯（設定 → 收款資料）同顯示（找數時撳人）共用呢度嘅元件。
import { useState } from 'react';
import { KINDS, MAX_METHODS, REGIONS, regionOfTz } from '../lib/payMethods.ts';
import type { PayKind, PayMethod, Region } from '../lib/payMethods.ts';
import { Sheet, message } from '../ui.tsx';
import { shrinkImage } from '../lib/scan.ts';

const newId = () => Math.random().toString(36).slice(2, 9);

/** 一個方法：名、資料、複製、連結、QR */
export function PayMethodCard({ m, owner = false, onEdit, onToggle }: { m: PayMethod; owner?: boolean; onEdit?: () => void; onToggle?: (show: boolean) => void }) {
  const k = KINDS[m.kind];
  const [copied, setCopied] = useState(false);
  const [bigQr, setBigQr] = useState(false);
  const link = k.link?.(m.value) ?? null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.value); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* 唔得就算 */ }
  };
  return (
    <div className={`paym${owner && !m.show ? ' hidden' : ''}`}>
      <div className="paym-main">
        <span className="paym-kind">{REGIONS.find((r) => r.key === k.region)?.flag} {k.name}</span>
        <b className="paym-value selectable">{m.value}</b>
        {m.extra && <small className="muted selectable">{m.extra}</small>}
      </div>
      {m.qr && <button type="button" className="paym-qr" aria-label="放大 QR code" onClick={() => setBigQr(true)}><img src={m.qr} alt={`${k.name} QR code`} /></button>}
      <div className="paym-acts">
        <button type="button" className={`btn small-btn${copied ? ' done' : ''}`} onClick={copy}>{copied ? '✓ 已複製' : '複製'}</button>
        {link && !owner && <a className="btn plain small-btn" href={link} target="_blank" rel="noopener noreferrer">開 app</a>}
        {owner && onToggle && (
          <button type="button" role="switch" className="switch" aria-checked={m.show} aria-label={`顯示 ${k.name} 俾牌友`} onClick={() => onToggle(!m.show)} />
        )}
        {owner && onEdit && <button type="button" className="textbtn" onClick={onEdit}>改</button>}
      </div>
      {owner && <small className="paym-vis muted">{m.show ? '牌友睇到' : '收埋咗，淨係你見到'}</small>}
      {bigQr && m.qr && <button type="button" className="feedback-big" onClick={() => setBigQr(false)}><img src={m.qr} alt="QR code（大）" /></button>}
    </div>
  );
}

/** 揀地區 → 揀方法 → 填資料（可以加 QR） */
function MethodSheet({ initial, onSave, onDelete, onClose }: { initial: PayMethod | null; onSave: (m: PayMethod) => Promise<void>; onDelete?: () => Promise<void>; onClose: () => void }) {
  const [region, setRegion] = useState<Region>(initial ? KINDS[initial.kind].region : regionOfTz());
  const [kind, setKind] = useState<PayKind | null>(initial?.kind ?? null);
  const [value, setValue] = useState(initial?.value ?? '');
  const [extra, setExtra] = useState(initial?.extra ?? '');
  const [qr, setQr] = useState(initial?.qr ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const k = kind ? KINDS[kind] : null;
  const problem = k && value.trim() ? k.check?.(value.trim()) ?? null : null;
  async function save() {
    if (!kind) return;
    setBusy(true);
    setError('');
    try {
      await onSave({ id: initial?.id ?? newId(), kind, value: value.trim(), extra: extra.trim() || undefined, qr: qr || undefined, show: initial?.show ?? true });
      onClose();
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet onClose={onClose} label={initial ? '改收款方法' : '加收款方法'}>
      <h2>{initial ? '改收款方法' : '加收款方法'}</h2>
      {!initial && (
        <>
          <div className="region-pick" role="group" aria-label="地區">
            {REGIONS.map((r) => <button key={r.key} type="button" className="region-chip" aria-pressed={region === r.key} onClick={() => { setRegion(r.key); setKind(null); }}>{r.flag} {r.name}</button>)}
          </div>
          <div className="choices pay-kinds">
            {REGIONS.find((r) => r.key === region)!.kinds.map((x) => (
              <button key={x} type="button" className="choice" aria-pressed={kind === x} onClick={() => setKind(x)}>
                <span>{KINDS[x].name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {k && (
        <>
          <label className="field">
            <span>{k.label}</span>
            <input className="input" value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} placeholder={k.placeholder} autoComplete="off" />
            {problem ? <small className="loss">{problem}</small> : k.note ? <small className="muted">{k.note}</small> : null}
          </label>
          {k.extra && (
            <label className="field">
              <span>{k.extra.label}</span>
              <input className="input" value={extra} maxLength={200} onChange={(e) => setExtra(e.target.value)} placeholder={k.extra.placeholder} autoComplete="off" />
            </label>
          )}
          {k.qr && (
            <div className="field">
              <span>QR code（可以唔加）</span>
              {qr ? (
                <div className="feedback-shot"><img src={qr} alt="QR code" /><button type="button" className="textbtn" onClick={() => setQr('')}>移除</button></div>
              ) : (
                <label className="btn plain small-btn feedback-pick">
                  📷 上載 QR code 截圖
                  <input type="file" accept="image/*" className="visually-hidden" aria-label="上載 QR code" onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    try { setQr(`data:image/jpeg;base64,${await shrinkImage(f, 520)}`); } catch (err) { setError(message(err)); }
                  }} />
                </label>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn big" disabled={busy || !kind || !value.trim() || !!problem} onClick={save}>儲存</button>
      {initial && onDelete && <button type="button" className="textbtn loss center-text" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); onClose(); } catch (err) { setError(message(err)); setBusy(false); } }}>刪除呢個方法</button>}
    </Sheet>
  );
}

/** 設定入面：自己嘅收款方法 */
export function PayMethodsEditor({ list, onSave }: { list: PayMethod[]; onSave: (list: PayMethod[]) => Promise<void> }) {
  const [edit, setEdit] = useState<PayMethod | 'new' | null>(null);
  const [error, setError] = useState('');
  const put = (m: PayMethod) => onSave(list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]);
  return (
    <div className="stack">
      {list.map((m) => (
        <PayMethodCard key={m.id} m={m} owner onEdit={() => setEdit(m)} onToggle={(show) => put({ ...m, show }).catch((e) => setError(message(e)))} />
      ))}
      {!list.length && <p className="muted">未有收款方法。加一個，同圈牌友找數時就會見到，一撳複製。</p>}
      {list.length < MAX_METHODS && <button type="button" className="btn plain" onClick={() => setEdit('new')}>＋ 加收款方法</button>}
      {error && <p className="error">{error}</p>}
      {edit && (
        <MethodSheet
          initial={edit === 'new' ? null : edit}
          onSave={put}
          onDelete={edit === 'new' ? undefined : () => onSave(list.filter((x) => x.id !== edit.id))}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
