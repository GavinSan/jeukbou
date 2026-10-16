import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, configError, db } from './firebase.ts';

const ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'Email 或者密碼唔啱',
  'auth/invalid-email': 'Email 格式唔啱',
  'auth/email-already-in-use': '呢個 Email 已經登記咗，請直接登入',
  'auth/weak-password': '密碼最少要 6 個字',
  'auth/popup-closed-by-user': '登入視窗閂咗，再試一次',
  'auth/network-request-failed': '連唔到網絡，檢查吓再試',
  'auth/too-many-requests': '試得太多次，等一陣再試',
};

function message(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  return ERRORS[code] ?? '出咗問題，再試一次';
}

async function saveProfile(user: User, name?: string) {
  if (!db) return;
  await setDoc(
    doc(db, 'users', user.uid),
    { name: name ?? user.displayName ?? user.email ?? '玩家', photoURL: user.photoURL ?? null, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="2" width="20" height="28" rx="5" fill="var(--jade)" />
      <rect x="9" y="5" width="14" height="22" rx="3" fill="none" stroke="var(--on-jade)" strokeOpacity="0.45" />
      <circle cx="16" cy="16" r="4.5" fill="none" stroke="var(--on-jade)" strokeWidth="2" />
      <circle cx="16" cy="16" r="1.5" fill="var(--on-jade)" />
    </svg>
  );
}

function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function withGoogle() {
    if (!auth) return;
    setError('');
    setBusy(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      await saveProfile(cred.user);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function withEmail(e: FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setError('');
    setBusy(true);
    try {
      if (mode === 'up') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const display = name.trim() || email.trim();
        await updateProfile(cred.user, { displayName: display });
        await saveProfile(cred.user, display);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <div className="brand">
        <Logo />
        <h1>雀簿</h1>
      </div>
      <p className="muted">港式台牌即時計分、龍虎榜、埋數。每人用自己帳戶登入。</p>

      <section className="card stack">
        <button type="button" className="btn dark" onClick={withGoogle} disabled={busy}>
          用 Google 登入
        </button>
        <div className="divider"><span>或者用 Email</span></div>
        <form className="stack" onSubmit={withEmail}>
          {mode === 'up' && (
            <label className="field">
              <span>顯示名稱</span>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" required />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label className="field">
            <span>密碼</span>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </label>
          <button type="submit" className="btn" disabled={busy}>
            {mode === 'up' ? '登記' : '登入'}
          </button>
        </form>
        <button type="button" className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(''); }}>
          {mode === 'in' ? '未有帳戶？登記' : '已經有帳戶？登入'}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  );
}

function Home({ user }: { user: User }) {
  const name = user.displayName ?? user.email ?? '玩家';
  return (
    <main className="page">
      <header className="topbar">
        <div className="brand small">
          <Logo />
          <span>雀簿</span>
        </div>
        <button type="button" className="btn ghost" onClick={() => auth && signOut(auth)}>
          登出
        </button>
      </header>
      <section className="card stack">
        <div className="row">
          {user.photoURL ? (
            <img className="avatar" src={user.photoURL} alt="" />
          ) : (
            <span className="avatar initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <h2>你好，{name}</h2>
            <p className="muted">已經登入。開大局、入數同龍虎榜會喺下一個版本加入。</p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) saveProfile(u).catch(() => undefined);
    });
  }, []);

  if (configError) {
    return (
      <main className="page narrow">
        <h1>雀簿</h1>
        <p className="error">{configError}</p>
      </main>
    );
  }
  if (user === undefined) return <main className="page narrow"><p className="muted">載入緊…</p></main>;
  return user ? <Home user={user} /> : <Login />;
}
