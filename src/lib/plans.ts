// 收費方案（未正式收費）：基本嘅計數、記錄、找數永遠免費；收費收「方便」同「好睇」。
// 而家淨係 /demo/paid 用嚟示範；正式收費之前，付款狀態同等級要改由 Cloud Function 寫，唔可以喺手機計。
export type Plan = 'free' | 'plus' | 'circle';

export interface PlanInfo {
  key: Plan;
  name: string;
  /** 一句講邊個俾 */
  who: string;
  monthly: number | null;
  yearly: number | null;
}

export const PLANS: PlanInfo[] = [
  { key: 'free', name: '免費', who: '人人都有', monthly: null, yearly: null },
  { key: 'plus', name: '雀簿＋', who: '自己俾，自己用', monthly: 18, yearly: 128 },
  { key: 'circle', name: '牌友圈＋', who: '圈主俾一份，全圈受惠', monthly: 38, yearly: 268 },
];

/** 數量上限（Infinity = 冇限） */
export interface Limits {
  ownGroups: number;
  members: number;
  tablesPerDay: number;
  historyDays: number;
  liveTables: number;
  livePerMonth: number;
  renamesPerMonth: number;
  allSkins: boolean;
  deepStats: boolean;
  imports: number;
}

const FREE: Limits = { ownGroups: 2, members: 12, tablesPerDay: 2, historyDays: 90, liveTables: 1, livePerMonth: 2, renamesPerMonth: 0, allSkins: false, deepStats: false, imports: 1 };

export const LIMITS: Record<Plan, Limits> = {
  free: FREE,
  plus: { ...FREE, ownGroups: 10, historyDays: Infinity, liveTables: 3, livePerMonth: Infinity, renamesPerMonth: 1, allSkins: true, deepStats: true, imports: Infinity },
  // 牌友圈＋：圈嘅上限（人數、枱數、Live）；個人嘢（皮膚、改名）唔包
  circle: { ...FREE, members: 40, tablesPerDay: 8, historyDays: Infinity, liveTables: Infinity, livePerMonth: Infinity, deepStats: true, imports: Infinity },
};

/** 自己嘅方案＋所在圈嘅方案 → 實際上限（圈嘅嘢跟圈，個人嘢跟自己） */
export function limitsOf(mine: Plan, circle: Plan): Limits {
  const a = LIMITS[mine];
  const c = LIMITS[circle];
  const max = (x: number, y: number) => Math.max(x, y);
  return {
    ownGroups: a.ownGroups,
    members: max(a.members, c.members),
    tablesPerDay: max(a.tablesPerDay, c.tablesPerDay),
    historyDays: max(a.historyDays, c.historyDays),
    liveTables: max(a.liveTables, c.liveTables),
    livePerMonth: max(a.livePerMonth, c.livePerMonth),
    renamesPerMonth: a.renamesPerMonth,
    allSkins: a.allSkins,
    deepStats: a.deepStats || c.deepStats,
    imports: max(a.imports, c.imports),
  };
}

export const showLimit = (n: number, unit = '') => (n === Infinity ? '無限' : `${n}${unit}`);
