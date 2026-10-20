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
  /** 打過幾多日（唔同日子） */
  days: number;
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
    days: new Set(sorted.map((s) => { const d = new Date(s.at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; })).size,
    months: Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - i));
      const inM = sorted.filter((s) => { const x = new Date(s.at); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); });
      return { label: `${d.getMonth() + 1}月`, total: inM.reduce((a, s) => a + s.mine, 0), played: inM.length };
    }),
  };
}

// ---------- 成就（14 類、每類幾級，合共 100 個） ----------
export interface Badge {
  key: string;
  name: string;
  mark: string;
  note: string;
  /** 0–1 */
  progress: number;
  got: boolean;
  /** 屬於邊類、第幾級 */
  cat: string;
  level: number;
  now: number;
  goal: number;
}

export interface BadgeCat {
  key: string;
  title: string;
  mark: string;
  color: string;
  unit: string;
  /** 每級：門檻、名 */
  tiers: [number, string][];
  value: (st: Stats) => number;
  note: (goal: number) => string;
}

export const BADGE_CATS: BadgeCat[] = [
  { key: 'played', title: '場數', mark: '場', color: '#2E7D5B', unit: '場', value: (s) => s.played, note: (g) => `打滿 ${g} 場`,
    tiers: [[1, '初登場'], [5, '新丁'], [10, '常客'], [25, '熟客'], [50, '老雀'], [100, '百戰'], [150, '戰將'], [250, '二百五'], [500, '五百戰'], [1000, '千場傳說']] },
  { key: 'wins', title: '贏場', mark: '贏', color: '#1F7A46', unit: '場', value: (s) => s.wins, note: (g) => `贏 ${g} 場`,
    tiers: [[1, '開齋'], [5, '小勝'], [10, '十全'], [25, '常勝'], [50, '勝利組'], [100, '百勝'], [250, '常勝將軍'], [500, '不敗神話']] },
  { key: 'handWins', title: '食糊', mark: '食', color: '#C08A16', unit: '次', value: (s) => s.handWins, note: (g) => `食糊 ${g} 次`,
    tiers: [[1, '第一糊'], [10, '十糊'], [25, '糊仔'], [50, '食糊機'], [100, '百糊'], [250, '糊神'], [500, '五百糊'], [1000, '千糊'], [2500, '糊到天荒']] },
  { key: 'selfDraws', title: '自摸', mark: '摸', color: '#2C8A8A', unit: '次', value: (s) => s.selfDraws, note: (g) => `自摸 ${g} 次`,
    tiers: [[1, '摸到'], [5, '手感好'], [10, '自摸王'], [25, '妙手'], [50, '摸神'], [100, '百摸'], [250, '金手指'], [500, '摸遍天下']] },
  { key: 'dealIns', title: '出銃', mark: '銃', color: '#B02E26', unit: '次', value: (s) => s.dealIns, note: (g) => `出銃 ${g} 次`,
    tiers: [[1, '第一銃'], [10, '慷慨'], [25, '善長'], [50, '大善人'], [100, '慈善家'], [250, '散財童子'], [500, '銃神']] },
  { key: 'bestFan', title: '一鋪大番', mark: '番', color: '#7146B5', unit: '番', value: (s) => s.bestFan, note: (g) => `一鋪食 ${g} 番`,
    tiers: [[20, '小炒'], [30, '好糊'], [50, '大糊'], [70, '爆棚'], [100, '百番'], [150, '番王'], [200, '神糊'], [300, '天糊']] },
  { key: 'best', title: '單場大贏', mark: '豐', color: '#E5703A', unit: '番', value: (s) => Math.max(0, s.best), note: (g) => `一場贏 ${g} 番`,
    tiers: [[50, '有交易'], [100, '豐收'], [200, '大豐收'], [300, '盆滿'], [500, '缽滿'], [800, '發達'], [1000, '一晚千番']] },
  { key: 'total', title: '總贏', mark: '富', color: '#B8860B', unit: '番', value: (s) => Math.max(0, s.total), note: (g) => `總共贏 ${g} 番`,
    tiers: [[100, '小富'], [250, '有米'], [500, '富貴'], [1000, '千番富翁'], [2500, '大亨'], [5000, '雀壇首富'], [10000, '萬番']] },
  { key: 'tops', title: '龍頭', mark: '龍', color: '#C0392B', unit: '次', value: (s) => s.tops, note: (g) => `當晚第一 ${g} 次`,
    tiers: [[1, '龍頭'], [3, '三奪龍'], [5, '五冠'], [10, '十冠王'], [25, '霸主'], [50, '龍皇'], [100, '百冠']] },
  { key: 'streak', title: '連贏', mark: '連', color: '#D9607A', unit: '場', value: (s) => s.bestStreak, note: (g) => `連續 ${g} 場贏`,
    tiers: [[2, '雙連'], [3, '三連勝'], [4, '四連勝'], [5, '五連勝'], [7, '七連勝'], [10, '十連霸']] },
  { key: 'points', title: '雀力分', mark: '力', color: '#2F63B0', unit: '分', value: (s) => s.points, note: (g) => `雀力 ${g} 分`,
    tiers: [[100, '雀仔'], [300, '雀友'], [600, '雀將'], [1000, '雀王'], [1600, '雀霸'], [2500, '雀神'], [4000, '雀聖'], [6000, '雀帝']] },
  { key: 'groups', title: '牌友圈', mark: '圈', color: '#556B63', unit: '個', value: (s) => s.groups, note: (g) => `喺 ${g} 個牌友圈有紀錄`,
    tiers: [[1, '入圈'], [2, '周圍打'], [3, '交遊廣闊'], [5, '雀壇大使']] },
  { key: 'month', title: '一個月', mark: '月', color: '#8A4A12', unit: '場', value: (s) => s.maxMonth, note: (g) => `一個月打 ${g} 場`,
    tiers: [[4, '每週一聚'], [8, '鐵人'], [12, '雀癡'], [16, '日日見'], [20, '住喺枱']] },
  { key: 'days', title: '打牌日', mark: '日', color: '#24508F', unit: '日', value: (s) => s.days, note: (g) => `打過 ${g} 日`,
    tiers: [[1, '第一日'], [7, '一週'], [30, '一個月'], [60, '兩個月'], [100, '百日']] },
];

export function badgesOf(st: Stats): Badge[] {
  const out: Badge[] = [];
  for (const c of BADGE_CATS) {
    const now = c.value(st);
    c.tiers.forEach(([goal, name], i) => {
      out.push({ key: `${c.key}-${goal}`, name, mark: c.mark, note: c.note(goal), progress: Math.min(1, now / goal), got: now >= goal, cat: c.key, level: i + 1, now, goal });
    });
  }
  // 第 100 個：勝率高（打滿 20 場，贏六成）
  const rate = st.played >= 20 ? st.winRate : 0;
  out.push({ key: 'rate-60', name: '穩贏', mark: '穩', note: '打滿 20 場，勝率 60% 以上', progress: st.played >= 20 ? Math.min(1, st.winRate / 0.6) : st.played / 20 * 0.5, got: rate >= 0.6, cat: 'rate', level: 1, now: Math.round(st.winRate * 100), goal: 60 });
  return out;
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
