// 牌友圈埋數：成個牌友圈所有大局嘅找數（未埋數、待找數、已找清），同所有未轉嘅轉賬
import { useState } from 'react';
import type { User } from 'firebase/auth';
import { markPaid } from '../lib/data.ts';
import { remindPay, remindResult } from '../lib/fns.ts';
import { useGroup, useSessions } from '../lib/live.ts';
import { useGroupPay } from '../lib/pay.ts';
import type { PayItem } from '../lib/pay.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { Link } from '../lib/router.tsx';
import { Hint, Loading, TopBar, message } from '../ui.tsx';
import { DebtCards, PayRows } from '../components/PayList.tsx';
import { money } from '../components/SettleScreen.tsx';
import { SettingsButton } from '../components/Settings.tsx';

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

export default function GroupPayPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const sessions = useSessions(groupId);
  const admin = useSuperAdmin(user.uid);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showPaid, setShowPaid] = useState(false);
  const data = useGroupPay(user.uid, groupId, tick);
  const g = group.data;
  if (!g) return <main className="page"><TopBar back={`/g/${groupId}`} /><Loading /></main>;

  const pp = { me: user.uid, names: data.names, emails: data.emails, pays: data.pays };
  // 同自己有關嘅排最頂
  const open = data.items.filter((x) => !x.paid).sort((a, b) => Number(b.dir !== 'other') - Number(a.dir !== 'other'));
  const paid = data.items.filter((x) => x.paid);
  const sum = (l: PayItem[]) => l.reduce((a, x) => a + x.amount, 0);
  const toPay = open.filter((x) => x.dir === 'pay');
  const toGet = open.filter((x) => x.dir === 'get');
  const hostOf = new Map(sessions.data.map((s) => [s.id, s.createdBy]));
  const onRemind = async (items: PayItem[]) => remindResult(await remindPay(items.map((it) => ({ g: it.gid, s: it.sid, key: it.key }))));
  // 催找數：收錢嗰個，或者超級管理員
  const canRemind = (it: PayItem) => it.dir === 'get' || admin;
  const canToggle = (it: PayItem) => admin || g.ownerId === user.uid || hostOf.get(it.sid) === user.uid || it.dir !== 'other';

  // 每個大局嘅狀態
  const bySession = new Map<string, { done: number; total: number }>();
  for (const x of data.items) {
    const r = bySession.get(x.sid) ?? { done: 0, total: 0 };
    r.total += 1;
    if (x.paid) r.done += 1;
    bySession.set(x.sid, r);
  }
  const list = [...sessions.data].filter((s) => !s.legacy).reverse();
  const notClosed = list.filter((s) => !s.closed);
  const waiting = list.filter((s) => s.closed && (bySession.get(s.id)?.total ?? 0) > (bySession.get(s.id)?.done ?? 0));
  const cleared = list.filter((s) => s.closed && !waiting.includes(s));

  async function toggle(it: PayItem, on: boolean) {
    setBusy(it.key); setError('');
    try { await markPaid(it.gid, it.sid, it.key, user.uid, on, on && it.confirm && it.dir === 'pay'); setTick((t) => t + 1); } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }

  const row = (s: (typeof list)[number], note: string, cls = '') => (
    <Link key={s.id} to={s.closed ? `/g/${groupId}/s/${s.id}/pay` : `/g/${groupId}/s/${s.id}/settle`} className="listrow">
      <span className="grow">{s.name}<small className="muted">　{s.createdAt ? md(s.createdAt.toMillis()) : ''}</small></span>
      <span className={`pay-status ${cls}`}>{note}</span>
      <span className="chev" aria-hidden="true">›</span>
    </Link>
  );

  return (
    <main className="page">
      <TopBar back={`/g/${groupId}`} title={<div className="stack tight"><h1>埋數</h1><span className="muted small">{g.name}・所有大局</span></div>} right={<SettingsButton />} />
      {data.loading ? <Loading /> : (
        <>
          <section className="pay-summary">
            <div className="pay-card loss"><small>你要俾</small><b className="num">{money(sum(toPay))}</b><span>{toPay.length} 筆</span></div>
            <div className="pay-card gain"><small>你要收</small><b className="num">{money(sum(toGet))}</b><span>{toGet.length} 筆</span></div>
            <div className="pay-card"><small>待找數</small><b className="num">{waiting.length}</b><span>場</span></div>
          </section>

          {(notClosed.length > 0 || waiting.length > 0) && (
            <section className="stack">
              <h2 className="section-head">大局</h2>
              <div className="list">
                {notClosed.map((s) => row(s, '未埋數', 'live'))}
                {waiting.map((s) => { const r = bySession.get(s.id)!; return row(s, `待找數 ${r.done}/${r.total}`); })}
              </div>
            </section>
          )}

          <section className="stack">
            <h2 className="section-head">邊個要找數</h2>
            {open.length ? <DebtCards items={open} pp={pp} onRemind={onRemind} canRemind={canRemind} /> : <p className="muted">全部找清，好嘢！</p>}
          </section>

          <section className="stack">
            <h2 className="section-head">未轉（{open.length}）</h2>
            {open.length ? <PayRows items={open} pp={pp} showSession busyKey={busy} canToggle={canToggle} onToggle={toggle} /> : null}
          </section>

          {(paid.length > 0 || cleared.length > 0) && (
            <section className="stack">
              <button type="button" className="more-toggle" aria-expanded={showPaid} onClick={() => setShowPaid((v) => !v)}>
                <span className="grow">已找清嘅大局同已轉</span>
                <span className="more-count">{paid.length}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: showPaid ? 'rotate(180deg)' : undefined }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {showPaid && (
                <>
                  {cleared.length > 0 && <div className="list">{cleared.map((s) => row(s, '已找清', 'done'))}</div>}
                  {paid.length > 0 && <PayRows items={paid} pp={pp} showSession busyKey={busy} canToggle={canToggle} onToggle={toggle} />}
                </>
              )}
            </section>
          )}
          {error && <p className="error">{error}</p>}
          <Hint>入大局之後撳「埋數」就係嗰個大局嘅埋數；喺呢度睇成個牌友圈。俾錢、收錢嘅人、局主同場主都可以標記已轉。</Hint>
        </>
      )}
    </main>
  );
}
