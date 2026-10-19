// 即時讀取 Firestore 嘅 React hooks
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { fs } from './data.ts';
import type { Dice, ExpenseDoc, FanTableLog, Group, JoinRequest, Member, PairDoc, Session, StoredEvent, SwapRequest, TableDoc } from './data.ts';

export interface Live<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

function useLiveDoc<T>(path: string[] | null, map: (id: string, d: DocumentData) => T): Live<T | null> {
  const key = path ? path.join('/') : '';
  const [state, setState] = useState<Live<T | null>>({ data: null, loading: !!path, error: null });
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true }));
    const [first, ...rest] = path;
    return onSnapshot(
      doc(fs(), first, ...rest),
      (snap) => setState({ data: snap.exists() ? map(snap.id, snap.data()) : null, loading: false, error: null }),
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
});
const millis = (v: unknown): number | null => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : null);
function toLog(d: DocumentData | undefined): FanTableLog | null {
  if (!d) return null;
  return { at: millis(d.at), by: String(d.by ?? ''), byName: String(d.byName ?? ''), changes: Array.isArray(d.changes) ? d.changes.map(String) : [] };
}
const toJoinRequest = (id: string, d: DocumentData): JoinRequest => ({
  uid: id, name: String(d.name ?? '玩家'), photoURL: d.photoURL ?? null, inviteCode: String(d.inviteCode ?? ''), at: millis(d.at),
});
const toMember = (id: string, d: DocumentData): Member => ({ uid: id, name: String(d.name ?? '玩家'), photoURL: d.photoURL ?? null, legacyKey: d.legacyKey ? String(d.legacyKey) : undefined });
const toSession = (id: string, d: DocumentData): Session => ({
  id, name: String(d.name ?? ''), createdBy: String(d.createdBy ?? ''), createdAt: d.createdAt ?? null, rules: d.rules ?? undefined,
  waterTo: d.waterTo ? String(d.waterTo) : undefined, noWater: !!d.noWater,
  closed: d.closed ?? null,
  legacy: d.legacy ?? null,
  closeReq: d.closeReq ? { by: String(d.closeReq.by ?? ''), approvals: Array.isArray(d.closeReq.approvals) ? d.closeReq.approvals.map(String) : [] } : null,
});
const toExpense = (id: string, d: DocumentData): ExpenseDoc => ({
  id, kind: d.kind === 'transfer' ? 'transfer' : 'expense', label: String(d.label ?? ''), payer: String(d.payer ?? ''),
  amount: Number(d.amount ?? 0), sharedBy: Array.isArray(d.sharedBy) ? d.sharedBy.map(String) : [], by: String(d.by ?? ''),
  at: d.at && typeof d.at.toMillis === 'function' ? d.at.toMillis() : null,
});
const toPair = (id: string, d: DocumentData): PairDoc => ({
  id, a: String(d.a ?? ''), b: String(d.b ?? ''), by: String(d.by ?? ''), accepted: Array.isArray(d.accepted) ? d.accepted.map(String) : [],
});
const toDice = (d: DocumentData | undefined): Dice | null =>
  d && Array.isArray(d.values) ? { values: d.values.map(Number), by: String(d.by ?? ''), at: Number(d.at ?? 0), n: Number(d.n ?? 0) } : null;
export const toTable = (id: string, d: DocumentData): TableDoc => ({
  id, name: String(d.name ?? ''), order: Number(d.order ?? 0), seats: Array.isArray(d.seats) ? d.seats.map(String) : [], names: d.names ?? {},
  dice: toDice(d.dice),
  declined: Array.isArray(d.declined) ? d.declined.map(String) : [],
});
const toRequest = (id: string, d: DocumentData): SwapRequest => ({
  id, tableId: String(d.tableId ?? ''), out: String(d.out ?? ''), in: String(d.in ?? ''), inName: String(d.inName ?? ''),
  by: String(d.by ?? ''), status: d.status ?? 'pending',
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
}

const toProfile = (_id: string, d: DocumentData): Profile => ({
  groups: Array.isArray(d.groups) ? d.groups.map(String) : [],
  pending: d.pending && typeof d.pending === 'object' ? Object.fromEntries(Object.entries(d.pending).map(([k, v]) => [k, String(v)])) : {},
  avatar: typeof d.avatar === 'string' ? d.avatar : null,
});

export function useProfile(uid: string | null): Live<Profile> {
  const r = useLiveDoc(uid ? ['users', uid] : null, toProfile);
  return { data: r.data ?? { groups: [], pending: {}, avatar: null }, loading: r.loading, error: r.error };
}

export function useUserGroups(uid: string | null): Live<string[]> {
  const r = useProfile(uid);
  return { data: r.data.groups, loading: r.loading, error: r.error };
}

export const useJoinRequests = (g: string | null) => useLiveList(g ? ['groups', g, 'joinRequests'] : null, null, toJoinRequest);
/** 申請人自己：成員文件有冇、申請仲喺唔喺 */
export const useMyMember = (g: string, uid: string) => useLiveDoc(['groups', g, 'members', uid], toMember);
export const useMyJoinRequest = (g: string, uid: string) => useLiveDoc(['groups', g, 'joinRequests', uid], toJoinRequest);

export const useGroup = (g: string | null) => useLiveDoc(g ? ['groups', g] : null, toGroup);
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
