// 共用小元件
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { chipsFor } from './engine/chips.ts';
import { db } from './firebase.ts';
import { Link } from './lib/router.tsx';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="2" width="20" height="28" rx="5" fill="var(--jade)" />
      <rect x="9" y="5" width="14" height="22" rx="3" fill="none" stroke="var(--on-jade)" strokeOpacity="0.45" />
      <circle cx="16" cy="16" r="4.5" fill="none" stroke="var(--on-jade)" strokeWidth="2" />
      <circle cx="16" cy="16" r="1.5" fill="var(--on-jade)" />
    </svg>
  );
}

const AVATAR_TONES = ['tone-a', 'tone-b', 'tone-c', 'tone-d', 'tone-e', 'tone-f'];

export function Avatar({ name, photo, size = 'md' }: { name: string; photo?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (photo) return <img className={`avatar ${size}`} src={photo} alt="" />;
  let h = 0;
  for (const ch of name) h = (h + ch.charCodeAt(0)) % AVATAR_TONES.length;
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return <span className={`avatar ${size} initial ${AVATAR_TONES[h]}`} aria-hidden="true">{initial}</span>;
}

/** 籌碼公仔：位置有限，最多 5 隻，大概數就得 */
export function Chips({ amount }: { amount: number }) {
  const chips = chipsFor(amount).flatMap((c) => Array.from({ length: c.count }, (_, i) => ({ key: `${c.value}-${i}`, ...c })));
  return (
    <span className="chips" aria-hidden="true">
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

export const tone = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');

export function TopBar({ back, title, right }: { back?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <Link to={back} className="iconbtn" ariaLabel="返回">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </Link>
      ) : (
        <Link to="/" className="brand small"><Logo /><span>雀簿</span></Link>
      )}
      <div className="topbar-title">{title}</div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export function message(err: unknown): string {
  const ERRORS: Record<string, string> = {
    'auth/invalid-credential': 'Email 或者密碼唔啱',
    'auth/invalid-email': 'Email 格式唔啱',
    'auth/email-already-in-use': '呢個 Email 已經登記咗，請直接登入',
    'auth/weak-password': '密碼最少要 6 個字',
    'auth/popup-closed-by-user': '登入視窗閂咗，再試一次',
    'auth/network-request-failed': '連唔到網絡，檢查吓再試',
    'auth/too-many-requests': '試得太多次，等一陣再試',
    'permission-denied': '冇權限做呢樣嘢',
    unavailable: '連唔到網絡，檢查吓再試',
  };
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (ERRORS[code]) return ERRORS[code];
  if (err instanceof Error && /[一-鿿]/.test(err.message)) return err.message;
  return '出咗問題，再試一次';
}

/** 寫入玩家資料；冇名就唔寫名 */
export async function saveProfile(user: User) {
  if (!db) return;
  const data: Record<string, unknown> = { photoURL: user.photoURL ?? null, updatedAt: serverTimestamp() };
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
    if (!name) { setError('打個名先'); return; }
    if (name.length > 20) { setError('名最多 20 個字'); return; }
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
        <span>顯示名稱（牌友見到嘅名）</span>
        <input id="display-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={20} autoComplete="nickname" autoFocus />
      </label>
      <div className="row">
        <button type="submit" className="btn" disabled={busy}>儲存</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>取消</button>}
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
      <button type="button" className="btn soft" onClick={copy}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>
        {state === 'copied' ? '複製咗' : label}
      </button>
      {state === 'manual' && <input className="copybox" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="邀請連結" />}
    </div>
  );
}

export function Loading() {
  return <p className="muted center-text">載入緊…</p>;
}
