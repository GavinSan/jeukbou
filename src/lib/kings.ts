// 大局層面嘅「王」：食糊王、自摸王、最大王、最細王、連莊王、拉王、響王（一炮多響嗰個出銃，負面）…（同數就冇）
// 大局頁、枱頁顯示；雀力分都用（淨係正面嘅王先加分）
import type { PlayStats } from './score.ts';

/** 特別事項王：每款一個 */
export const SPECIAL_KINGS: [string, string, string][] = [
  ['flower', '花', '花王'], ['grass', '草', '草王'], ['kong', '槓', '槓王'], ['heaven', '天', '天槓王'],
  ['triple', '骰', '圍骰王'], ['dice123', '三', '一二三王'], ['pong', '碰', '叫碰王'], ['chase', '追', '被追王'], ['forgot', '忘', '唔記得王'],
];

/** 獨領風騷先算（同數就冇） */
export const lead = (rec: Record<string, number>) => {
  const e = Object.entries(rec).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!e.length || (e[1] && e[1][1] === e[0][1])) return null;
  return e[0][0];
};

/** 全場食糊王、自摸王（同數就冇） */
export function kingsOf(play: PlayStats): { win: string | null; self: string | null } {
  return { win: lead(play.wins), self: lead(play.selfDraws) };
}

/** 一個王銜頭：good = 正面（之後計雀力分用；出銃王、響王、詐糊王唔算） */
export interface KingTag { key: string; title: string; cls: string; good: boolean }

/** 全場所有王（大局層面）：每人有咩銜頭 */
export function kingTagsOf(play: PlayStats): Record<string, KingTag[]> {
  const out: Record<string, KingTag[]> = {};
  const give = (id: string | null | undefined, t: KingTag) => { if (id) (out[id] ??= []).push(t); };
  give(lead(play.wins), { key: 'win', title: '食糊王', cls: 'win', good: true });
  give(lead(play.selfDraws), { key: 'self', title: '自摸王', cls: 'self', good: true });
  give(play.biggest?.player, { key: 'big', title: '最大王', cls: 'big', good: true });
  if (play.smallest && play.smallest.player !== play.biggest?.player) give(play.smallest.player, { key: 'small', title: '最細王', cls: 'small', good: true });
  if (play.maxStreak && play.maxStreak.n > 0) give(play.maxStreak.player, { key: 'streak', title: '連莊王', cls: 'streak', good: true });
  give(lead(play.pulls ?? {}), { key: 'pull', title: '拉王', cls: 'pull', good: true });
  give(lead(play.multiWins ?? {}), { key: 'multi', title: '響王', cls: 'multi', good: false });
  give(lead(play.dealIns), { key: 'deal', title: '出銃王', cls: 'deal', good: false });
  give(lead(play.falseWins), { key: 'false', title: '詐糊王', cls: 'false', good: false });
  for (const [art, , title] of SPECIAL_KINGS) give(lead(play.specialBy?.[art] ?? {}), { key: `sp-${art}`, title, cls: 'sp', good: art !== 'forgot' && art !== 'chase' });
  return out;
}


/** 正面王加幾多雀力分（淨係大局嘅王；枱入面嘅唔計） */
export const KING_POINTS: Record<string, number> = { win: 8, self: 8, big: 10, streak: 6, pull: 5, small: 3 };
export const kingPoints = (keys: string[]) => keys.reduce((a, k) => a + (KING_POINTS[k] ?? (k.startsWith('sp-') ? 3 : 0)), 0);
