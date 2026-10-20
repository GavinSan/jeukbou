// 唔使打開埋數頁都計到轉賬：讀晒一個大局嘅枱、開支、Group，用同一套計法
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { fs, settleConfigOf } from './data.ts';
import type { Group, Member, Payout, Session, TeamDoc } from './data.ts';
import { toEvent, toExpenseDoc, toPairDoc, toTable, toTeamDoc } from './live.ts';
import { computeTable, rulesTimeline } from './score.ts';
import type { Computed } from './score.ts';
import { sessionSummary } from './totals.ts';
import { buildSettle, payoutOf } from './settle.ts';

export async function loadTeams(gid: string): Promise<TeamDoc[]> {
  const snap = await getDocs(collection(fs(), 'groups', gid, 'teams'));
  return snap.docs.map((d) => toTeamDoc(d.id, d.data()));
}

/** 計一個大局嘅轉賬快照（計唔到就 null） */
export async function computePayout(g: Group, s: Session, members: Member[], teams: TeamDoc[]): Promise<Payout | null> {
  const col = (...rest: string[]) => collection(fs(), 'groups', g.id, 'sessions', s.id, ...rest);
  const [tSnap, eSnap, pSnap] = await Promise.all([
    getDocs(query(col('tables'), orderBy('order'))),
    getDocs(col('expenses')),
    getDocs(col('pairs')),
  ]);
  const tables = tSnap.docs.map((d) => toTable(d.id, d.data()));
  const timeline = rulesTimeline(g, s);
  const computed: Record<string, Computed | null> = {};
  await Promise.all(tables.map(async (t) => {
    const ev = await getDocs(query(col('tables', t.id, 'events'), orderBy('seq')));
    computed[t.id] = computeTable(t, ev.docs.map((d) => toEvent(d.id, d.data())), timeline);
  }));
  const sum = sessionSummary(tables, computed);
  const expenses = eSnap.docs.map((d) => toExpenseDoc(d.id, d.data()));
  const people = s.people ?? [];
  const cfg = { ...settleConfigOf(g), waterTo: s.waterTo || s.createdBy };
  const built = buildSettle({
    players: sum.players, people, fan: sum.fan, water: sum.water, cfg, expenses,
    pairs: pSnap.docs.map((d) => toPairDoc(d.id, d.data())), teams, skipTeams: s.skipTeams ?? [],
  });
  if (!built.r) return null;
  const guest: Record<string, string> = Object.assign({}, ...expenses.map((e) => e.names ?? {}));
  const nameOf = (id: string) => sum.players.find((p) => p.id === id)?.name ?? people.find((p) => p.id === id)?.name
    ?? members.find((m) => m.uid === id)?.name ?? guest[id] ?? '玩家';
  return payoutOf(built.r, cfg.currency, nameOf);
}
