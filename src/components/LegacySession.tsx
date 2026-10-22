// 匯入嘅舊紀錄：冇枱，只有每人番數同水
import type { Group, Member } from '../lib/data.ts';
import { legacyMap } from '../lib/data.ts';
import { TopBar, fmt } from '../ui.tsx';
import { Link } from '../lib/router.tsx';
import type { Session } from '../lib/data.ts';

export default function LegacySession({ group, session, members, back, me }: { group: Group; session: Session; members: Member[]; back: string; me: string }) {
  const lg = session.legacy!;
  const map = legacyMap(group, members);
  const nameOf = (key: string) => {
    const uid = map[key];
    const m = uid ? members.find((x) => x.uid === uid) : undefined;
    return { label: m?.name ?? group.legacyNames?.[key] ?? key, old: group.legacyNames?.[key] ?? key, linked: !!m, mine: uid === me };
  };
  const rows = Object.entries(lg.totals).map(([k, v]) => ({ k, v: Number(v), ...nameOf(k) })).sort((a, b) => b.v - a.v);
  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>{session.name}</h1><span className="muted small">由 Google Sheet 匯入 · {rows.length} 人</span></div>} />
      <div className="closed-stamp">
        <span className="stamp">{lg.paid ? '已找數' : '未找數'}</span>
      </div>
      {rows.some((r) => !r.linked) && <Link to={`/g/${group.id}/players`} className="link-card"><span className="grow"><b>有人未配對</b><small>去「對應玩家」一次過配對晒（同名嘅一齊配）</small></span><span className="chev" aria-hidden="true">›</span></Link>}
      <div className="ledger settle-table">
        <div className="st-row st-head three"><span>玩家</span><span>舊紀錄名</span><span>番</span></div>
        {rows.map((r) => (
          <div key={r.k} className={`st-row three${r.mine ? ' me' : ''}`}>
            <span className="ellipsis">{r.label}</span>
            <span className="muted small ellipsis">{r.linked ? r.old : '未配對'}</span>
            <b className={`num ${r.v > 0 ? 'gain' : r.v < 0 ? 'loss' : 'even'}`}>{fmt(r.v)}</b>
          </div>
        ))}
        <div className="st-row three st-water"><span>水</span><span /><b className="num">{lg.water}</b></div>
      </div>
    </main>
  );
}
