// 對應玩家：舊紀錄入面嘅名 ↔ 牌友圈成員
// 局主可以幫任何人配對；成員可以自己認領
import { useState } from 'react';
import type { User } from 'firebase/auth';
import { claimLegacy, legacyMap, setLegacyAlias } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { useGroup, useMembers } from '../lib/live.ts';
import { Hint, Loading, TopBar, message } from '../ui.tsx';

export default function PlayersPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const admin = useSuperAdmin(user.uid);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const back = `/g/${groupId}`;
  if (!group.data) return <main className="page"><TopBar back={back} /><Loading /></main>;

  const g = group.data;
  const owner = g.ownerId === user.uid || admin;
  const names = g.legacyNames ?? {};
  const keys = Object.keys(names).sort((a, b) => names[a].localeCompare(names[b]));
  const map = legacyMap(g, members.data);
  const me = members.data.find((m) => m.uid === user.uid);
  const myKey = Object.entries(map).find(([, uid]) => uid === user.uid)?.[0] ?? '';
  const memberName = (uid: string) => members.data.find((m) => m.uid === uid)?.name ?? '（已離開）';

  async function run(id: string, task: () => Promise<void>) {
    setBusy(id); setError('');
    try { await task(); } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }

  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>對應玩家</h1><span className="muted small">{g.name}</span></div>} />
      {!keys.length ? <p className="muted">此牌友圈未有匯入舊紀錄。</p> : (
        <>
          <section className="panel">
            <h3>你是哪一位？</h3>
            <Hint>選擇你在舊紀錄中的名字，以前的數會計入你的帳戶（龍虎榜、個人統計）。</Hint>
            <select
              className="input"
              value={myKey}
              disabled={!!busy}
              aria-label="我喺舊紀錄嘅名"
              onChange={(e) => run('me', () => claimLegacy(groupId, user.uid, e.target.value))}
            >
              <option value="">（未揀）</option>
              {keys.map((k) => <option key={k} value={k} disabled={!!map[k] && map[k] !== user.uid}>{names[k]}{map[k] && map[k] !== user.uid ? `（已配對 ${memberName(map[k])}）` : ''}</option>)}
            </select>
            {me?.legacyKey && g.aliases?.[me.legacyKey] && g.aliases[me.legacyKey] !== user.uid && <p className="error small">局主已將此名字配對給其他人。</p>}
          </section>

          <section className="stack">
            <div className="section-head">
              <h2>全部舊紀錄玩家（{keys.length}）</h2>
              <span className="muted small">已配對 {keys.filter((k) => map[k]).length}</span>
            </div>
            <ul className="list exp-list">
              {keys.map((k) => (
                <li key={k} className="exp-row">
                  <span className="grow exp-text">
                    <span>{names[k]}</span>
                    <small className={map[k] ? 'gain' : 'muted'}>{map[k] ? `→ ${memberName(map[k])}` : '未配對'}</small>
                  </span>
                  {owner && (
                    <select
                      className="inline-select"
                      value={g.aliases?.[k] ?? ''}
                      disabled={busy === k}
                      aria-label={`${names[k]} 配對成員`}
                      onChange={(e) => run(k, () => setLegacyAlias(groupId, k, e.target.value))}
                    >
                      <option value="">{map[k] && !g.aliases?.[k] ? '（成員自己認領）' : '配對…'}</option>
                      {members.data.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
                    </select>
                  )}
                </li>
              ))}
            </ul>
            {owner && <Hint>局主配對優先於成員自行認領。未加入的成員，可先用邀請連結邀請。</Hint>}
          </section>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
