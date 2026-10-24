// 個人戰績、雀力分、段位、成就：由自己所有牌友圈嘅大局結果計出嚟
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { fs, legacyMap } from './data.ts';
import type { Group, Member, Session } from './data.ts';
import { toGroupDoc, toMemberDoc, toSessionDoc } from './live.ts';
import { sessionTotals } from './history.ts';
import type { SessionResult } from './history.ts';
import { updateSkinAccess } from './prefs.ts';
import { kingPoints, kingTagsOf } from './kings.ts';

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
  pulls?: number;
  /** 呢晚我打咗幾多圈 */
  rounds?: number;
  /** 呢晚攞咗咩正面嘅王（食糊王、自摸王、最大王…；大局層面） */
  kings?: string[];
}

export interface GroupResults {
  gid: string;
  name: string;
  sessions: SessionResult[];
  names: Record<string, string>;
}

// ---------- 雀力分同段位 ----------
export interface PointInput {
  mine: number;
  rank: number;
  players: number;
  wins?: number;
  selfDraws?: number;
  pulls?: number;
  best?: number;
  /** 呢晚攞咗嘅正面王 */
  kings?: string[];
}

/**
 * 一個大局嘅分：出席 10、贏錢 10、當晚第一 10、每贏 100 番 +2（最多 +20）、
 * 每拉人 3 次 +1、當晚攞到嘅王（食糊王 +8、最大王 +10…）。輸唔扣分。
 */
export function sessionPoints(s: PointInput): number {
  let p = 10;
  if (s.mine > 0) p += 10;
  if (s.rank === 1 && s.players > 1 && s.mine > 0) p += 10;
  p += Math.min(20, Math.floor(Math.max(0, s.mine) / 100) * 2);
  p += Math.floor((s.pulls ?? 0) / 3);
  p += kingPoints(s.kings ?? []);
  return p;
}

/** 每個成就（每一級）加幾多分：第 1 級 +5，第 2 級 +10…第 8 級 +40 */
export const badgePoints = (level: number) => level * 5;

export const POINT_RULES: [string, string][] = [
  ['打一個大局', '+10'],
  ['當晚贏錢', '+10'],
  ['當晚第一（龍頭）', '+10'],
  ['每贏 100 番', '+2（最多 +20）'],
  ['每拉人 3 次', '+1'],
  ['當晚做咗食糊王／自摸王', '+8'],
  ['當晚最大王（最大一鋪）', '+10'],
  ['響王、連莊王', '+6'],
  ['拉王', '+5'],
  ['最細王、花王等特別事項王', '+3'],
  ['拎到成就（第 1 級）', '+5'],
  ['成就每升一級', '多 +5（第 8 級 +40）'],
  ['輸錢、出銃王、詐糊王', '不扣分'],
];

export interface Tier {
  name: string;
  /** 牌面上嘅字 */
  mark: string;
  min: number;
  /** 顏色 class */
  cls: string;
}

