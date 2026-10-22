// 對應玩家：舊紀錄入面嘅名 ↔ 牌友圈成員
// 局主可以幫任何人配對；成員可以自己認領
import { useState } from 'react';
import type { User } from 'firebase/auth';
import { claimLegacy, legacyMap, legacyStem, setLegacyAlias, setLegacyAliases } from '../lib/data.ts';
import type { Group, Member } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { useGroup, useMembers } from '../lib/live.ts';
import { Hint, Loading, TopBar, message } from '../ui.tsx';

export default function PlayersPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const admin = useSuperAdmin(user.uid);
  const back = `/g/${groupId}`;
  if (!group.data) {
    return (
      <main className="page">
        <TopBar back={back} title="對應玩家" />
        {group.loading ? <Loading /> : <p className="error">{group.error ?? '搵唔到呢個牌友圈'}</p>}
      </main>
    );
  }
  return (
    <PlayersView
      g={group.data}
      members={members.data}
      me={user.uid}
      owner={group.data.ownerId === user.uid || admin}
      back={back}
      onClaim={(key) => claimLegacy(groupId, user.uid, key)}
      onAlias={(key, uid) => setLegacyAlias(groupId, key, uid)}
      onAliases={(map) => setLegacyAliases(groupId, map)}
    />
  );
}

export function PlayersView({ g, members, me: uidMe, owner, back, onClaim, onAlias, onAliases }: {
  g: Group; members: Member[]; me: string; owner: boolean; back: string;
  onClaim: (key: string) => Promise<void>;
  onAlias: (key: string, uid: string) => Promise<void>;
  onAliases: (map: Record<string, string>) => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const names = g.legacyNames ?? {};
  const keys = Object.keys(names).sort((a, b) => names[a].localeCompare(names[b]));
  const map = legacyMap(g, members);
  const me = members.find((m) => m.uid === uidMe);
  const myKey = Object.entries(map).find(([, uid]) => uid === uidMe)?.[0] ?? '';
  const memberName = (uid: string) => members.find((m) => m.uid === uid)?.name ?? '（已離開）';

  // 同一個人嘅其他寫法（未配對）：例如「ATHENA C.」同「Athena」
  const sameAs = (k: string) => {
    const st = legacyStem(names[k] ?? '');
    return st ? keys.filter((o) => o !== k && !map[o] && legacyStem(names[o]) === st) : [];
  };
  // 一鍵配對：舊名同成員名第一個字一樣、又冇第二個成員撞名
  const auto: Record<string, string> = {};
  for (const k of keys) {
    if (map[k]) continue;
    const st = legacyStem(names[k]);
    const hits = st ? members.filter((m) => legacyStem(m.name) === st) : [];
    if (hits.length === 1) auto[k] = hits[0].uid;
  }
  const autoCount = Object.keys(auto).length;

  async function pairOwner(k: string, uid: string) {
    const more = uid ? sameAs(k) : [];
    if (more.length && window.confirm(`「${more.map((o) => names[o]).join('」「')}」似係同一個人，一齊配對俾 ${memberName(uid)}？`)) {
      await onAliases(Object.fromEntries([k, ...more].map((x) => [x, uid])));
    } else {
      await onAlias(k, uid);
    }
  }

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
              onChange={(e) => run('me', () => onClaim(e.target.value))}
            >
              <option value="">（未揀）</option>
              {keys.map((k) => <option key={k} value={k} disabled={!!map[k] && map[k] !== uidMe}>{names[k]}{map[k] && map[k] !== uidMe ? `（已配對 ${memberName(map[k])}）` : ''}</option>)}
            </select>
            {me?.legacyKey && g.aliases?.[me.legacyKey] && g.aliases[me.legacyKey] !== uidMe && <p className="error small">局主已將此名字配對給其他人。</p>}
          </section>

          <section className="stack">
            <div className="section-head">
              <h2>全部舊紀錄玩家（{keys.length}）</h2>
              <span className="muted small">已配對 {keys.filter((k) => map[k]).length}</span>
            </div>
            {owner && autoCount > 0 && (
              <button
                type="button"
                className="btn plain"
                disabled={!!busy}
                onClick={() => {
                  const lines = Object.entries(auto).map(([k, uid]) => `${names[k]} → ${memberName(uid)}`).join('\n');
                  if (window.confirm(`按名自動配對 ${autoCount} 個：\n${lines}`)) run('auto', () => onAliases(auto));
                }}
              >一鍵配對 {autoCount} 個（按名）</button>
            )}
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
                      onChange={(e) => { const uid = e.target.value; run(k, () => pairOwner(k, uid)); }}
                    >
                      <option value="">{map[k] && !g.aliases?.[k] ? '（成員自己認領）' : '配對…'}</option>
                      {members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
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
