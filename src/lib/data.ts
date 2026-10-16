// Firestore 讀寫：牌友圈、成員、大局、枱、每一鋪（事件）。
// 分數唔會直接存，全部由事件用計分引擎重新計出嚟。
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Firestore, Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase.ts';
import type { TableEvent } from '../engine/table.ts';
import { withRules } from '../engine/rules.ts';

export type RulesPatch = Parameters<typeof withRules>[0];

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  rules?: RulesPatch;
}

export interface Member {
  uid: string;
  name: string;
  photoURL: string | null;
}

export interface Session {
  id: string;
  name: string;
  createdBy: string;
  createdAt?: Timestamp | null;
}

export interface TableDoc {
  id: string;
  name: string;
  order: number;
  /** 4 個位，起始東南西北；成員 uid 或者訪客 id（guest-…） */
  seats: string[];
  /** 每個位嘅顯示名 */
  names: Record<string, string>;
}

export interface UndoEvent {
  type: 'undo';
  target: number;
}

export interface StoredEvent {
  seq: number;
  by: string;
  event: TableEvent | UndoEvent;
  /** 幾時入（毫秒），未同步到伺服器時係 null */
  at: number | null;
}

export class ConflictError extends Error {
  constructor() {
    super('枱面啱啱有人更新咗，睇吓最新嘅數再試');
  }
}

export function fs(): Firestore {
  if (!db) throw new Error('未設定 Firebase');
  return db;
}

export function displayName(user: User): string {
  return user.displayName?.trim() || user.email?.split('@')[0] || '玩家';
}

export function randomCode(length = 10): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const isGuest = (id: string) => id.startsWith('guest-');

export function guestId(): string {
  return `guest-${randomCode(8)}`;
}

/** 開新牌友圈，自己做局主 */
export async function createGroup(user: User, name: string): Promise<string> {
  const ref = doc(collection(fs(), 'groups'));
  const inviteCode = randomCode();
  await setDoc(ref, { name, ownerId: user.uid, inviteCode, rules: {}, createdAt: serverTimestamp() });
  await setDoc(doc(fs(), 'groups', ref.id, 'members', user.uid), {
    name: displayName(user),
    photoURL: user.photoURL ?? null,
    inviteCode,
    joinedAt: serverTimestamp(),
  });
  await setDoc(doc(fs(), 'users', user.uid), { groups: arrayUnion(ref.id), updatedAt: serverTimestamp() }, { merge: true });
  return ref.id;
}

/** 用邀請碼加入；已經係成員就直接返 true */
export async function joinGroup(user: User, groupId: string, code: string): Promise<void> {
  const memberRef = doc(fs(), 'groups', groupId, 'members', user.uid);
  const existing = await getDoc(memberRef);
  if (!existing.exists()) {
    await setDoc(memberRef, {
      name: displayName(user),
      photoURL: user.photoURL ?? null,
      inviteCode: code,
      joinedAt: serverTimestamp(),
    });
  }
  await setDoc(doc(fs(), 'users', user.uid), { groups: arrayUnion(groupId), updatedAt: serverTimestamp() }, { merge: true });
}

/** 改名之後同步去所有牌友圈 */
export async function syncMemberName(user: User, groupIds: string[]): Promise<void> {
  await Promise.all(
    groupIds.map(async (g) => {
      const ref = doc(fs(), 'groups', g, 'members', user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) await setDoc(ref, { name: displayName(user), photoURL: user.photoURL ?? null }, { merge: true });
    }),
  );
}

export interface NewTable {
  name: string;
  seats: string[];
  names: Record<string, string>;
}

/** 開大局：一次過開晒啲枱 */
export async function createSession(user: User, groupId: string, name: string, tables: NewTable[]): Promise<string> {
  const sessionRef = doc(collection(fs(), 'groups', groupId, 'sessions'));
  const batch = writeBatch(fs());
  batch.set(sessionRef, { name, createdBy: user.uid, createdAt: serverTimestamp() });
  tables.forEach((t, i) => {
    const tableRef = doc(collection(fs(), 'groups', groupId, 'sessions', sessionRef.id, 'tables'));
    batch.set(tableRef, { name: t.name, order: i, seats: t.seats, names: t.names, createdAt: serverTimestamp() });
  });
  await batch.commit();
  return sessionRef.id;
}

const pad = (n: number) => String(n).padStart(6, '0');

/** 加一鋪。序號已經有人用咗就會被拒絕（ConflictError） */
export async function appendEvent(
  groupId: string,
  sessionId: string,
  tableId: string,
  seq: number,
  by: string,
  event: TableEvent | UndoEvent,
): Promise<void> {
  const ref = doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId, 'events', pad(seq));
  try {
    await setDoc(ref, { seq, by, event: clean(event), at: serverTimestamp() });
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'permission-denied') throw new ConflictError();
    throw err;
  }
}

/** Firestore 唔收 undefined */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 撤咗嘅事件唔計，剩低嘅交俾引擎 */
export function activeEvents(stored: StoredEvent[]): { seq: number; event: TableEvent; at: number | null }[] {
  const undone = new Set<number>();
  for (const e of stored) if (e.event.type === 'undo') undone.add(e.event.target);
  const out: { seq: number; event: TableEvent; at: number | null }[] = [];
  for (const e of stored) {
    if (e.event.type === 'undo' || undone.has(e.seq)) continue;
    out.push({ seq: e.seq, event: e.event, at: e.at });
  }
  return out;
}
