// 個人戰績、雀力分、段位、成就：由自己所有牌友圈嘅大局結果計出嚟
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { fs, legacyMap } from './data.ts';
import type { Group, Member, Session } from './data.ts';
import { toGroupDoc, toMemberDoc, toSessionDoc } from './live.ts';
import { sessionTotals } from './history.ts';
import type { SessionResult } from './history.ts';

/** 我打過嘅一場 */
export interface MySession {
  gid: string;
  gname: string;
  sid: string;
  name: string;
  at: number;
  /** 我嘅番數 */
  mine: number;
  /** 當晚排第幾（1 = 龍頭） */
  rank: number;
  players: number;
  /** 呢晚我食糊、自摸、出銃幾多次、最大一鋪（舊紀錄冇） */
  wins?: number;
  selfDraws?: number;
  dealIns?: number;
  best?: number;
  hands?: number;
}

export interface GroupResults {
  gid: string;
  name: string;
  sessions: SessionResult[];
  names: Record<string, string>;
}

// ---------- 雀力分同段位 ----------
/** 一場嘅分：出席 10、贏 10、當晚第一 10、每贏 100 番 +2（最多 +20）。輸唔扣分。 */
export function sessionPoints(mine: number, rank: number, players: number): number {
  let p = 10;
  if (mine > 0) p += 10;
  if (rank === 1 && players > 1 && mine > 0) p += 10;
  p += Math.min(20, Math.floor(Math.max(0, mine) / 100) * 2);
  return p;
}

export const POINT_RULES: [string, string][] = [
  ['出席一場', '+10'],
  ['當晚贏錢', '+10'],
  ['當晚第一（龍頭）', '+10'],
  ['每贏 100 番', '+2（最多 +20）'],
  ['輸錢', '不扣分'],
];

export interface Tier {
  name: string;
  /** 牌面上嘅字 */
  mark: string;
  min: number;
  /** 顏色 class */
  cls: string;
}

export const TIERS: Tier[] = [
  { name: '雀苗', mark: '苗', min: 0, cls: 't0' },
  { name: '雀仔', mark: '仔', min: 100, cls: 't1' },
  { name: '雀友', mark: '友', min: 300, cls: 't2' },
  { name: '雀將', mark: '將', min: 600, cls: 't3' },
  { name: '雀王', mark: '王', min: 1000, cls: 't4' },
  { name: '雀霸', mark: '霸', min: 1600, cls: 't5' },
  { name: '雀神', mark: '神', min: 2500, cls: 't6' },
  { name: '雀聖', mark: '聖', min: 4000, cls: 't7' },
];

export function tierOf(points: number): { tier: Tier; next: Tier | null; progress: number; toNext: number } {
  let i = 0;
  while (i + 1 < TIERS.length && points >= TIERS[i + 1].min) i++;
  const tier = TIERS[i];
  const next = TIERS[i + 1] ?? null;
  const progress = next ? (points - tier.min) / (next.min - tier.min) : 1;
  return { tier, next, progress: Math.max(0, Math.min(1, progress)), toNext: next ? next.min - points : 0 };
}

/** 一個人喺一堆大局入面嘅分（排名用） */
export function pointsFor(id: string, sessions: SessionResult[]): number {
  let p = 0;
  for (const s of sessions) {
    if (!(id in s.totals)) continue;
    const vals = Object.values(s.totals);
    const mine = s.totals[id];
    const rank = 1 + vals.filter((v) => v > mine).length;
    p += sessionPoints(mine, rank, vals.length);
  }
  return p;
}

// ---------- 戰績 ----------
export interface Stats {
  played: number;
  wins: number;
  losses: number;
  winRate: number;
  total: number;
  avg: number;
  best: number;
  worst: number;
  tops: number;
  points: number;
  /** 最長連贏（場） */
  bestStreak: number;
  streak: number;
  groups: number;
  /** 累計番數走勢 */
  curve: number[];
  /** 最近一個月場數 */
  month: number;
  maxMonth: number;
  /** 有詳細紀錄嘅場（唔計舊紀錄）入面：食糊、自摸、出銃、最大一鋪 */
  handWins: number;
  selfDraws: number;
  dealIns: number;
  bestFan: number;
  detailed: number;
  /** 每個月嘅輸贏（最近 6 個月） */
  months: { label: string; total: number; played: number }[];
}

export function statsOf(list: MySession[]): Stats {
  const sorted = [...list].sort((a, b) => a.at - b.at);
  let total = 0;
  let run = 0;
  let bestStreak = 0;
  const curve = [0];
  const perMonth = new Map<string, number>();
  let points = 0;
  for (const s of sorted) {
    total += s.mine;
    curve.push(total);
    run = s.mine > 0 ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
    const d = new Date(s.at);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
    points += sessionPoints(s.mine, s.rank, s.players);
  }
  const wins = sorted.filter((s) => s.mine > 0).length;
  const losses = sorted.filter((s) => s.mine < 0).length;
  const vals = sorted.map((s) => s.mine);
  const now = Date.now();
  return {
    played: sorted.length,
    wins,
    losses,
    winRate: sorted.length ? wins / sorted.length : 0,
    total,
    avg: sorted.length ? Math.round(total / sorted.length) : 0,
    best: vals.length ? Math.max(...vals) : 0,
    worst: vals.length ? Math.min(...vals) : 0,
    tops: sorted.filter((s) => s.rank === 1 && s.players > 1 && s.mine > 0).length,
    points,
    bestStreak,
    streak: run,
    groups: new Set(sorted.map((s) => s.gid)).size,
    curve,
    month: sorted.filter((s) => now - s.at < 30 * 86400000).length,
    maxMonth: Math.max(0, ...perMonth.values()),
    handWins: sorted.reduce((a, s) => a + (s.wins ?? 0), 0),
    selfDraws: sorted.reduce((a, s) => a + (s.selfDraws ?? 0), 0),
    dealIns: sorted.reduce((a, s) => a + (s.dealIns ?? 0), 0),
    bestFan: Math.max(0, ...sorted.map((s) => s.best ?? 0)),
    detailed: sorted.filter((s) => s.wins !== undefined).length,
    months: Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - i));
      const inM = sorted.filter((s) => { const x = new Date(s.at); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); });
      return { label: `${d.getMonth() + 1}月`, total: inM.reduce((a, s) => a + s.mine, 0), played: inM.length };
    }),
  };
}

