// 麻雀打法（牌型）：開牌友圈嗰陣揀，之後唔改得。
// 而家正式支援：港式台牌（雀簿本身嘅計法）。其他打法暫時淨係超級管理員／示範見到（研究緊計番同特別事項）。
export type Variant = 'hktw' | 'canto' | 'tw16' | 'riichi' | 'paoma';

export const VARIANTS: { key: Variant; name: string; note: string; ready: boolean; specials: boolean }[] = [
  { key: 'hktw', name: '港式台牌', note: '香港打法嘅台灣牌：番數、拉、抽水（雀簿預設）', ready: true, specials: true },
  { key: 'canto', name: '廣東牌', note: '十三張、三番起糊、番數翻倍計錢、半辣／全銃', ready: false, specials: false },
  { key: 'tw16', name: '台牌', note: '十六張、底＋台、連莊拉莊', ready: false, specials: true },
  { key: 'riichi', name: '日麻', note: '立直、符同翻、點棒', ready: false, specials: false },
  { key: 'paoma', name: '跑馬仔', note: '快局、雞糊都計、定額找數', ready: false, specials: false },
];

export const variantOf = (v?: string | null): (typeof VARIANTS)[number] => VARIANTS.find((x) => x.key === v) ?? VARIANTS[0];
