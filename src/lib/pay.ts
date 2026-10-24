// 找數：由每個已埋數大局嘅轉賬快照，計出「我要俾邊個幾多」「邊個要俾我」，同邊幾筆未轉
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type { PayMethod } from './payMethods.ts';
import { fs, legacyMap, paidState, payKey, savePayout, settleConfigOf } from './data.ts';
import { computePayout, loadTeams } from './settleLoad.ts';
import { PAYOUT_VERSION } from './settle.ts';
import type { Group, Member, Session } from './data.ts';
import { toGroupDoc, toMemberDoc, toSessionDoc } from './live.ts';

export interface PayItem {
  gid: string;
  gname: string;
  sid: string;
  sname: string;
  at: number;
  from: string;
  to: string;
  amount: number;
  key: string;
  /** 搞掂（收錢嘅人確認咗，或者唔使確認） */
  paid: boolean;
  /** 俾錢嘅人話轉咗，等收錢嘅人確認 */
  pending: boolean;
  /** 牌友圈要收錢嘅人確認 */
  confirm: boolean;
  /** 我係俾錢定收錢 */
  dir: 'pay' | 'get' | 'other';
  currency: string;
}

export interface LegacyOwe {
  gid: string;
  gname: string;
  sid: string;
  sname: string;
  at: number;
  fan: number;
  cash: number;
}

export interface PayData {
  loading: boolean;
  items: PayItem[];
  legacy: LegacyOwe[];
  names: Record<string, string>;
  emails: Record<string, string>;
  pays: Record<string, PayMethod[]>;
}

const has = (key: string, uid: string) => key.split(' + ').includes(uid);

/** 一個大局嘅轉賬（畀轉賬頁用） */
export function itemsOf(g: Pick<Group, 'id' | 'name' | 'settle'>, s: Session, uid: string): PayItem[] {
  if (!s.payout) return [];
  const confirm = !!(g.settle as { confirmPay?: boolean } | undefined)?.confirmPay;
  return s.payout.transfers.map((t) => ({
    gid: g.id, gname: g.name, sid: s.id, sname: s.name, at: s.createdAt?.toMillis() ?? s.payout!.at,
    from: t.from, to: t.to, amount: t.amount, key: payKey(t),
    paid: paidState(s.paid?.[payKey(t)]) === 'done', pending: paidState(s.paid?.[payKey(t)]) === 'pending', confirm,
    dir: has(t.from, uid) ? 'pay' : has(t.to, uid) ? 'get' : 'other', currency: s.payout!.currency,
  }));
}

async function loadGroup(gid: string, uid: string, all = false): Promise<{ items: PayItem[]; legacy: LegacyOwe[]; names: Record<string, string>; emails: Record<string, string>; pays: Record<string, PayMethod[]> } | null> {
  const gSnap = await getDoc(doc(fs(), 'groups', gid));
  if (!gSnap.exists()) return null;
  const g = toGroupDoc(gSnap.id, gSnap.data());
  const [mSnap, sSnap] = await Promise.all([getDocs(collection(fs(), 'groups', gid, 'members')), getDocs(collection(fs(), 'groups', gid, 'sessions'))]);
  const members: Member[] = mSnap.docs.map((d) => toMemberDoc(d.id, d.data()));
  const sessions: Session[] = sSnap.docs.map((d) => toSessionDoc(d.id, d.data()));
  const names: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const pays: Record<string, PayMethod[]> = {};
  for (const m of members) { names[m.uid] = m.name; if (m.payEmail) emails[m.uid] = m.payEmail; if (m.pay?.length) pays[m.uid] = m.pay; }
  const items: PayItem[] = [];
  const legacy: LegacyOwe[] = [];
  const lmap = legacyMap(g, members);
  const myKeys = Object.entries(lmap).filter(([, u]) => u === uid).map(([k]) => k);
  const perUnit = settleConfigOf(g).perUnit || 6;
  // 已埋數但未有快照（舊大局、未有人打開過埋數頁）：即刻計返，順手存低
  const missing = sessions.filter((s) => s.closed && !s.legacy && (!s.payout || (s.payout.v ?? 1) < PAYOUT_VERSION));
  if (missing.length) {
    const teams = await loadTeams(gid).catch(() => []);
    await Promise.all(missing.map(async (s) => {
      const po = await computePayout(g, s, members, teams).catch(() => null);
      if (!po) return;
      // 已轉標記：舊快照同新快照同一筆（同 key）就保留
      s.payout = po;
      savePayout(gid, s.id, po).catch(() => undefined);
    }));
  }
  for (const s of sessions) {
    if (s.payout) {
      Object.assign(names, Object.fromEntries(Object.entries(s.payout.names).filter(([k]) => !names[k])));
      items.push(...itemsOf(g, s, uid).filter((x) => all || x.dir !== 'other'));
    } else if (s.legacy && !s.legacy.paid && myKeys.length) {
      const fan = myKeys.reduce((a, k) => a + Number(s.legacy!.totals[k] ?? 0), 0);
      if (fan) legacy.push({ gid, gname: g.name, sid: s.id, sname: s.name, at: s.createdAt?.toMillis() ?? 0, fan, cash: Math.round((fan / perUnit) * 100) / 100 });
    }
  }
  return { items, legacy, names, emails, pays };
}

export function useMyPay(uid: string | null, groupIds: string[], tick = 0): PayData {
  const [state, setState] = useState<PayData>({ loading: true, items: [], legacy: [], names: {}, emails: {}, pays: {} });
  const key = `${uid}|${groupIds.join(',')}|${tick}`;
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    Promise.all(groupIds.map((g) => loadGroup(g, uid).catch(() => null))).then((list) => {
      if (!alive) return;
      const out: PayData = { loading: false, items: [], legacy: [], names: {}, emails: {}, pays: {} };
      for (const x of list) {
        if (!x) continue;
        out.items.push(...x.items);
        out.legacy.push(...x.legacy);
        Object.assign(out.names, x.names);
        Object.assign(out.emails, x.emails);
        Object.assign(out.pays, x.pays);
      }
      out.items.sort((a, b) => b.at - a.at);
      out.legacy.sort((a, b) => b.at - a.at);
      setState(out);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** 一個牌友圈所有已埋數大局嘅轉賬（包括其他人之間嘅） */
export function useGroupPay(uid: string | null, gid: string, tick = 0): PayData {
  const [state, setState] = useState<PayData>({ loading: true, items: [], legacy: [], names: {}, emails: {}, pays: {} });
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    loadGroup(gid, uid, true).catch(() => null).then((x) => {
      if (!alive) return;
      const out: PayData = { loading: false, items: x?.items ?? [], legacy: x?.legacy ?? [], names: x?.names ?? {}, emails: x?.emails ?? {}, pays: x?.pays ?? {} };
      out.items.sort((a, b) => b.at - a.at);
      setState(out);
    });
    return () => { alive = false; };
  }, [uid, gid, tick]);
  return state;
}
