// 有人請你入枱：接受或者唔接受
import { useState } from 'react';
import type { User } from 'firebase/auth';
import { answerSwap } from '../lib/data.ts';
import type { SwapRequest, TableDoc } from '../lib/data.ts';
import type { Computed } from '../lib/score.ts';
import { go } from '../lib/router.tsx';
import { sfx, unlock } from '../lib/sound.ts';
import { message } from '../ui.tsx';

export default function Incoming({ user, groupId, sessionId, requests, tables, computed }: {
  user: User;
  groupId: string;
  sessionId: string;
  requests: SwapRequest[];
  tables: TableDoc[];
  computed: Record<string, Computed | null>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const mine = requests.filter((r) => r.status === 'pending' && r.in === user.uid);
  if (!mine.length) return null;

  async function answer(r: SwapRequest, accept: boolean) {
    unlock();
    setBusy(r.id);
    setError('');
    try {
      if (accept) {
        const c = computed[r.tableId];
        if (!c || !c.state.seats.includes(r.out)) throw new Error('嗰個位已經冇咗，請佢哋再發過');
        const seated = Object.values(computed).some((x) => x && !x.state.ended && x.state.seats.includes(user.uid));
        if (seated) throw new Error('你而家已經坐緊另一張枱，先換走自己再接受');
        if (c.state.ended) throw new Error('嗰張枱已經完場');
      }
      await answerSwap(groupId, sessionId, r, user, accept);
      if (accept) {
        sfx.win();
        go(`/g/${groupId}/s/${sessionId}/t/${r.tableId}`);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      {mine.map((r) => {
        const t = tables.find((x) => x.id === r.tableId);
        const outName = t?.names[r.out] ?? '玩家';
        return (
          <div key={r.id} className="banner invite">
            <span className="grow"><b>{t?.name ?? '一張枱'}</b> 請你入嚟換 {outName}</span>
            <button type="button" className="btn" disabled={busy === r.id} onClick={() => answer(r, true)}>接受</button>
            <button type="button" className="textbtn" disabled={busy === r.id} onClick={() => answer(r, false)}>唔接受</button>
          </div>
        );
      })}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
