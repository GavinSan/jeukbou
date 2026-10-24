// 全場數據：幾張獎牌（最大一鋪、連莊、出銃、詐糊、拉、速度）＋ 每人排名（食糊、自摸可以排序）
import { useState } from 'react';
import type { PlayStats } from '../lib/score.ts';
import { minutes, topOf } from '../lib/score.ts';
import { SPECIAL_KINGS } from '../lib/kings.ts';

interface Award {
  key: string;
  mark: string;
  title: string;
  who: string;
  value: string;
  cls: string;
}

export { kingTagsOf, kingsOf } from '../lib/kings.ts';
export type { KingTag } from '../lib/kings.ts';

/** 每圈幾耐：「18 分/圈」 */
export function paceOf(roundMs: number[]): string | null {
  if (!roundMs.length) return null;
  return `${minutes(roundMs.reduce((a, b) => a + b, 0) / roundMs.length)} 分/圈`;
}

export function awardsOf(play: PlayStats, name: (id: string) => string): Award[] {
  const out: Award[] = [];
  const w = topOf(play.wins);
  if (w) out.push({ key: 'win', mark: '食', title: '食糊王', who: name(w[0]), value: `${w[1]} 次`, cls: 'aw-gold' });
  const sd = topOf(play.selfDraws);
  if (sd) out.push({ key: 'self', mark: '摸', title: '自摸王', who: name(sd[0]), value: `${sd[1]} 次`, cls: 'aw-green' });
  const di = topOf(play.dealIns);
  if (di) out.push({ key: 'deal', mark: '銃', title: '出銃王', who: name(di[0]), value: `${di[1]} 次`, cls: 'aw-red' });
  if (play.biggest) out.push({ key: 'big', mark: '大', title: '最大王', who: name(play.biggest.player), value: `${play.biggest.fan} 番`, cls: 'aw-purple' });
  if (play.smallest && play.smallest.player !== play.biggest?.player) out.push({ key: 'small', mark: '細', title: '最細王', who: name(play.smallest.player), value: `${play.smallest.fan} 番`, cls: 'aw-teal' });
  const mw = topOf(play.multiWins ?? {});
  if (mw) out.push({ key: 'multi', mark: '響', title: '響王', who: name(mw[0]), value: `${mw[1]} 次`, cls: 'aw-orange' });
  if (play.maxStreak && play.maxStreak.n > 0) out.push({ key: 'streak', mark: '莊', title: '連莊王', who: name(play.maxStreak.player), value: `連 ${play.maxStreak.n}`, cls: 'aw-orange' });
  const pl = topOf(play.pulls ?? {});
  if (pl) out.push({ key: 'pull', mark: '拉', title: '拉王', who: name(pl[0]), value: `${pl[1]} 次`, cls: 'aw-blue' });
  const fw = topOf(play.falseWins);
  if (fw) out.push({ key: 'false', mark: '詐', title: '詐糊王', who: name(fw[0]), value: `${fw[1]} 次`, cls: 'aw-pink' });
  for (const [art, mark, title] of SPECIAL_KINGS) {
    const top = topOf(play.specialBy?.[art] ?? {});
    if (top) out.push({ key: `sp-${art}`, mark, title, who: name(top[0]), value: `${top[1]} 次`, cls: `aw-sp aw-sp-${art}` });
  }
  const wins = Object.values(play.wins).reduce((a, b) => a + b, 0);
  if (play.fanTotal && wins) out.push({ key: 'fans', mark: '番', title: '全場總番', who: `平均每糊 ${Math.round(play.fanTotal / wins)} 番`, value: `${play.fanTotal} 番`, cls: 'aw-slate' });
  if (play.hands > 0) out.push({ key: 'draws', mark: '流', title: '流局', who: `共 ${play.hands} 鋪`, value: `${play.draws ?? 0} 次`, cls: 'aw-sp-forgot' });
  const pace = paceOf(play.roundMs);
  if (pace) {
    const perHand = play.hands > 1 && play.playMs > 0 ? `${Math.max(1, Math.round(play.playMs / play.hands / 60000))} 分/鋪` : `${play.roundMs.length} 圈`;
    out.push({ key: 'pace', mark: '速', title: '速度', who: perHand, value: pace, cls: 'aw-teal' });
  }
  return out;
}

export default function Awards({ play, name }: { play: PlayStats; name: (id: string) => string }) {
  const list = awardsOf(play, name);
  if (!list.length) return null;
  return (
    <div className="awards compact">
      {list.map((a, i) => (
        <div key={a.key} className={`award ${a.cls}`} style={{ animationDelay: `${i * 0.05}s` }}>
          <span className="award-mark" aria-hidden="true">{a.mark}</span>
          <span className="award-body">
            <small>{a.title}</small>
            <b className="num">{a.value}</b>
            <span className="award-who">{a.who}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

type SortKey = 'w' | 's' | 'd' | 'b';
const COLS: [SortKey, string][] = [['w', '食糊'], ['s', '自摸'], ['d', '出銃'], ['b', '最大']];

/** 全場排名：食糊、自摸、出銃、最大一鋪；撳表頭排序，第一名有皇冠 */
export function PlayTable({ play, ids, name, me }: { play: PlayStats; ids: string[]; name: (id: string) => string; me?: string | null }) {
  const [sort, setSort] = useState<SortKey>('w');
  const rows = ids
    .map((id) => ({ id, w: play.wins[id] ?? 0, s: play.selfDraws[id] ?? 0, d: play.dealIns[id] ?? 0, b: play.best[id] ?? 0 }))
    .filter((r) => r.w || r.s || r.d);
  if (!rows.length) return null;
  rows.sort((a, b) => b[sort] - a[sort] || b.w - a.w || a.d - b.d);
  const top: Record<SortKey, number> = { w: 0, s: 0, d: 0, b: 0 };
  for (const k of ['w', 's', 'd', 'b'] as SortKey[]) top[k] = Math.max(...rows.map((r) => r[k]));
  const crown = (k: SortKey, v: number) => v > 0 && v === top[k] && rows.filter((r) => r[k] === v).length === 1;
  return (
    <div className="ledger settle-table play-table">
      <div className="st-row st-head five">
        <span>玩家</span>
        {COLS.map(([k, label]) => (
          <button key={k} type="button" className={`sort-th${sort === k ? ' on' : ''}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{label}{sort === k ? ' ↓' : ''}</button>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={r.id} className={`st-row five${r.id === me ? ' me' : ''}`}>
          <span className="ellipsis"><span className="rank-no">{i + 1}</span>{name(r.id)}</span>
          {COLS.map(([k]) => (
            <span key={k} className={`num${k === 's' ? ' gain' : k === 'd' ? ' loss' : ''}`}>
              <span className="crown-wrap">{crown(k, r[k]) && <span className="crown" aria-label="第一">👑</span>}{r[k] || '–'}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
