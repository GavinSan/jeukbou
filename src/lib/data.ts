// Firestore 讀寫：牌友圈、成員、大局、枱、每一鋪（事件）。
// 分數唔會直接存，全部由事件用計分引擎重新計出嚟。
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
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
  /** 場主嘅埋數設定 */
  settle?: Partial<SettleConfig>;
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
  /** 開局嗰陣複製咗牌友圈嘅家規；舊大局冇就用牌友圈嘅 */
  rules?: RulesPatch;
}

/** 埋數設定（牌友圈層面，局主改） */
export interface SettleConfig {
  /** 貨幣代號，例如 CAD、HKD */
  currency: string;
  /** 幾多番 = 1 個貨幣單位 */
  perUnit: number;
  /** 水歸邊個戶口；空白 = 局主 */
  waterTo: string;
  /** 金額向上取整 */
  roundUp: boolean;
}

export const DEFAULT_SETTLE: SettleConfig = { currency: 'CAD', perUnit: 6, waterTo: '', roundUp: true };

export function settleConfigOf(g: Group | null | undefined): SettleConfig {
  const c = { ...DEFAULT_SETTLE, ...(g?.settle ?? {}) };
  if (!c.waterTo && g) c.waterTo = g.ownerId;
  return c;
}

/** 開支（晚餐、的士…）或者已經私下轉咗嘅錢；同麻雀數分開 */
export interface ExpenseDoc {
  id: string;
  kind: 'expense' | 'transfer';
  label: string;
  payer: string;
  amount: number;
  /** 分嘅人；transfer 就係收錢嗰個 */
  sharedBy: string[];
  by: string;
  at: number | null;
}

/** GP：兩個人一齊計數，兩個都要同意（訪客唔使） */
export interface PairDoc {
  id: string;
  a: string;
  b: string;
  by: string;
  accepted: string[];
}

export interface Dice {
  values: number[];
  by: string;
  at: number;
  n: number;
}

export interface TableDoc {
  id: string;
  name: string;
  order: number;
  /** 4 個位，起始東南西北；成員 uid 或者訪客 id（guest-…） */
  seats: string[];
  /** 每個位嘅顯示名（包括換咗出去同換入嚟嘅人） */
  names: Record<string, string>;
  /** 最近一次擲骰（全枱見到） */
  dice?: Dice | null;
}

/** 換人請求：換入嚟嘅人接受先生效 */
export interface SwapRequest {
  id: string;
  tableId: string;
  out: string;
  in: string;
  inName: string;
  by: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
}

export interface UndoEvent {
  type: 'undo';
  target: number;
}

/** 改返之前某一鋪：用新嘅內容代替；之後嘅鋪會自動重新計 */
export interface EditEvent {
  type: 'edit';
  target: number;
  event: TableEvent;
}

/** 寫入紀錄嘅任何一項 */
export type LogEvent = TableEvent | UndoEvent | EditEvent;

export interface StoredEvent {
  seq: number;
  by: string;
  event: LogEvent;
  /** 幾時入（毫秒），未同步到伺服器時係 null */
  at: number | null;
}

