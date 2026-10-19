import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { joinGroup } from '../lib/data.ts';
import { useProfile } from '../lib/live.ts';
import { go } from '../lib/router.tsx';
import { Logo, message } from '../ui.tsx';

/** /join/:g/:code（可以帶 /s/:s 直接入大局） */
export default function Join({ user, groupId, code, sessionId }: { user: User; groupId: string; code: string; sessionId?: string }) {
  const profile = useProfile(user.uid);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (profile.loading) return;
    let cancelled = false;
    joinGroup(user, groupId, code, profile.data.avatar ?? user.photoURL)
      .then((res) => {
        if (cancelled) return;
        if (res === 'requested') setRequested(true);
        else go(sessionId ? `/g/${groupId}/s/${sessionId}` : `/g/${groupId}`);
      })
      .catch((err) => {
        if (!cancelled) setError(message(err) === '沒有權限' ? '邀請連結無效或已過期，請向局主索取新連結' : message(err));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, groupId, code, sessionId, profile.loading]);

  return (
    <main className="page narrow">
      <div className="brand"><Logo /><h1>雀簿</h1></div>
      {error ? (
        <section className="panel">
          <p className="error" role="alert">{error}</p>
          <button type="button" className="btn plain" onClick={() => go('/')}>返首頁</button>
        </section>
      ) : requested ? (
        <section className="panel">
          <h2>已送出申請</h2>
          <p className="muted">此牌友圈需要局主批准。批准後，牌友圈會出現在你的首頁。</p>
          <button type="button" className="btn" onClick={() => go('/')}>返首頁</button>
        </section>
      ) : (
        <p className="muted">正在加入牌友圈…</p>
      )}
    </main>
  );
}
