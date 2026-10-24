// 我的找數：所有牌友圈、所有已埋數大局入面，我要俾／要收、未轉嘅數，同埋舊紀錄未找
import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { PayMethod } from '../lib/payMethods.ts';
import { markPaid } from '../lib/data.ts';
import { remindPay, remindResult } from '../lib/fns.ts';
import { useProfile } from '../lib/live.ts';
import { useMyPay } from '../lib/pay.ts';
import type { PayItem } from '../lib/pay.ts';
import { Hint, Loading, TopBar, fmt, message } from '../ui.tsx';
import { DebtCards, PayRows, PersonSheet } from '../components/PayList.tsx';
import { money } from '../components/SettleScreen.tsx';
import { Link } from '../lib/router.tsx';

const md = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

export function MyPayView({ me, items, legacy, names, emails, pays, loading, onToggle, busyKey, onRemind }: {
  me: string; items: PayItem[]; legacy: { gid: string; gname: string; sid: string; sname: string; at: number; fan: number; cash: number }[];
  names: Record<string, string>; emails: Record<string, string>; pays?: Record<string, PayMethod[]>; loading: boolean; onToggle?: (it: PayItem, on: boolean) => void; busyKey?: string;
  /** 催找數：回覆一句結果 */
  onRemind?: (items: PayItem[]) => Promise<string>;
}) {
  const [who, setWho] = useState<{ ids: string[]; amount: number } | null>(null);
  const pp = { me, names, emails, pays };
  const open = items.filter((x) => !x.paid);
  const toPay = open.filter((x) => x.dir === 'pay');
  const toGet = open.filter((x) => x.dir === 'get');
  const sum = (l: PayItem[]) => l.reduce((a, x) => a + x.amount, 0);
  const unpaidSessions = new Set(open.map((x) => `${x.gid}/${x.sid}`)).size;

  return (
    <main className="page">
      <TopBar title="找數" />
      {loading && !items.length ? <Loading /> : (
        <>
          <section className="pay-summary">
            <div className="pay-card loss"><small>你要俾</small><b className="num">{money(sum(toPay))}</b><span>{toPay.length} 筆</span></div>
            <div className="pay-card gain"><small>你要收</small><b className="num">{money(sum(toGet))}</b><span>{toGet.length} 筆</span></div>
            <div className="pay-card"><small>未找大局</small><b className="num">{unpaidSessions}</b><span>場</span></div>
          </section>

          {toGet.length > 0 && (
            <section className="stack">
              <h2 className="section-head">要俾你</h2>
              <DebtCards items={toGet} pp={pp} label={(n) => `${n} 要俾你`} tone="gain" onRemind={onRemind} canRemind={(it) => it.dir === 'get'} onPerson={(ids, amount) => setWho({ ids, amount })} />
            </section>
          )}
          {toPay.length > 0 && (
            <section className="stack">
              <h2 className="section-head">你要俾</h2>
              <DebtCards items={toPay} pp={pp} label={(n) => `${n} 要俾`} onPerson={(ids, amount) => setWho({ ids, amount })} />
            </section>
          )}

          <section className="stack">
            <h2 className="section-head">未轉（{open.length}）</h2>
            {open.length ? <PayRows items={open} pp={pp} showSession busyKey={busyKey} canToggle={(it) => it.dir === 'pay' || it.dir === 'get'} onToggle={onToggle} /> : <p className="muted">冇未過嘅數，好嘢！</p>}
          </section>

          {legacy.length > 0 && (
            <section className="stack">
              <h2 className="section-head">舊紀錄未找（{legacy.length}）</h2>
              <ul className="list exp-list">
                {legacy.map((l) => (
                  <li key={l.sid} className="exp-row">
                    <Link to={`/g/${l.gid}/s/${l.sid}`} className="row-link">
                      <span className="grow exp-text"><span>{l.sname || md(l.at)}</span><small className="muted">{l.gname} · 只有總數，冇轉賬明細</small></span>
                      <span className="recent-right"><b className={`num ${l.fan > 0 ? 'gain' : 'loss'}`}>{fmt(l.fan)} 番</b><small className="muted">約 {money(l.cash, true)}</small></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {items.some((x) => x.paid) && (
            <section className="stack">
              <h2 className="section-head">已轉（{items.filter((x) => x.paid).length}）</h2>
              <PayRows items={items.filter((x) => x.paid)} pp={pp} showSession busyKey={busyKey} canToggle={(it) => it.dir === 'pay' || it.dir === 'get'} onToggle={onToggle} />
            </section>
          )}
          <Hint>只計已經埋咗數嘅大局（麻雀＋水＋開支合併）。同一班人幾場嘅數會合埋一張卡，撳開睇邊日幾多；轉賬就喺「未轉」逐筆標記。人哋欠你錢可以撳「催找數」，佢部機會收到通知（每筆 24 個鐘最多催一次）。</Hint>
        </>
      )}
      {who && <PersonSheet ids={who.ids} pp={pp} amount={who.amount} onClose={() => setWho(null)} />}
    </main>
  );
}

export default function MyPayPage({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const data = useMyPay(profile.loading ? null : user.uid, profile.data.groups, tick);
  const remindText = async (items: PayItem[]) => remindResult(await remindPay(items.map((it) => ({ g: it.gid, s: it.sid, key: it.key }))));
  return (
    <>
      <MyPayView
        me={user.uid}
        items={data.items}
        legacy={data.legacy}
        names={data.names}
        emails={data.emails}
        pays={data.pays}
        loading={profile.loading || data.loading}
        busyKey={busy}
        onRemind={remindText}
        onToggle={async (it, on) => {
          setBusy(it.key); setError('');
          try { await markPaid(it.gid, it.sid, it.key, user.uid, on, on && it.confirm && it.dir === 'pay'); setTick((t) => t + 1); } catch (err) { setError(message(err)); } finally { setBusy(''); }
        }}
      />
      {error && <p className="error page">{error}</p>}
    </>
  );
}
