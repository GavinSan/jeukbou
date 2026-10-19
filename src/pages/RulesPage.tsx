import type { User } from 'firebase/auth';
import RulesEditor from '../components/RulesEditor.tsx';
import HouseRules from '../components/HouseRules.tsx';
import { FanTableView } from '../components/FanTable.tsx';
import { SettleConfigForm } from '../components/SettleScreen.tsx';
import { acceptTeam, createTeam, deleteTeam, fanTableOf, saveFanTable, saveRules, saveSettleConfig, settleConfigOf } from '../lib/data.ts';
import TeamsEditor from '../components/Teams.tsx';
import { useGroup, useMembers, useSession, useTeams } from '../lib/live.ts';
import { Loading, TopBar } from '../ui.tsx';
import { useEffect, useState } from 'react';
import { useSuperAdmin } from '../lib/admin.ts';
import { markSeen } from '../lib/notify.ts';
import { displayName } from '../lib/data.ts';
import { message } from '../ui.tsx';

/** /g/:g/rules（牌友圈預設）或者 /g/:g/s/:s/rules（呢個大局） */
export default function RulesPage({ user, groupId, sessionId }: { user: User; groupId: string; sessionId?: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const teams = useTeams(groupId);
  const session = useSession(groupId, sessionId ?? '_');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const back = sessionId ? `/g/${groupId}/s/${sessionId}` : `/g/${groupId}`;
  const admin = useSuperAdmin(user.uid);
  const logAt = group.data?.fanTableLog?.at;
  // 打開咗家規頁 = 睇過最新番數表
  useEffect(() => { markSeen(groupId, logAt); }, [groupId, logAt]);

  if (group.error) return <main className="page"><TopBar back={back} /><p className="error">{group.error}</p></main>;
  if (!group.data || (sessionId && session.loading)) return <main className="page"><TopBar back={back} /><Loading /></main>;

  const g = group.data;
  const canEdit = g.ownerId === user.uid || admin;
  const initial = sessionId ? (session.data?.rules ?? g.rules) : g.rules;
  const cfg = settleConfigOf(g);

  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>家規</h1><span className="muted small">{g.name}</span></div>} />
      <HouseRules
        fans={<FanTableView table={fanTableOf(g)} log={g.fanTableLog} canEdit={canEdit} onSave={(t, changes) => saveFanTable(groupId, t, { uid: user.uid, name: displayName(user), changes })} />}
        scoring={
          <RulesEditor
            key={sessionId ?? 'group'}
            initial={initial}
            canEdit={canEdit}
            scopeNote={sessionId ? '只影響這個大局，修改後所有枱會重新計算。' : '適用於之後新開的大局。'}
            onSave={(r) => saveRules(sessionId ? ['groups', groupId, 'sessions', sessionId] : ['groups', groupId], r)}
          />
        }
        settle={
          <>
            <SettleConfigForm
              key={JSON.stringify(cfg)}
              cfg={cfg}
              canEdit={canEdit}
              accounts={members.data.map((m) => ({ id: m.uid, name: m.name }))}
              busy={busy}
              error={error}
              onSave={async (c) => {
                setBusy(true); setError(''); setSaved('');
                try { await saveSettleConfig(groupId, c); setSaved('已儲存'); } catch (err) { setError(message(err)); } finally { setBusy(false); }
              }}
            />
            {saved && <p className="ok" role="status">{saved}</p>}
            <TeamsEditor
              teams={teams.data}
              people={members.data.map((m) => ({ id: m.uid, name: m.name }))}
              me={user.uid}
              canDeleteAny={canEdit}
              onCreate={(ms) => createTeam(groupId, user.uid, ms)}
              onAccept={(id) => acceptTeam(groupId, id, user.uid)}
              onDelete={(id) => deleteTeam(groupId, id)}
            />
          </>
        }
      />
    </main>
  );
}
