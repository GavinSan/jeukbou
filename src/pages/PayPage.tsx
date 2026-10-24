// 一個大局嘅轉賬詳情：每筆邊個俾邊個、收款 email、已轉未轉
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { PayMethod } from '../lib/payMethods.ts';
import { markPaid, savePayout } from '../lib/data.ts';
import type { Payout } from '../lib/data.ts';
import { computePayout, loadTeams } from '../lib/settleLoad.ts';
import { samePayout } from '../lib/settle.ts';
import { useGroup, useMembers, useSession } from '../lib/live.ts';
import { itemsOf } from '../lib/pay.ts';
import { Link } from '../lib/router.tsx';
import { Hint, Loading, TopBar, message } from '../ui.tsx';
import { useSuperAdmin } from '../lib/admin.ts';
import { PayRows } from '../components/PayList.tsx';
import { money } from '../components/SettleScreen.tsx';
import { remindPay, remindResult } from '../lib/fns.ts';
import type { PayItem } from '../lib/pay.ts';

export default function PayPage({ user, groupId, sessionId }: { user: User; groupId: string; sessionId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const members = useMembers(groupId);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const admin = useSuperAdmin(user.uid);
  const back = `/g/${groupId}/s/${sessionId}`;
  const onRemind = async (list: PayItem[]) => remindResult(await remindPay(list.map((it) => ({ g: it.gid, s: it.sid, key: it.key }))));
  // 已埋數：每次打開都用最新資料計一次（快照冇、舊、或者錯都會更正），唔同就存低
  const [calc, setCalc] = useState<Payout | null>(null);
  const needCalc = !!group.data && !!session.data && !!session.data.closed && !session.data.legacy && !members.loading;
  useEffect(() => {
    if (!needCalc || !group.data || !session.data) return;
    let alive = true;
    const g = group.data;
    const s = session.data;
    loadTeams(groupId).catch(() => []).then((teams) => computePayout(g, s, members.data, teams)).then((po) => {
      if (!alive || !po) return;
      setCalc(po);
      if (!samePayout(po, s.payout)) savePayout(groupId, sessionId, po).catch(() => undefined);
    }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needCalc]);
  if (!group.data || !session.data) return <main className="page"><TopBar back={back} />{session.error ? <p className="error">{session.error}</p> : <Loading />}</main>;
  const g = group.data;
  const s = calc ? { ...session.data, payout: calc } : session.data;
  const items = itemsOf(g, s, user.uid);
  const names: Record<string, string> = { ...(s.payout?.names ?? {}) };
  const emails: Record<string, string> = {};
  const pays: Record<string, PayMethod[]> = {};
  for (const m of members.data) { names[m.uid] = m.name; if (m.payEmail) emails[m.uid] = m.payEmail; if (m.pay?.length) pays[m.uid] = m.pay; }
  const pp = { me: user.uid, names, emails, pays };
  const mine = items.filter((x) => x.dir !== 'other');
  const myPay = mine.filter((x) => x.dir === 'pay' && !x.paid).reduce((a, x) => a + x.amount, 0);
  const myGet = mine.filter((x) => x.dir === 'get' && !x.paid).reduce((a, x) => a + x.amount, 0);
  const done = items.filter((x) => x.paid).length;
  // 俾錢、收錢嘅人，同局主、場主、超級管理員都可以標記
  const manager = admin || g.ownerId === user.uid || s.createdBy === user.uid;
  const canToggle = (it: { dir: string }) => manager || it.dir === 'pay' || it.dir === 'get';

  async function toggle(it: PayItem, on: boolean) {
    const key = it.key;
    setBusy(key); setError('');
    // 俾錢嘅人撳「已轉」：牌友圈要確認嘅話就變「等確認」；收錢嘅人、局主、場主撳就即刻搞掂
    try { await markPaid(groupId, sessionId, key, user.uid, on, on && it.confirm && it.dir === 'pay'); } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }

  return (
    <main className="page">
      <TopBar back={`/g/${groupId}/s/${sessionId}/settle`} title={<div className="stack tight"><h1>轉賬</h1><span className="muted small">{s.name}</span></div>} />
      {!s.payout || (needCalc && !calc) ? (
        <section className="panel">
          {s.closed ? <Loading /> : <p className="muted">未埋數。埋數之後，轉賬會喺呢度出現。</p>}
          <Link to={`/g/${groupId}/s/${sessionId}/settle`} className="btn">去埋數頁</Link>
        </section>
      ) : (
        <>
          <section className="pay-summary">
            <div className="pay-card loss"><small>你要俾</small><b className="num">{money(myPay)}</b></div>
            <div className="pay-card gain"><small>你要收</small><b className="num">{money(myGet)}</b></div>
            <div className="pay-card"><small>已轉</small><b className="num">{done}/{items.length}</b></div>
          </section>
          {mine.length > 0 && (
            <section className="stack">
              <h2 className="section-head">同你有關</h2>
              <PayRows items={mine} pp={pp} busyKey={busy} canToggle={canToggle} onToggle={toggle} onRemind={onRemind} canRemind={(it) => it.dir === 'get' || admin} />
            </section>
          )}
          <section className="stack">
            <h2 className="section-head">全部轉賬</h2>
            <PayRows items={[...items].sort((a, b) => Number(b.dir !== 'other') - Number(a.dir !== 'other'))} pp={pp} busyKey={busy} canToggle={canToggle} onToggle={toggle} onRemind={onRemind} canRemind={(it) => it.dir === 'get' || admin} />
            <Hint>撳人名睇佢嘅 Interac email。轉咗就撳「標記已轉」{items.some((x) => x.confirm) ? '，收錢嘅人確認咗先算數（收錢嘅人亦可以直接撳「已收到」）' : ''}；俾錢、收錢嗰個、局主同場主都撳得，全部人都會見到。金額係麻雀＋水＋開支合併。</Hint>
          </section>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
