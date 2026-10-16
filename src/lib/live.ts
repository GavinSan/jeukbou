// 即時讀取 Firestore 嘅 React hooks
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { fs } from './data.ts';
import type { Group, Member, Session, StoredEvent, TableDoc } from './data.ts';

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
      (err) => setState({ data: null, loading: false, error: err.code === 'permission-denied' ? '你唔係呢個牌友圈嘅成員' : err.message }),
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
      (err) => setState({ data: [], loading: false, error: err.code === 'permission-denied' ? '你唔係呢個牌友圈嘅成員' : err.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

const toGroup = (id: string, d: DocumentData): Group => ({
  id, name: String(d.name ?? ''), ownerId: String(d.ownerId ?? ''), inviteCode: String(d.inviteCode ?? ''), rules: d.rules ?? {},
});
const toMember = (id: string, d: DocumentData): Member => ({ uid: id, name: String(d.name ?? '玩家'), photoURL: d.photoURL ?? null });
const toSession = (id: string, d: DocumentData): Session => ({
  id, name: String(d.name ?? ''), createdBy: String(d.createdBy ?? ''), createdAt: d.createdAt ?? null,
});
const toTable = (id: string, d: DocumentData): TableDoc => ({
  id, name: String(d.name ?? ''), order: Number(d.order ?? 0), seats: Array.isArray(d.seats) ? d.seats.map(String) : [], names: d.names ?? {},
});
const toEvent = (_id: string, d: DocumentData): StoredEvent => ({ seq: Number(d.seq), by: String(d.by ?? ''), event: d.event });

export function useUserGroups(uid: string | null): Live<string[]> {
  const r = useLiveDoc(uid ? ['users', uid] : null, (_id, d) => (Array.isArray(d.groups) ? d.groups.map(String) : []));
  return { data: r.data ?? [], loading: r.loading, error: r.error };
}

export const useGroup = (g: string | null) => useLiveDoc(g ? ['groups', g] : null, toGroup);
export const useMembers = (g: string | null) => useLiveList(g ? ['groups', g, 'members'] : null, null, toMember);
export const useSessions = (g: string | null) => useLiveList(g ? ['groups', g, 'sessions'] : null, 'createdAt', toSession);
export const useSession = (g: string, s: string) => useLiveDoc(['groups', g, 'sessions', s], toSession);
export const useTables = (g: string, s: string) => useLiveList(['groups', g, 'sessions', s, 'tables'], 'order', toTable);
export const useTable = (g: string, s: string, t: string) => useLiveDoc(['groups', g, 'sessions', s, 'tables', t], toTable);
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
