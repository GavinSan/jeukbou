// 即時讀取 Firestore 嘅 React hooks
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { parsePayMethods } from './payMethods.ts';
import type { PayMethod } from './payMethods.ts';
import { fs, tableNameUpper } from './data.ts';
import type { Dice, ExpenseDoc, Meetup, FanTableLog, Group, JoinRequest, Member, TeamDoc, PairDoc, Session, StoredEvent, SwapRequest, TableDoc } from './data.ts';

export interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

// 上次讀到嘅文件存喺手機（localStorage）：再開 app 即刻有嘢睇，伺服器嘅新資料到咗先更新
const SNAP = 'jeukbou-doc:';
const snapMemo = new Map<string, unknown>();
function snapGet<T>(key: string): T | undefined {
  if (snapMemo.has(key)) return snapMemo.get(key) as T;
  try {
    const raw = localStorage.getItem(SNAP + key);
    if (raw) { const v = JSON.parse(raw) as T; snapMemo.set(key, v); return v; }
  } catch { /* 冇就算 */ }
  return undefined;
}
function snapSet(key: string, v: unknown) {
  snapMemo.set(key, v);
  try {
    const raw = JSON.stringify(v);
    if (raw.length < 200000) localStorage.setItem(SNAP + key, raw); else localStorage.removeItem(SNAP + key);
  } catch { /* 存唔到就算 */ }
}
/** 登出時清走手機入面嘅快取 */
export function clearSnapCache() {
  snapMemo.clear();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(SNAP) || k.startsWith('jeukbou-hist:')) localStorage.removeItem(k); } catch { /* 唔緊要 */ }
}