// 15 個段位：打完第一日（出席 + 初陣、初日、入門成就）就升到雀苗
export const TIERS: Tier[] = [
  { name: '雀蛋', mark: '蛋', min: 0, cls: 't0' },
  { name: '雀苗', mark: '苗', min: 20, cls: 't1' },
  { name: '雀仔', mark: '仔', min: 80, cls: 't2' },
  { name: '雀友', mark: '友', min: 200, cls: 't3' },
  { name: '雀迷', mark: '迷', min: 400, cls: 't4' },
  { name: '雀士', mark: '士', min: 700, cls: 't5' },
  { name: '雀俠', mark: '俠', min: 1100, cls: 't6' },
  { name: '雀豪', mark: '豪', min: 1600, cls: 't7' },
  { name: '雀霸', mark: '霸', min: 2300, cls: 't8' },
  { name: '雀將', mark: '將', min: 3200, cls: 't9' },
  { name: '雀王', mark: '王', min: 4400, cls: 't10' },
  { name: '雀聖', mark: '聖', min: 6000, cls: 't11' },
  { name: '雀尊', mark: '尊', min: 8000, cls: 't12' },
  { name: '雀神', mark: '神', min: 10500, cls: 't13' },
  { name: '雀仙', mark: '仙', min: 14000, cls: 't14' },
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
    const pl = s.play;
    const kings = pl ? (kingTagsOf(pl)[id] ?? []).filter((k) => k.good).map((k) => k.key) : [];
    p += sessionPoints({ mine, rank, players: vals.length, wins: pl?.wins[id], selfDraws: pl?.selfDraws[id], pulls: pl?.pulls?.[id], best: pl?.best[id], kings });
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
  /** 拉人次數、有詳細紀錄嘅鋪數、打咗幾多圈 */
  pulls: number;
  hands: number;
  rounds: number;
  /** 每個月嘅輸贏（最近 6 個月） */
  months: { label: string; total: number; played: number }[];
  /** 攞過幾多個王（大局） */
  kingCount: number;
  /** 雀力分 = 大局分 + 成就分 */
  basePoints: number;
  achPoints: number;
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
    points += sessionPoints(s);
  }
  const wins = sorted.filter((s) => s.mine > 0).length;
  const losses = sorted.filter((s) => s.mine < 0).length;
  const vals = sorted.map((s) => s.mine);
  const now = Date.now();
  const out: Stats = {
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
    pulls: sorted.reduce((a, s) => a + (s.pulls ?? 0), 0),
    rounds: Math.round(sorted.reduce((a, s) => a + (s.rounds ?? 0), 0)),
    hands: sorted.reduce((a, s) => a + (s.wins !== undefined ? s.hands ?? 0 : 0), 0),
    days: new Set(sorted.map((s) => { const d = new Date(s.at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; })).size,
    months: Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - i));
      const inM = sorted.filter((s) => { const x = new Date(s.at); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); });
      return { label: `${d.getMonth() + 1}月`, total: inM.reduce((a, s) => a + s.mine, 0), played: inM.length };
    }),
    kingCount: sorted.reduce((a, s) => a + (s.kings?.length ?? 0), 0),
    basePoints: points,
    achPoints: 0,
  };
  // 成就分：每類每級（雀力分嗰類除外，免得自己計自己）
  out.achPoints = badgesOf(out).filter((b) => b.got && b.cat !== 'points').reduce((a, b) => a + badgePoints(b.level), 0);
  out.points = out.basePoints + out.achPoints;
  return out;
}

