// 家規：全部數值都用「番」做單位（1 番 = 1），每個大局可以自訂。

export type Rounding = 'ceil' | 'round' | 'none';
export type WaterTiming = 'settle' | 'win';

export interface Rules {
  /** 底，每個輸家每鋪都要俾 */
  base: number;
  la: {
    /** 拉 / 劈開唔開 */
    enabled: boolean;
    /** 每幾拉輸家可以揀找數（3 = 第 3、6、9… 拉） */
    settleEvery: number;
  };
  /** 拉同劈 ÷2 有小數點點處理 */
  rounding: Rounding;
  /** 雙響、三響每個食糊玩家加幾多番 */
  multiWinBonus: { double: number; triple: number };
  /** 反雙響 / 反三響：響完之後出銃嗰個自摸，之前有份食佢嘅玩家加番 */
  reverse: { enabled: boolean; double: number; triple: number };
  dealer: {
    /** 莊番 2n + 1（n = 連莊次數） */
    enabled: boolean;
    /** 流局冧莊 */
    drawKeepsDealer: boolean;
    /** 流局冧莊時連莊數加唔加 1 */
    drawAddsStreak: boolean;
  };
  water: {
    enabled: boolean;
    /** 每幾多番抽一次 */
    per: number;
    /** 每次抽幾多番 */
    take: number;
    /** settle = 真正找數嗰陣先抽；win = 食糊嗰陣就抽 */
    timing: WaterTiming;
  };
  /** 詐糊俾每家幾多番 */
  falseWinPenalty: number;
  /** 打幾圈自動完場，0 = 唔限（由人撳完場） */
  rounds: number;
  /** 換位嗰陣邊啲拉要即時找數：player = 淨係換位嗰個人有份嘅；table = 成張枱 */
  swapSettle: 'player' | 'table';
}

export const DEFAULT_RULES: Rules = {
  base: 5,
  la: { enabled: true, settleEvery: 3 },
  rounding: 'ceil',
  multiWinBonus: { double: 5, triple: 10 },
  reverse: { enabled: true, double: 10, triple: 20 },
  dealer: { enabled: true, drawKeepsDealer: true, drawAddsStreak: true },
  water: { enabled: true, per: 25, take: 1, timing: 'settle' },
  falseWinPenalty: 60,
  rounds: 4,
  swapSettle: 'player',
};

export function withRules(patch: {
  base?: number;
  la?: Partial<Rules['la']>;
  rounding?: Rounding;
  multiWinBonus?: Partial<Rules['multiWinBonus']>;
  reverse?: Partial<Rules['reverse']>;
  dealer?: Partial<Rules['dealer']>;
  water?: Partial<Rules['water']>;
  falseWinPenalty?: number;
  rounds?: number;
  swapSettle?: Rules['swapSettle'];
}): Rules {
  const d = DEFAULT_RULES;
  return {
    base: patch.base ?? d.base,
    la: { ...d.la, ...patch.la },
    rounding: patch.rounding ?? d.rounding,
    multiWinBonus: { ...d.multiWinBonus, ...patch.multiWinBonus },
    reverse: { ...d.reverse, ...patch.reverse },
    dealer: { ...d.dealer, ...patch.dealer },
    water: { ...d.water, ...patch.water },
    falseWinPenalty: patch.falseWinPenalty ?? d.falseWinPenalty,
    rounds: patch.rounds ?? d.rounds,
    swapSettle: patch.swapSettle ?? d.swapSettle,
  };
}

export function halfOf(amount: number, rounding: Rounding): number {
  const h = amount / 2;
  if (rounding === 'ceil') return Math.ceil(h);
  if (rounding === 'round') return Math.round(h);
  return h;
}
