import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../firebase.ts';
import { Logo, message, saveProfile, clampName } from '../ui.tsx';
import { InstallGate } from '../components/InstallGuide.tsx';
import { isStandalone, shouldGuideBeforeLogin } from '../lib/install.ts';

export default function Login({ refresh, joining }: { refresh: () => void; joining: boolean }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(() => shouldGuideBeforeLogin());

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
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
          await saveProfile(cred.user);
        }
        refresh();
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (guide) return <InstallGate joining={joining} onSkip={() => setGuide(false)} />;

  return (
    <main className="page narrow">
      <div className="brand">
        <Logo />
        <h1>雀簿</h1>
      </div>
      <p className="muted">{joining ? '登入後會自動加入牌友圈。' : '港式台牌即時計分、龍虎榜、埋數。'}</p>
      {isStandalone() && !joining && <p className="muted small">有邀請連結？登入後去「牌友圈 → 新增」貼上連結，或者輸入加入碼。</p>}

      <section className="panel">
        <button type="button" className="btn" onClick={withGoogle} disabled={busy}>
          以 Google 登入
        </button>
        <div className="divider"><span>或以 Email</span></div>
        <form className="stack" onSubmit={withEmail}>
          {mode === 'up' && (
            <label className="field">
              <span>雀壇名</span>
              <input id="name" value={name} onChange={(e) => setName(clampName(e.target.value))} autoComplete="nickname" required />
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
        <button type="button" className="textbtn" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(''); }}>
          {mode === 'in' ? '未有帳戶？登記' : '已有帳戶？登入'}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