// ---------- 成就：每類 8 級，越高級越型 ----------
export interface Badge {
  key: string;
  name: string;
  mark: string;
  note: string;
  /** 0–1 */
  progress: number;
  got: boolean;
  /** 屬於邊類、第幾級（1–8） */
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
  /** 每級：門檻、名（8 級） */
  tiers: [number, string][];
  value: (st: Stats) => number;
  note: (goal: number) => string;
  /** 比率類：未夠樣本就未計（顯示要求） */
  need?: (st: Stats) => string | null;
  /** 顯示進度（例如 52% / 60%） */
  show?: (now: number, goal: number) => string;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export const BADGE_CATS: BadgeCat[] = [
  { key: 'played', title: '大局', mark: '戰', color: '#2E7D5B', unit: '次', value: (s) => s.played, note: (g) => `打滿 ${g} 次大局`,
    tiers: [[1, '初陣'], [10, '新丁'], [25, '熟手'], [50, '老手'], [100, '百戰'], [250, '老江湖'], [500, '戰將'], [1000, '天下人']] },
  { key: 'wins', title: '贏錢', mark: '勝', color: '#1F7A46', unit: '次', value: (s) => s.wins, note: (g) => `贏錢 ${g} 次大局`,
    tiers: [[1, '開齋'], [5, '小勝'], [10, '十勝'], [25, '常勝'], [50, '名人'], [100, '百勝'], [250, '霸者'], [500, '不敗神話']] },
  { key: 'handWins', title: '食糊', mark: '斬', color: '#C08A16', unit: '次', value: (s) => s.handWins, note: (g) => `食糊 ${g} 次`,
    tiers: [[1, '初斬'], [10, '十人斬'], [25, '廿五人斬'], [50, '五十人斬'], [100, '百人斬'], [250, '修羅'], [500, '劍聖'], [1000, '千人斬']] },
  { key: 'selfDraws', title: '自摸', mark: '摸', color: '#2C8A8A', unit: '次', value: (s) => s.selfDraws, note: (g) => `自摸 ${g} 次`,
    tiers: [[1, '初摸'], [5, '妙手'], [10, '神手'], [25, '絕技'], [50, '摸神'], [100, '百摸'], [250, '天衣無縫'], [500, '天和之手']] },
  { key: 'dealIns', title: '出銃', mark: '銃', color: '#B02E26', unit: '次', value: (s) => s.dealIns, note: (g) => `出銃 ${g} 次`,
    tiers: [[1, '初獻'], [10, '大派'], [25, '善人'], [50, '大好人'], [100, '福星'], [250, '散財童子'], [500, '菩薩'], [1000, '銃神']] },
  { key: 'pulls', title: '拉', mark: '拉', color: '#3A6FB0', unit: '次', value: (s) => s.pulls, note: (g) => `拉人 ${g} 次`,
    tiers: [[1, '初拉'], [10, '拉麵'], [25, '拔河'], [50, '拉霸'], [100, '百拉'], [250, '鐵鎖鏈'], [500, '不動明王'], [1000, '千拉']] },
  { key: 'bestFan', title: '一鋪大番', mark: '番', color: '#7146B5', unit: '番', value: (s) => s.bestFan, note: (g) => `一鋪食 ${g} 番`,
    tiers: [[10, '小糊'], [20, '好糊'], [30, '大糊'], [50, '爆棚'], [70, '滿貫'], [100, '百番'], [150, '役滿'], [200, '天地創造']] },
  { key: 'best', title: '一晚大贏', mark: '豐', color: '#E5703A', unit: '番', value: (s) => Math.max(0, s.best), note: (g) => `一次大局贏 ${g} 番`,
    tiers: [[30, '有交易'], [50, '豐收'], [100, '滿載'], [200, '大豐收'], [300, '千金'], [500, '金庫'], [800, '富甲一方'], [1000, '一夜千番']] },
  { key: 'total', title: '總贏', mark: '富', color: '#B8860B', unit: '番', value: (s) => Math.max(0, s.total), note: (g) => `總共贏 ${g} 番`,
    tiers: [[100, '小富'], [250, '有米'], [500, '富貴'], [1000, '千番富翁'], [2500, '大亨'], [5000, '雀壇首富'], [7500, '富可敵國'], [10000, '萬番天下']] },
  { key: 'tops', title: '龍頭', mark: '龍', color: '#C0392B', unit: '次', value: (s) => s.tops, note: (g) => `當晚第一 ${g} 次`,
    tiers: [[1, '龍頭'], [3, '三冠'], [5, '五冠'], [10, '十冠'], [25, '霸主'], [50, '龍王'], [75, '龍神'], [100, '百冠王']] },
  { key: 'streak', title: '連贏', mark: '連', color: '#D9607A', unit: '次', value: (s) => s.bestStreak, note: (g) => `連續 ${g} 次大局贏錢`,
    tiers: [[2, '二連'], [3, '三連'], [4, '四連'], [5, '五連'], [6, '六連'], [7, '七連'], [8, '八連'], [10, '十連霸']] },
  { key: 'points', title: '雀力分', mark: '力', color: '#2F63B0', unit: '分', value: (s) => s.points, note: (g) => `雀力 ${g} 分`,
    tiers: [[200, '雀友'], [700, '雀士'], [1600, '雀豪'], [2300, '雀霸'], [4400, '雀王'], [6000, '雀聖'], [10500, '雀神'], [14000, '雀仙']] },
  { key: 'kings', title: '稱王', mark: '王', color: '#9A3412', unit: '個', value: (s) => s.kingCount, note: (g) => `大局攞 ${g} 次王（食糊王、最大王…）`,
    tiers: [[1, '稱王'], [5, '五冠王'], [10, '十冠王'], [25, '王者'], [50, '王中王'], [100, '百王'], [250, '帝王'], [500, '千秋萬代']] },
  { key: 'days', title: '打牌日', mark: '日', color: '#24508F', unit: '日', value: (s) => s.days, note: (g) => `打過 ${g} 日`,
    tiers: [[1, '初日'], [7, '一週'], [14, '半月'], [30, '一月'], [60, '二月'], [100, '百日'], [200, '二百日'], [365, '一年']] },
  { key: 'month', title: '一個月', mark: '月', color: '#8A4A12', unit: '次', value: (s) => s.maxMonth, note: (g) => `一個月打 ${g} 次`,
    tiers: [[2, '月二'], [4, '每週'], [6, '常客'], [8, '鐵人'], [10, '雀癡'], [12, '住喺枱'], [16, '日日見'], [20, '雀莊主']] },
  { key: 'groups', title: '牌友圈', mark: '圈', color: '#556B63', unit: '個', value: (s) => s.groups, note: (g) => `喺 ${g} 個牌友圈有紀錄`,
    tiers: [[1, '入門'], [2, '二刀流'], [3, '三圈'], [4, '四方'], [5, '五湖'], [6, '六合'], [7, '七海'], [8, '八方美人']] },
  // 比率類：要夠樣本先計
  { key: 'rate', title: '勝率', mark: '穩', color: '#0F766E', unit: '%', value: (s) => (s.played >= 20 ? pct(s.wins, s.played) : 0), note: (g) => `打滿 20 次大局，贏錢 ${g}%`,
    need: (s) => (s.played >= 20 ? null : `打滿 20 次大局先計（而家 ${s.played}）`), show: (n, g) => `${n}% / ${g}%`,
    tiers: [[40, '不倒翁'], [45, '五五波'], [50, '勝多輸少'], [55, '穩陣'], [60, '穩贏'], [65, '鐵板'], [70, '必勝'], [75, '無敵']] },
  { key: 'selfRate', title: '自摸率', mark: '手', color: '#0E7490', unit: '%', value: (s) => (s.handWins >= 20 ? pct(s.selfDraws, s.handWins) : 0), note: (g) => `食糊入面 ${g}% 係自摸`,
    need: (s) => (s.handWins >= 20 ? null : `食滿 20 鋪先計（而家 ${s.handWins}）`), show: (n, g) => `${n}% / ${g}%`,
    tiers: [[20, '手氣'], [25, '手感'], [30, '摸手'], [35, '妙摸'], [40, '神摸'], [45, '摸皇'], [50, '摸聖'], [60, '天摸']] },
  { key: 'winRate', title: '食糊率', mark: '食', color: '#A16207', unit: '%', value: (s) => (s.hands >= 100 ? pct(s.handWins, s.hands) : 0), note: (g) => `每 100 鋪食 ${g} 鋪`,
    need: (s) => (s.hands >= 100 ? null : `打滿 100 鋪先計（而家 ${s.hands}）`), show: (n, g) => `${n}% / ${g}%`,
    tiers: [[20, '食得'], [22, '好食'], [24, '大食'], [26, '饕餮'], [28, '食神'], [30, '食聖'], [33, '食仙'], [36, '食盡天下']] },
  { key: 'safe', title: '少出銃', mark: '盾', color: '#4B5563', unit: '%', value: (s) => (s.hands >= 100 ? 100 - pct(s.dealIns, s.hands) : 0), note: (g) => `每 100 鋪出銃 ${100 - g} 鋪或以下`,
    need: (s) => (s.hands >= 100 ? null : `打滿 100 鋪先計（而家 ${s.hands}）`), show: (n, g) => `出銃 ${100 - n}% / ${100 - g}%`,
    tiers: [[80, '穩打'], [82, '謹慎'], [84, '鐵壁'], [86, '金鐘罩'], [88, '不動'], [90, '無銃'], [92, '隱者'], [94, '忍者']] },
];

export function badgesOf(st: Stats): Badge[] {
  const out: Badge[] = [];
  for (const c of BADGE_CATS) {
    const now = c.value(st);
    const ready = !c.need || !c.need(st);
    c.tiers.forEach(([goal, name], i) => {
      out.push({
        key: `${c.key}-${goal}`, name, mark: c.mark, note: c.note(goal),
        progress: ready ? Math.min(1, now / goal) : 0, got: ready && now >= goal, cat: c.key, level: i + 1, now, goal,
      });
    });
  }
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
        ...(pl ? { wins: pl.wins[uid] ?? 0, selfDraws: pl.selfDraws[uid] ?? 0, dealIns: pl.dealIns[uid] ?? 0, best: pl.best[uid] ?? 0, hands: pl.hands, pulls: pl.pulls?.[uid] ?? 0, rounds: pl.rounds?.[uid] ?? 0, kings: (kingTagsOf(pl)[uid] ?? []).filter((k) => k.good).map((k) => k.key) } : {}),
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
// 上次計好嘅戰績存喺手機：主頁、段位即刻顯示，之後喺背後同伺服器對過
const HIST = 'jeukbou-hist:';
function histGet(uid: string, groupIds: string[]): GroupResults[] | null {
  try {
    const raw = localStorage.getItem(HIST + uid);
    if (!raw) return null;
    const all = JSON.parse(raw) as GroupResults[];
    const want = new Set(groupIds);
    return all.filter((g) => want.has(g.gid));
  } catch { return null; }
}
function histSet(uid: string, groups: GroupResults[]) {
  try { localStorage.setItem(HIST + uid, JSON.stringify(groups)); } catch { /* 太大存唔到就算 */ }
}

export function useMyHistory(uid: string | null, groupIds: string[]): MyHistory {
  const key = `${uid}|${groupIds.join(',')}`;
  const fromCache = (): MyHistory | null => {
    if (!uid || !groupIds.length) return null;
    const g = histGet(uid, groupIds);
    return g && g.length ? { loading: false, groups: g, mine: mySessions(g, uid) } : null;
  };
  const [state, setState] = useState<MyHistory>(() => fromCache() ?? { loading: true, groups: [], mine: [] });
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const c = fromCache();
    setState((s) => c ?? { ...s, loading: true });
    let failed = false;
    Promise.all(groupIds.map((g) => loadGroup(g).catch(() => { failed = true; return null; }))).then((list) => {
      if (!alive) return;
      const groups = list.filter((x): x is GroupResults => !!x);
      // 有牌友圈讀唔到（例如冇網）：唔好用唔齊嘅結果蓋咗手機入面嗰份
      if (failed && c) { setState({ ...c, loading: false }); return; }
      if (!failed) histSet(uid, groups);
      setState({ loading: false, groups, mine: mySessions(groups, uid) });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** 由戰績計段位（TIERS 嘅位置）同步俾風格解鎖用；載入緊就唔郁 */
export function useTierSync(h: MyHistory, ready: boolean) {
  useEffect(() => {
    if (!ready || h.loading) return;
    const t = tierOf(statsOf(h.mine).points).tier;
    updateSkinAccess({ tier: TIERS.indexOf(t) });
  }, [ready, h.loading, h.mine]);
}