// ---------- 成就 ----------
export interface Badge {
  key: string;
  name: string;
  mark: string;
  note: string;
  /** 0–1 */
  progress: number;
  got: boolean;
}

export function badgesOf(st: Stats): Badge[] {
  const b = (key: string, name: string, mark: string, note: string, now: number, goal: number): Badge =>
    ({ key, name, mark, note, progress: Math.min(1, now / goal), got: now >= goal });
  return [
    b('first', '初登場', '初', '打第一場', st.played, 1),
    b('ten', '常客', '常', '打滿 10 場', st.played, 10),
    b('fifty', '老雀', '老', '打滿 50 場', st.played, 50),
    b('hundred', '百戰', '百', '打滿 100 場', st.played, 100),
    b('streak3', '三連勝', '三', '連續 3 場贏', st.bestStreak, 3),
    b('streak5', '五連勝', '五', '連續 5 場贏', st.bestStreak, 5),
    b('top5', '龍頭', '龍', '當晚第一 5 次', st.tops, 5),
    b('big', '大豐收', '豐', '一場贏 300 番', Math.max(0, st.best), 300),
    b('iron', '鐵人', '鐵', '一個月打 8 場', st.maxMonth, 8),
    b('multi', '周圍打', '圈', '喺 2 個牌友圈有紀錄', st.groups, 2),
    b('self10', '自摸王', '摸', '自摸 10 次', st.selfDraws, 10),
    b('win50', '食糊機', '食', '食糊 50 次', st.handWins, 50),
    b('hundred-fan', '百番', '番', '一鋪食 100 番', st.bestFan, 100),
  ];
}

// ---------- 讀資料 ----------
async function loadGroup(gid: string): Promise<GroupResults | null> {
  const gSnap = await getDoc(doc(fs(), 'groups', gid));
  if (!gSnap.exists()) return null;
  const g: Group = toGroupDoc(gSnap.id, gSnap.data());
  const [mSnap, sSnap] = await Promise.all([
    getDocs(collection(fs(), 'groups', gid, 'members')),
    getDocs(collection(fs(), 'groups', gid, 'sessions')),
  ]);
  const members: Member[] = mSnap.docs.map((d) => toMemberDoc(d.id, d.data()));
  const sessions: Session[] = sSnap.docs.map((d) => toSessionDoc(d.id, d.data()))
    .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
  const legacy = legacyMap(g, members);
  const results = await Promise.all(sessions.map((s) => sessionTotals(g, s, legacy).catch(() => ({ totals: {} as Record<string, number>, names: {} as Record<string, string>, play: undefined }))));
  const names: Record<string, string> = {};
  const out: SessionResult[] = results.map((r, i) => {
    for (const [id, n] of Object.entries(r.names)) names[id] = names[id] || n;
    return { id: sessions[i].id, name: sessions[i].name, at: sessions[i].createdAt?.toMillis() ?? Date.now(), totals: r.totals, play: r.play };
  });
  for (const m of members) names[m.uid] = m.name;
  return { gid, name: g.name, sessions: out.filter((s) => Object.keys(s.totals).length > 0), names };
}

export function mySessions(groups: GroupResults[], uid: string): MySession[] {
  const out: MySession[] = [];
  for (const g of groups) {
    for (const s of g.sessions) {
      if (!(uid in s.totals)) continue;
      const vals = Object.values(s.totals);
      const mine = s.totals[uid];
      const pl = s.play;
      out.push({
        gid: g.gid, gname: g.name, sid: s.id, name: s.name, at: s.at, mine, rank: 1 + vals.filter((v) => v > mine).length, players: vals.length,
        ...(pl ? { wins: pl.wins[uid] ?? 0, selfDraws: pl.selfDraws[uid] ?? 0, dealIns: pl.dealIns[uid] ?? 0, best: pl.best[uid] ?? 0, hands: pl.hands } : {}),
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface MyHistory {
  loading: boolean;
  groups: GroupResults[];
  mine: MySession[];
}

/** 讀晒自己所有牌友圈（一次，唔即時跟） */
export function useMyHistory(uid: string | null, groupIds: string[]): MyHistory {
  const key = `${uid}|${groupIds.join(',')}`;
  const [state, setState] = useState<MyHistory>({ loading: true, groups: [], mine: [] });
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.all(groupIds.map((g) => loadGroup(g).catch(() => null))).then((list) => {
      if (!alive) return;
      const groups = list.filter((x): x is GroupResults => !!x);
      setState({ loading: false, groups, mine: mySessions(groups, uid) });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
