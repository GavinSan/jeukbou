// 共用小元件
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { chipsFor } from './engine/chips.ts';
import { db } from './firebase.ts';
import { Link } from './lib/router.tsx';
import { usePrefs } from './lib/prefs.ts';

/** 一隻寫住「雀」嘅牌 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size * 0.78} height={size} viewBox="0 0 28 36" aria-hidden="true">
      <rect x="1" y="5" width="26" height="30" rx="5" fill="var(--tile-back-deep)" />
      <rect x="1" y="3" width="26" height="30" rx="5" fill="var(--tile-back)" />
      <rect x="1" y="1" width="26" height="29" rx="5" fill="var(--tile)" />
      <text x="14" y="22" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--tile-loss)" style={{ fontFamily: 'var(--font-kai)' }}>雀</text>
    </svg>
  );
}

const AVATAR_TONES = ['tone-a', 'tone-b', 'tone-c', 'tone-d', 'tone-e', 'tone-f'];

export function Avatar({ name, photo, size = 'md' }: { name: string; photo?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (photo) return <img className={`avatar ${size}`} src={photo} alt="" />;
  let h = 0;
  for (const ch of name) h = (h + ch.charCodeAt(0)) % AVATAR_TONES.length;
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return <span className={`avatar ${size} ${AVATAR_TONES[h]}`} aria-hidden="true">{initial}</span>;
}

/** 籌碼公仔：位置有限，最多 5 隻，大概數就得 */
export function Chips({ amount, pop = false }: { amount: number; pop?: boolean }) {
  const chips = chipsFor(amount).flatMap((c) => Array.from({ length: c.count }, (_, i) => ({ key: `${c.value}-${i}`, ...c })));
  return (
    <span className={`chips${pop ? ' pop' : ''}`} aria-hidden="true">
      {chips.map((c) => (
        <span key={c.key} className={`chip${c.value === 1 ? ' white' : ''}`} style={{ background: c.color }} />
      ))}
    </span>
  );
}

export function fmt(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (v > 0) return `+${v}`;
  if (v < 0) return `−${Math.abs(v)}`;
  return '0';
}

export const tone = (n: number) => (n > 0 ? 'gain' : n < 0 ? 'loss' : 'even');

/** 數字由舊值轉去新值（大約半秒） */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setShown(value); from.current = value; return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className={className}>{fmt(shown)}</span>;
}

export function TopBar({ back, title, right }: { back?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <Link to={back} className="iconbtn" ariaLabel="返回">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </Link>
      ) : (
        <Link to="/" className="brand"><Logo /><span className="brand-name">雀簿</span></Link>
      )}
      <div className="topbar-title">{typeof title === 'string' ? <h1>{title}</h1> : title}</div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

/** 由底升上嚟嘅面板 */
export function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);
  return (
    <>
      <div className="backdrop" onClick={() => close.current()} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="sheet-inner">
          <div className="grabber" />
          {children}
        </div>
      </div>
    </>
  );
}

