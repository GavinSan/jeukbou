import type { User } from 'firebase/auth';
import RulesEditor from '../components/RulesEditor.tsx';
import { saveRules } from '../lib/data.ts';
import { useGroup, useSession } from '../lib/live.ts';
import { Loading, TopBar } from '../ui.tsx';

/** /g/:g/rules（牌友圈預設）或者 /g/:g/s/:s/rules（呢個大局） */
export default function RulesPage({ user, groupId, sessionId }: { user: User; groupId: string; sessionId?: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId ?? '_');
  const back = sessionId ? `/g/${groupId}/s/${sessionId}` : `/g/${groupId}`;

  if (group.error) return <main className="page"><TopBar back={back} /><p className="error">{group.error}</p></main>;
  if (!group.data || (sessionId && session.loading)) return <main className="page"><TopBar back={back} /><Loading /></main>;

  const canEdit = group.data.ownerId === user.uid;
  const initial = sessionId ? (session.data?.rules ?? group.data.rules) : group.data.rules;

  return (
    <main className="page">
      <TopBar back={back} title="家規" />
      <RulesEditor
        key={sessionId ?? 'group'}
        initial={initial}
        canEdit={canEdit}
        scopeNote={sessionId ? '只影響這個大局，修改後所有枱會重新計算。' : '適用於之後新開的大局。'}
        onSave={(r) => saveRules(sessionId ? ['groups', groupId, 'sessions', sessionId] : ['groups', groupId], r)}
      />
    </main>
  );
}