function useLiveDoc<T>(path: string[] | null, map: (id: string, d: DocumentData) => T, persist = false): Live<T | null> {
  const key = path ? path.join('/') : '';
  const cached = () => (persist && key ? snapGet<T>(key) : undefined);
  const [state, setState] = useState<Live<T | null>>(() => {
    const c = cached();
    return c !== undefined ? { data: c, loading: false, error: null } : { data: null, loading: !!path, error: null };
  });
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    const c = cached();
    setState((s) => (c !== undefined ? { data: c, loading: false, error: null } : { ...s, loading: true }));
    const [first, ...rest] = path;
    return onSnapshot(
      doc(fs(), first, ...rest),
      (snap) => {
        const data = snap.exists() ? map(snap.id, snap.data()) : null;
        if (persist && !snap.metadata.fromCache) snapSet(key, data);
        setState({ data, loading: false, error: null });
      },
      (err) => setState({ data: null, loading: false, error: err.code === 'permission-denied' ? '你不是此牌友圈的成員' : err.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function useLiveList<T>(path: string[] | null, order: string | null, map: (id: string, d: DocumentData) => T): Live<T[]> {
  const key = path ? path.join('/') + '|' + (order ?? '') : '';
  const [state, setState] = useState<Live<T[]>>({ data: [], loading: !!path, error: null });
  useEffect(() => {
    if (!path) { setState({ data: [], loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true }));
    const [first, ...rest] = path;
    const ref = collection(fs(), first, ...rest);
    const q = order ? query(ref, orderBy(order)) : ref;
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => map(d.id, d.data())), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err.code === 'permission-denied' ? '你不是此牌友圈的成員' : err.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

const toGroup = (id: string, d: DocumentData): Group => ({
  id, name: String(d.name ?? ''), ownerId: String(d.ownerId ?? ''), inviteCode: String(d.inviteCode ?? ''), rules: d.rules ?? {},
  settle: d.settle ?? undefined,
  fanTable: d.fanTable ?? undefined,
  legacyNames: d.legacyNames ?? undefined,
  aliases: d.aliases ?? undefined,
  joinMode: d.joinMode === 'approve' || d.joinMode === 'closed' ? d.joinMode : 'auto',
  joinCode: d.joinCode ? String(d.joinCode) : undefined,
  fanTableLog: toLog(d.fanTableLog),
  icon: typeof d.icon === 'string' ? d.icon : undefined,
  description: typeof d.description === 'string' ? d.description : undefined,
  visibility: d.visibility === 'public' ? 'public' : 'private',
  variant: typeof d.variant === 'string' ? d.variant : undefined,
  region: typeof d.region === 'string' ? d.region : undefined,
});
const millis = (v: unknown): number | null => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : null);
function toLog(d: DocumentData | undefined): FanTableLog | null {
  if (!d) return null;
  return { at: millis(d.at), by: String(d.by ?? ''), byName: String(d.byName ?? ''), changes: Array.isArray(d.changes) ? d.changes.map(String) : [] };
}
const toJoinRequest = (id: string, d: DocumentData): JoinRequest => ({
  uid: id, name: String(d.name ?? '玩家'), photoURL: d.photoURL ?? null, inviteCode: String(d.inviteCode ?? ''), at: millis(d.at),
});
const toMember = (id: string, d: DocumentData): Member => ({ uid: id, name: String(d.name ?? '玩家'), photoURL: d.photoURL ?? null, legacyKey: d.legacyKey ? String(d.legacyKey) : undefined, payEmail: d.payEmail ? String(d.payEmail) : undefined, pay: parsePayMethods(d.pay), birthday: typeof d.birthday === 'string' ? d.birthday : undefined, perms: Array.isArray(d.perms) ? d.perms.map(String) as Member['perms'] : undefined });
const toSession = (id: string, d: DocumentData): Session => ({
  id, name: String(d.name ?? ''), createdBy: String(d.createdBy ?? ''), createdAt: d.createdAt ?? null, rules: d.rules ?? undefined,
  rulesLog: Array.isArray(d.rulesLog) ? d.rulesLog.map((x: DocumentData) => ({ at: Number(x.at ?? 0), rules: x.rules ?? {} })) : undefined,
  waterTo: d.waterTo ? String(d.waterTo) : undefined, noWater: !!d.noWater,
  pullPush: ['table', 'session', 'group'].includes(d.pullPush) ? d.pullPush : 'off',
  chatBlock: d.chatBlock && typeof d.chatBlock === 'object' ? Object.fromEntries(Object.entries(d.chatBlock).map(([k, v]) => [k, Number(v) || 0])) : {},
  closed: d.closed ?? null,
  legacy: d.legacy ?? null,
  payout: d.payout && Array.isArray(d.payout.transfers) ? { v: Number(d.payout.v ?? 1), at: Number(d.payout.at ?? 0), currency: String(d.payout.currency ?? ''), transfers: d.payout.transfers.map((t: DocumentData) => ({ from: String(t.from), to: String(t.to), amount: Number(t.amount) })), names: d.payout.names ?? {} } : null,
  paid: d.paid ?? {},
  skipTeams: Array.isArray(d.skipTeams) ? d.skipTeams.map(String) : [],
  draw: d.draw && Array.isArray(d.draw.tiles) ? {
    id: String(d.draw.id ?? ''), by: String(d.draw.by ?? ''), at: Number(d.draw.at ?? 0), mode: d.draw.mode === 'auto' ? 'auto' : 'pick',
    tables: Array.isArray(d.draw.tables) ? d.draw.tables.map(String) : [],
    players: Array.isArray(d.draw.players) ? d.draw.players.map((x: DocumentData) => ({ id: String(x.id), name: String(x.name ?? '玩家') })) : [],
    tiles: d.draw.tiles.map(Number), picks: d.draw.picks && typeof d.draw.picks === 'object' ? Object.fromEntries(Object.entries(d.draw.picks).map(([k, v]) => [k, String(v)])) : {},
    order: Array.isArray(d.draw.order) ? d.draw.order.map(String) : [],
    status: d.draw.status === 'propose' || d.draw.status === 'done' ? d.draw.status : 'picking',
    approvals: Array.isArray(d.draw.approvals) ? d.draw.approvals.map(String) : [],
  } : null,
  music: typeof d.music === 'string' ? d.music : undefined,
  people: Array.isArray(d.people) ? d.people.filter((x: DocumentData) => x && x.id).map((x: DocumentData) => ({ id: String(x.id), name: String(x.name ?? '玩家') })) : [],
  closeReq: d.closeReq ? { by: String(d.closeReq.by ?? ''), approvals: Array.isArray(d.closeReq.approvals) ? d.closeReq.approvals.map(String) : [] } : null,
  endedAt: typeof d.endedAt === 'number' ? d.endedAt : null,
  endedBy: d.endedBy ? String(d.endedBy) : undefined,
});
const toExpense = (id: string, d: DocumentData): ExpenseDoc => ({
  id, kind: d.kind === 'transfer' ? 'transfer' : d.kind === 'gift' ? 'gift' : 'expense', label: String(d.label ?? ''), payer: String(d.payer ?? ''),
  amount: Number(d.amount ?? 0), sharedBy: Array.isArray(d.sharedBy) ? d.sharedBy.map(String) : [], by: String(d.by ?? ''),
  note: d.note ? String(d.note) : undefined,
  all: typeof d.all === 'boolean' ? d.all : undefined,
  names: d.names && typeof d.names === 'object' ? Object.fromEntries(Object.entries(d.names).map(([k, v]) => [k, String(v)])) : undefined,
  at: d.at && typeof d.at.toMillis === 'function' ? d.at.toMillis() : null,
});
const toPair = (id: string, d: DocumentData): PairDoc => ({
  id, a: String(d.a ?? ''), b: String(d.b ?? ''), by: String(d.by ?? ''), accepted: Array.isArray(d.accepted) ? d.accepted.map(String) : [],
});
const toDice = (d: DocumentData | undefined): Dice | null =>
  d && Array.isArray(d.values) ? { values: d.values.map(Number), by: String(d.by ?? ''), at: Number(d.at ?? 0), n: Number(d.n ?? 0) } : null;
export const toTable = (id: string, d: DocumentData): TableDoc => ({
  // 舊枱叫「第 1 枱」：顯示做「第壹枱」
  id, name: String(d.name ?? '').replace(/^第\s*(\d+)\s*枱$/, (_, n: string) => tableNameUpper(Number(n) - 1)), order: Number(d.order ?? 0), seats: Array.isArray(d.seats) ? d.seats.map(String) : [], names: d.names ?? {},
  dice: toDice(d.dice),
  liveUsers: Array.isArray(d.liveUsers) ? d.liveUsers.map(String) : undefined,
  declined: Array.isArray(d.declined) ? d.declined.map(String) : [],
  waitRegroup: d.waitRegroup === true,
});
const toRequest = (id: string, d: DocumentData): SwapRequest => ({
  id, tableId: String(d.tableId ?? ''), out: String(d.out ?? ''), in: String(d.in ?? ''), inName: String(d.inName ?? ''),
  by: String(d.by ?? ''), status: d.status ?? 'pending',
  fromTable: d.fromTable ? String(d.fromTable) : undefined, outName: d.outName ? String(d.outName) : undefined,
});
export const toEvent = (_id: string, d: DocumentData): StoredEvent => ({
  seq: Number(d.seq),
  by: String(d.by ?? ''),
  event: d.event,
  at: d.at && typeof d.at.toMillis === 'function' ? d.at.toMillis() : null,
});

export interface Profile {
  groups: string[];
  /** 等緊批准：牌友圈 id → 名 */
  pending: Record<string, string>;
  /** 自己上載嘅頭像（data URL） */
  avatar: string | null;
  payEmail: string;
  firstName: string;
  lastName: string;
  /** 生日（MM-DD） */
  birthday: string;
  nudgedAt: number;
  /** 認領咗嘅雀壇名 key（冇 = 未認領，第一次改名免費） */
  nameKey?: string;
  /** 用咗幾多張改名卷；超級管理員送咗幾多張 */
  renames?: number;
  renameGrants?: number;
  /** 收款方法 */
  payMethods?: PayMethod[];
}

const toProfile = (_id: string, d: DocumentData): Profile => ({
  payEmail: d.payEmail ? String(d.payEmail) : '',
  firstName: d.firstName ? String(d.firstName) : '',
  lastName: d.lastName ? String(d.lastName) : '',
  birthday: typeof d.birthday === 'string' ? d.birthday : '',
  nudgedAt: Number(d.nudgedAt ?? 0),
  groups: Array.isArray(d.groups) ? d.groups.map(String) : [],
  pending: d.pending && typeof d.pending === 'object' ? Object.fromEntries(Object.entries(d.pending).map(([k, v]) => [k, String(v)])) : {},
  avatar: typeof d.avatar === 'string' ? d.avatar : null,
  nameKey: typeof d.nameKey === 'string' ? d.nameKey : undefined,
  renames: Number(d.renames ?? 0),
  renameGrants: Number(d.renameGrants ?? 0),
  payMethods: parsePayMethods(d.payMethods),
});

export function useProfile(uid: string | null): Live<Profile> {
  const r = useLiveDoc(uid ? ['users', uid] : null, toProfile, true);
  return { data: r.data ?? { groups: [], pending: {}, avatar: null, payEmail: '', firstName: '', lastName: '', birthday: '', nudgedAt: 0 }, loading: r.loading, error: r.error };
}

export function useUserGroups(uid: string | null): Live<string[]> {
  const r = useProfile(uid);
  return { data: r.data.groups, loading: r.loading, error: r.error };
}

const toTeam = (id: string, d: DocumentData): TeamDoc => ({
  id, members: Array.isArray(d.members) ? d.members.map(String) : [], accepted: Array.isArray(d.accepted) ? d.accepted.map(String) : [], by: String(d.by ?? ''),
});
export const useTeams = (g: string | null) => useLiveList(g ? ['groups', g, 'teams'] : null, null, toTeam);

export const useJoinRequests = (g: string | null) => useLiveList(g ? ['groups', g, 'joinRequests'] : null, null, toJoinRequest);
/** 申請人自己：成員文件有冇、申請仲喺唔喺 */
export const useMyMember = (g: string, uid: string) => useLiveDoc(['groups', g, 'members', uid], toMember);
export const useMyJoinRequest = (g: string, uid: string) => useLiveDoc(['groups', g, 'joinRequests', uid], toJoinRequest);

export const useGroup = (g: string | null) => useLiveDoc(g ? ['groups', g] : null, toGroup, true);
export const useMembers = (g: string | null) => useLiveList(g ? ['groups', g, 'members'] : null, null, toMember);
export const useSessions = (g: string | null) => useLiveList(g ? ['groups', g, 'sessions'] : null, 'createdAt', toSession);
export const useSession = (g: string, s: string) => useLiveDoc(['groups', g, 'sessions', s], toSession);
export const useTables = (g: string, s: string) => useLiveList(['groups', g, 'sessions', s, 'tables'], 'order', toTable);
export const useTable = (g: string, s: string, t: string) => useLiveDoc(['groups', g, 'sessions', s, 'tables', t], toTable);
export const useRequests = (g: string, s: string) => useLiveList(['groups', g, 'sessions', s, 'requests'], null, toRequest);
export const useExpenses = (g: string, s: string) => useLiveList(['groups', g, 'sessions', s, 'expenses'], null, toExpense);
export const usePairs = (g: string, s: string) => useLiveList(['groups', g, 'sessions', s, 'pairs'], null, toPair);
export const useEvents = (g: string, s: string, t: string) =>
  useLiveList(['groups', g, 'sessions', s, 'tables', t, 'events'], 'seq', toEvent);

/** 一次過聽幾張枱嘅事件（大局總覽用） */
export function useManyEvents(g: string, s: string, tableIds: string[]): Record<string, StoredEvent[]> {
  const key = tableIds.join(',');
  const [all, setAll] = useState<Record<string, StoredEvent[]>>({});
  useEffect(() => {
    const unsubs = tableIds.map((t) =>
      onSnapshot(
        query(collection(fs(), 'groups', g, 'sessions', s, 'tables', t, 'events'), orderBy('seq')),
        (snap) => setAll((prev) => ({ ...prev, [t]: snap.docs.map((d) => toEvent(d.id, d.data())) })),
        () => undefined,
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, s, key]);
  return useMemo(() => all, [all]);
}

/** 最近幾個大局（主頁 Live 用） */
export function useRecentSessions(g: string, n = 3): Live<Session[]> {
  const [state, setState] = useState<Live<Session[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    return onSnapshot(
      query(collection(fs(), 'groups', g, 'sessions'), orderBy('createdAt', 'desc'), limit(n)),
      (snap) => setState({ data: snap.docs.map((d) => toSession(d.id, d.data())), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err.message }),
    );
  }, [g, n]);
  return state;
}

/** 未過嘅約局（之前 3 個鐘起） */
export function useMeetups(g: string | null): Live<Meetup[]> {
  const [state, setState] = useState<Live<Meetup[]>>({ data: [], loading: !!g, error: null });
  useEffect(() => {
    if (!g) return;
    const since = Date.now() - 3 * 3600000;
    return onSnapshot(
      query(collection(fs(), 'groups', g, 'meetups'), where('at', '>=', since), orderBy('at')),
      (snap) => setState({
        data: snap.docs.map((d) => {
          const x = d.data();
          const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
          return {
            id: d.id, by: String(x.by ?? ''), byName: String(x.byName ?? ''), at: Number(x.at ?? 0), place: String(x.place ?? ''), note: String(x.note ?? ''),
            going: arr(x.going), maybe: arr(x.maybe), no: arr(x.no), names: x.names && typeof x.names === 'object' ? Object.fromEntries(Object.entries(x.names).map(([k, v]) => [k, String(v)])) : {},
            createdAt: Number(x.createdAt ?? 0), tables: Math.max(1, Number(x.tables ?? 1) || 1),
          };
        }),
        loading: false, error: null,
      }),
      (err) => setState({ data: [], loading: false, error: err.message }),
    );
  }, [g]);
  return state;
}

export interface ChatMsg {
  id: string;
  by: string;
  name: string;
  text: string;
  at: number | null;
}

/** 直播室留言（最新 60 條） */
export function useChat(g: string, s: string): Live<ChatMsg[]> {
  const [state, setState] = useState<Live<ChatMsg[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    return onSnapshot(
      query(collection(fs(), 'groups', g, 'sessions', s, 'chat'), orderBy('at', 'desc'), limit(60)),
      (snap) => setState({
        data: snap.docs.map((d) => { const x = d.data(); return { id: d.id, by: String(x.by ?? ''), name: String(x.name ?? '玩家'), text: String(x.text ?? ''), at: x.at && typeof x.at.toMillis === 'function' ? x.at.toMillis() : null }; }).reverse(),
        loading: false, error: null,
      }),
      (err) => setState({ data: [], loading: false, error: err.message }),
    );
  }, [g, s]);
  return state;
}

// 一次過讀（唔即時跟）嘅地方用
export const toGroupDoc = toGroup;
export const toMemberDoc = toMember;
export const toSessionDoc = toSession;
export const toExpenseDoc = toExpense;
export const toPairDoc = toPair;
export const toTeamDoc = toTeam;

/** 風格開放設定（超級管理員改；人人讀得） */
export const useSkinConfig = (on: boolean) => useLiveDoc(on ? ['config', 'skins'] : null, (_id, d) => ({
  modes: d.modes && typeof d.modes === 'object' ? Object.fromEntries(Object.entries(d.modes).filter(([, v]) => v === 'auto' || v === 'open' || v === 'closed')) as Record<string, 'auto' | 'open' | 'closed'> : {},
  /** 超級管理員改咗嘅解鎖段位：TIERS 位置；-2 = 要授權 */
  tiers: d.tiers && typeof d.tiers === 'object' ? Object.fromEntries(Object.entries(d.tiers).filter(([, v]) => typeof v === 'number' && Number.isInteger(v) && v >= -2 && v <= 9)) as Record<string, number> : {},
}), true);
/** 超級管理員開咗俾我嘅豪華風格 */
export const useSkinGrants = (uid: string | null) => useLiveDoc(uid ? ['skinGrants', uid] : null, (_id, d) => (Array.isArray(d.skins) ? d.skins.map(String) : []) as string[], true);
