// 數據獎：食糊王、自摸王、出銃王、最大一鋪、連莊王、拉最耐、打得幾快…
// 每張卡一個顏色，刻字似牌
import type { PlayStats } from '../lib/score.ts';
import { minutes, topOf } from '../lib/score.ts';

interface Award {
  key: string;
  mark: string;
  title: string;
  who: string;
  value: string;
  cls: string;
}

export function awardsOf(play: PlayStats, name: (id: string) => string): Award[] {
  const out: Award[] = [];
  const w = topOf(play.wins);
  if (w) out.push({ key: 'win', mark: '食', title: '食糊王', who: name(w[0]), value: `${w[1]} 次`, cls: 'aw-gold' });
  const sd = topOf(play.selfDraws);
  if (sd) out.push({ key: 'self', mark: '摸', title: '自摸王', who: name(sd[0]), value: `${sd[1]} 次`, cls: 'aw-green' });
  const di = topOf(play.dealIns);
  if (di) out.push({ key: 'deal', mark: '銃', title: '出銃王', who: name(di[0]), value: `${di[1]} 次`, cls: 'aw-red' });
  if (play.biggest) out.push({ key: 'big', mark: '大', title: '最大一鋪', who: name(play.biggest.player), value: `${play.biggest.fan} 番`, cls: 'aw-purple' });
  if (play.maxStreak && play.maxStreak.n > 0) out.push({ key: 'streak', mark: '莊', title: '連莊王', who: name(play.maxStreak.player), value: `連 ${play.maxStreak.n}`, cls: 'aw-orange' });
  if (play.maxChain && play.maxChain.count > 1) out.push({ key: 'chain', mark: '拉', title: '拉最耐', who: `${name(play.maxChain.puller)} 拉 ${name(play.maxChain.pulled)}`, value: `${play.maxChain.count} 拉`, cls: 'aw-blue' });
  const fw = topOf(play.falseWins);
  if (fw) out.push({ key: 'false', mark: '詐', title: '詐糊王', who: name(fw[0]), value: `${fw[1]} 次`, cls: 'aw-pink' });
  if (play.roundMs.length) {
    const avg = play.roundMs.reduce((a, b) => a + b, 0) / play.roundMs.length;
    out.push({ key: 'round', mark: '圈', title: '每圈平均', who: `最快 ${minutes(Math.min(...play.roundMs))} 分鐘・四圈約 ${Math.round((avg * 4) / 60000)} 分鐘`, value: `${minutes(avg)} 分鐘`, cls: 'aw-teal' });
  }
  if (play.hands > 1 && play.playMs > 0) {
    out.push({ key: 'hand', mark: '鋪', title: '每鋪平均', who: `共 ${play.hands} 鋪`, value: `${Math.max(1, Math.round(play.playMs / play.hands / 60000))} 分鐘`, cls: 'aw-slate' });
  }
  return out;
}

export default function Awards({ play, name }: { play: PlayStats; name: (id: string) => string }) {
  const list = awardsOf(play, name);
  if (!list.length) return <p className="muted small">未有足夠紀錄。</p>;
  return (
    <div className="awards">
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

/** 每人：食糊、自摸、出銃、最大一鋪 */
export function PlayTable({ play, ids, name }: { play: PlayStats; ids: string[]; name: (id: string) => string }) {
  const rows = ids
    .map((id) => ({ id, w: play.wins[id] ?? 0, s: play.selfDraws[id] ?? 0, d: play.dealIns[id] ?? 0, b: play.best[id] ?? 0 }))
    .filter((r) => r.w || r.s || r.d)
    .sort((a, b) => b.w - a.w || a.d - b.d);
  if (!rows.length) return null;
  return (
    <div className="ledger settle-table play-table">
      <div className="st-row st-head five"><span>玩家</span><span>食糊</span><span>自摸</span><span>出銃</span><span>最大</span></div>
      {rows.map((r) => (
        <div key={r.id} className="st-row five">
          <span className="ellipsis">{name(r.id)}</span>
          <span className="num">{r.w}</span>
          <span className="num gain">{r.s}</span>
          <span className="num loss">{r.d}</span>
          <span className="num">{r.b || '–'}</span>
        </div>
      ))}
    </div>
  );
}