export class ConflictError extends Error {
  constructor() {
    super('其他人剛更新了枱面，請查看最新數字後再試');
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
export async function createSession(user: User, groupId: string, name: string, tables: NewTable[], rules: RulesPatch): Promise<string> {
  const sessionRef = doc(collection(fs(), 'groups', groupId, 'sessions'));
  const batch = writeBatch(fs());
  batch.set(sessionRef, { name, createdBy: user.uid, createdAt: serverTimestamp(), rules: clean(rules) });
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
  event: LogEvent,
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
export function activeEvents(stored: StoredEvent[]): { seq: number; event: TableEvent; at: number | null; edited: boolean }[] {
  const undone = new Set<number>();
  const edits = new Map<number, TableEvent>();
  for (const e of stored) {
    if (e.event.type === 'undo') undone.add(e.event.target);
    else if (e.event.type === 'edit') edits.set(e.event.target, e.event.event);
  }
  const out: { seq: number; event: TableEvent; at: number | null; edited: boolean }[] = [];
  for (const e of stored) {
    if (e.event.type === 'undo' || e.event.type === 'edit' || undone.has(e.seq)) continue;
    const edit = edits.get(e.seq);
    out.push({ seq: e.seq, event: edit ?? e.event, at: e.at, edited: !!edit });
  }
  return out;
}

/** 大局中途加一張枱 */
export async function addTable(groupId: string, sessionId: string, order: number, table: NewTable): Promise<void> {
  const ref = doc(collection(fs(), 'groups', groupId, 'sessions', sessionId, 'tables'));
  await setDoc(ref, { name: table.name, order, seats: table.seats, names: table.names, createdAt: serverTimestamp() });
}

/** 開枱之前掉位：重排 4 個位（未有任何一鋪先得） */
export async function reseat(groupId: string, sessionId: string, tableId: string, seats: string[]): Promise<void> {
  await updateDoc(doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId), { seats });
}

export async function rollDice(groupId: string, sessionId: string, tableId: string, by: string, n: number): Promise<number[]> {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const values = Array.from(bytes, (b) => (b % 6) + 1);
  await updateDoc(doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId), { dice: { values, by, at: Date.now(), n } });
  return values;
}

export async function saveRules(path: string[], rules: RulesPatch): Promise<void> {
  const [first, ...rest] = path;
  await updateDoc(doc(fs(), first, ...rest), { rules: clean(rules) });
}

async function nextSeq(groupId: string, sessionId: string, tableId: string): Promise<number> {
  const snap = await getDocs(collection(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId, 'events'));
  return snap.size + 1;
}

/** 即時換人（換入訪客，或者對方已經接受） */
export async function applySwap(
  groupId: string, sessionId: string, tableId: string, by: string, out: string, incoming: string, inName: string,
): Promise<void> {
  await updateDoc(doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId), { [`names.${incoming}`]: inName });
  try {
    await appendEvent(groupId, sessionId, tableId, await nextSeq(groupId, sessionId, tableId), by, { type: 'swap', out, in: incoming });
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    // 啱啱有人入咗數，攞過新序號再試一次
    await appendEvent(groupId, sessionId, tableId, await nextSeq(groupId, sessionId, tableId), by, { type: 'swap', out, in: incoming });
  }
}

export async function requestSwap(groupId: string, sessionId: string, req: Omit<SwapRequest, 'id' | 'status'>): Promise<void> {
  const ref = doc(collection(fs(), 'groups', groupId, 'sessions', sessionId, 'requests'));
  await setDoc(ref, { ...req, status: 'pending', createdAt: serverTimestamp() });
}

export async function answerSwap(groupId: string, sessionId: string, req: SwapRequest, user: User, accept: boolean): Promise<void> {
  const ref = doc(fs(), 'groups', groupId, 'sessions', sessionId, 'requests', req.id);
  if (accept) await applySwap(groupId, sessionId, req.tableId, user.uid, req.out, req.in, displayName(user));
  await updateDoc(ref, { status: accept ? 'accepted' : 'declined' });
}

export async function cancelSwap(groupId: string, sessionId: string, reqId: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', groupId, 'sessions', sessionId, 'requests', reqId), { status: 'cancelled' });
}

// ---------- 埋數 ----------

/** 淨係局主改得（firestore.rules：groups 只准局主 update） */
export async function saveSettleConfig(g: string, config: SettleConfig): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g), { settle: config });
}

export async function addExpense(g: string, s: string, e: Omit<ExpenseDoc, 'id' | 'at'>): Promise<void> {
  const ref = doc(collection(fs(), 'groups', g, 'sessions', s, 'expenses'));
  await setDoc(ref, { ...e, at: serverTimestamp() });
}

export async function deleteExpense(g: string, s: string, id: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', g, 'sessions', s, 'expenses', id));
}

export async function proposePair(g: string, s: string, p: Omit<PairDoc, 'id'>): Promise<void> {
  const ref = doc(collection(fs(), 'groups', g, 'sessions', s, 'pairs'));
  await setDoc(ref, { ...p, at: serverTimestamp() });
}

export async function acceptPair(g: string, s: string, id: string, uid: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s, 'pairs', id), { accepted: arrayUnion(uid) });
}

export async function deletePair(g: string, s: string, id: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', g, 'sessions', s, 'pairs', id));
}

/** pair 生效：兩個人入面，有帳戶嘅都同意咗 */
export const pairActive = (p: Pick<PairDoc, 'a' | 'b' | 'accepted'>) =>
  [p.a, p.b].every((id) => isGuest(id) || p.accepted.includes(id));
