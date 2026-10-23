// 電視模式（一張枱）：/tv/牌友圈/大局/枱。打橫部機、開螢幕鏡像，就射上電視；分數即時更新。
import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { useGroup, useMembers, useSession } from '../lib/live.ts';
import { roundLabel, useSessionLive } from '../lib/sessionData.ts';
import { describe } from '../lib/score.ts';
import { Loading } from '../ui.tsx';
import TableStage, { tvAnimOn } from '../components/TableStage.tsx';
import type { StagePlayer } from '../components/TableStage.tsx';

const WINDS = ['東', '南', '西', '北'];

export default function TvPage({ user: _user, groupId, sessionId, tableId }: { user: User; groupId: string; sessionId: string; tableId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const members = useMembers(groupId);
  const live = useSessionLive(groupId, sessionId, group.data, session.data);
  const [anim] = useState(tvAnimOn);
  // 電視唔好瞓
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    return () => { lock?.release().catch(() => undefined); };
  }, []);
  const photos = useMemo(() => Object.fromEntries(members.data.map((m) => [m.uid, m.photoURL])), [members.data]);
  const table = live.tables.find((t) => t.id === tableId);
  const c = table ? live.computed[table.id] : null;
  if (!group.data || !session.data || !table || !c) return <main className="page"><Loading /></main>;
  const name = (id: string) => table.names[id] ?? '玩家';
  const players: StagePlayer[] = c.state.seats.map((id, i) => ({
    id, name: name(id), wind: WINDS[i], photo: photos[id] ?? null,
    v: (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0),
    dealer: c.info.dealer === id, streak: c.info.dealer === id ? c.state.streak : 0,
  }));
  const last = c.steps[c.steps.length - 1];
  return (
    <TableStage
      groupName={group.data.name}
      icon={group.data.icon}
      title={`${session.data.name}・${table.name}`}
      round={roundLabel(c)}
      last={last ? describe(last.event, name) : '未開始'}
      players={players}
      anim={anim}
      backHref={`/g/${groupId}/s/${sessionId}/t/${tableId}`}
    />
  );
}