/** 數字輸入：打嘅時候可以清空、唔會變 01；離開先檢查，唔啱就用 fallback（預設 = 最細值） */
export function NumInput({ value, onChange, min = 0, max = 99999, decimal = false, fallback, className = 'mini-num', label, disabled, big }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; decimal?: boolean; fallback?: number;
  className?: string; label: string; disabled?: boolean; big?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  const clean = (raw: string) => {
    let t = raw.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, '');
    if (decimal) { const i = t.indexOf('.'); if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, ''); }
    // 去走前面多餘嘅 0：「01」→「1」，「0.5」照留
    t = t.replace(/^0+(?=\d)/, '');
    return t;
  };
  const valid = (n: number) => Number.isFinite(n) && n >= min && n <= max;
  return (
    <input
      className={`${className}${big ? ' big-input' : ''}`}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={draft}
      disabled={disabled}
      aria-label={label}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onChange={(e) => {
        const t = clean(e.target.value);
        setDraft(t);
        const n = Number(t);
        if (t !== '' && valid(n)) onChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        const n = Number(draft);
        const ok = draft !== '' && valid(n) ? n : (fallback ?? min);
        setDraft(String(ok));
        if (ok !== value) onChange(ok);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
    />
  );
}

/** 名字長度：中文字當 2，英文數字當 1，最多 12（即 6 個中文字或 12 個英文字母），枱面先顯示得晒 */
export const NAME_UNITS = 12;
const unitOf = (ch: string) => (/[\u0000-\u00ff]/.test(ch) ? 1 : 2);
export function clampName(s: string): string {
  let used = 0;
  let out = '';
  for (const ch of Array.from(s)) {
    const u = unitOf(ch);
    if (used + u > NAME_UNITS) break;
    used += u;
    out += ch;
  }
  return out;
}

/** 刪除確認：彈出嚟問多一次就得（唔使打字） */
export function ConfirmDelete({ title, detail, onConfirm, onClose, action = '刪除' }: {
  title: string; detail: string; /** 舊介面：已唔使打字確認 */ word?: string; onConfirm: () => Promise<void>; onClose: () => void;
  /** 確認掣嘅字，例如「撤回」 */
  action?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="confirm-back" role="presentation" onClick={() => !busy && onClose()}>
      <div className="confirm-box" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}？</h2>
        <p className="muted">{detail}</p>
        {error && <p className="error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn plain" disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try { await onConfirm(); onClose(); } catch (err) { setError(message(err)); setBusy(false); }
            }}
          >
            {busy ? `${action}中…` : action}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 問一問先做（刪除、撤回、移除…）：const [confirmUI, ask] = useConfirm(); ask({ title, detail, run }) */
export function useConfirm(): [ReactNode, (o: { title: string; detail: string; action?: string; run: () => unknown }) => void] {
  const [req, setReq] = useState<null | { title: string; detail: string; action?: string; run: () => unknown }>(null);
  const ui = req ? (
    <ConfirmDelete title={req.title} detail={req.detail} action={req.action} onConfirm={async () => { await req.run(); }} onClose={() => setReq(null)} />
  ) : null;
  return [ui, setReq];
}

/** 說明文字：設定入面可以收起 */
export function Hint({ children, as = 'p', className = 'muted small' }: { children: ReactNode; as?: 'p' | 'small' | 'span'; className?: string }) {
  const { hints } = usePrefs();
  if (!hints) return null;
  const Tag = as;
  return <Tag className={className}>{children}</Tag>;
}

export function message(err: unknown): string {
  const ERRORS: Record<string, string> = {
    'auth/invalid-credential': 'Email 或密碼不正確',
    'auth/invalid-email': 'Email 格式不正確',
    'auth/email-already-in-use': '此 Email 已登記，請直接登入',
    'auth/weak-password': '密碼最少 6 個字',
    'auth/popup-closed-by-user': '登入視窗已關閉，請再試',
    'auth/network-request-failed': '未能連線，請檢查網絡',
    'auth/too-many-requests': '嘗試次數太多，請稍後再試',
    'permission-denied': '沒有權限',
    unavailable: '未能連線，請檢查網絡',
  };
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (ERRORS[code]) return ERRORS[code];
  if (err instanceof Error && /[一-鿿]/.test(err.message)) return err.message;
  return '出現問題，請再試';
}

/** 寫入玩家資料；冇名就唔寫名 */
export async function saveProfile(user: User) {
  if (!db) return;
  const data: Record<string, unknown> = { photoURL: user.photoURL ?? null, updatedAt: serverTimestamp() };
  // 超級管理員要見到 email 先幫到手（例如重設密碼）
  if (user.email) data.email = user.email;
  if (user.displayName?.trim()) data.name = user.displayName.trim();
  await setDoc(doc(db, 'users', user.uid), data, { merge: true });
}

export function NameForm({ user, initial, onDone, onCancel }: { user: User; initial: string; onDone: () => void; onCancel?: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (!name) { setError('請輸入名稱'); return; }
    
    setBusy(true);
    setError('');
    try {
      await updateProfile(user, { displayName: name });
      await saveProfile(user);
      onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <label className="field">
        <span>顯示名稱</span>
        <input id="display-name" value={value} onChange={(e) => setValue(clampName(e.target.value))} autoComplete="nickname" />
        <small className="muted">最多 6 個中文字或 12 個英文字母</small>
      </label>
      <div className="row">
        <button type="submit" className="btn" disabled={busy}>儲存</button>
        {onCancel && <button type="button" className="btn plain" onClick={onCancel}>取消</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

export function CopyLink({ url, label = '複製邀請連結' }: { url: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('manual');
    }
  }
  return (
    <div className="stack tight">
      <button type="button" className="btn plain" onClick={copy}>{state === 'copied' ? '已複製' : label}</button>
      {state === 'manual' && <input className="input copybox" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="邀請連結" />}
    </div>
  );
}

export function Loading() {
  return <p className="muted center-text">載入中…</p>;
}

/** 每 30 秒更新一次「幾耐之前」 */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
