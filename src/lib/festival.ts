// 節日風格：超級管理員喺管理頁開（config/festival），全部人即刻見到節日裝飾。
// 節日前大約一個月，app 會提超級管理員換。
export type FestivalKey = 'halloween' | 'christmas' | 'newyear' | 'lny' | 'easter';

export interface Festival {
  key: FestivalKey;
  name: string;
  /** 背景飄嘅嘢 */
  deco: string[];
  /** 主頁頂嘅祝福 */
  greet: (year: number) => string;
  /** 某一年嘅日子（月份由 0 計） */
  day: (year: number) => Date | null;
}

// 農曆新年、復活節每年唔同：寫低未來幾年
const LNY: Record<number, [number, number]> = { 2026: [1, 17], 2027: [1, 6], 2028: [0, 26], 2029: [1, 13], 2030: [1, 3] };
const EASTER: Record<number, [number, number]> = { 2026: [3, 5], 2027: [2, 28], 2028: [3, 16], 2029: [3, 1], 2030: [3, 21] };
const ANIMAL = ['鼠', '牛', '虎', '兔', '龍', '蛇', '馬', '羊', '猴', '雞', '狗', '豬'];

export const FESTIVALS: Festival[] = [
  { key: 'halloween', name: '萬聖節', deco: ['🎃', '🦇', '👻', '🕸️', '🍬'], greet: () => '萬聖節快樂 🎃 今晚食糊唔好俾鬼嚇親', day: (y) => new Date(y, 9, 31) },
  { key: 'christmas', name: '聖誕節', deco: ['❄️', '🎄', '⭐', '🎁', '❅'], greet: () => '聖誕快樂 🎄 打麻雀都要開開心心', day: (y) => new Date(y, 11, 25) },
  { key: 'newyear', name: '新年', deco: ['🎆', '✨', '🥂', '🎉', '🎇'], greet: (y) => `${y} 新年快樂 🎆 新一年手風順`, day: (y) => new Date(y, 0, 1) },
  { key: 'lny', name: '農曆新年', deco: ['🧧', '🏮', '🍊', '🧨', '🌸'], greet: (y) => `恭喜發財 🧧 ${ANIMAL[((y - 2020) % 12 + 12) % 12]}年大吉，打牌贏到笑`, day: (y) => (LNY[y] ? new Date(y, LNY[y][0], LNY[y][1]) : null) },
  { key: 'easter', name: '復活節', deco: ['🐣', '🌷', '🥚', '🐰', '🌼'], greet: () => '復活節快樂 🐣', day: (y) => (EASTER[y] ? new Date(y, EASTER[y][0], EASTER[y][1]) : null) },
];

export const festivalOf = (k?: string | null) => FESTIVALS.find((f) => f.key === k) ?? null;

/** 未來 45 日內嘅節日（最近嗰個） */
export function upcomingFestival(now = new Date()): { f: Festival; at: Date; days: number } | null {
  let best: { f: Festival; at: Date; days: number } | null = null;
  for (const f of FESTIVALS) {
    for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
      const at = f.day(y);
      if (!at) continue;
      const days = Math.ceil((at.getTime() - now.getTime()) / 86400000);
      if (days < -1 || days > 45) continue;
      if (!best || days < best.days) best = { f, at, days };
    }
  }
  return best;
}
