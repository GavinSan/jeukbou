// Firestore 讀寫：牌友圈、成員、大局、枱、每一鋪（事件）。
// 分數唔會直接存，全部由事件用計分引擎重新計出嚟。
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Timestamp as TimestampCtor } from 'firebase/firestore';
import type { Firestore, Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase.ts';
import type { TableEvent } from '../engine/table.ts';
import type { MoneyRounding } from '../engine/settlement.ts';
import { DEFAULT_FAN_TABLE } from './fanTable.ts';
import type { FanTable } from './fanTable.ts';
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
  /** 牌友圈自己嘅番數表；冇就用預設 */
  fanTable?: FanTable;
  /** 匯入舊紀錄嘅玩家名（key → 顯示名） */
  legacyNames?: Record<string, string>;
  /** 局主配對：舊紀錄 key → 成員 uid */
  aliases?: Record<string, string>;
  /** 加入方式；冇 = 自動加入 */
  joinMode?: JoinMode;
  /** 6 位加入碼 */
  joinCode?: string;
  /** 番數表最近一次修改 */
  fanTableLog?: FanTableLog | null;
}

export type JoinMode = 'auto' | 'approve' | 'closed';

export interface FanTableLog {
  at: number | null;
  by: string;
  byName: string;
  changes: string[];
}

export interface JoinRequest {
  uid: string;
  name: string;
  photoURL: string | null;
  inviteCode: string;
  at: number | null;
}

export interface Member {
  uid: string;
  name: string;
  photoURL: string | null;
  /** 自己認領咗舊紀錄入面邊個名 */
  legacyKey?: string;
  /** 收錢用嘅 Interac e-Transfer email */
  payEmail?: string;
  /** 生日（MM-DD），同圈嘅人見到 */
  birthday?: string;
}

export interface Session {
  id: string;
  name: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  /** 開局嗰陣複製咗牌友圈嘅家規；舊大局冇就用牌友圈嘅 */
  rules?: RulesPatch;
  /** 中途改家規嘅紀錄：每鋪用當時嘅家規（at = 毫秒；第一條 at = 0 係開局時嘅家規） */
  rulesLog?: { at: number; rules: RulesPatch }[];
  /** 水由誰保管；冇就係場主（開局嗰個） */
  waterTo?: string;
  /** 呢局唔抽水（打牌嘅人揀） */
  noWater?: boolean;
  /** 已埋數 */
  closed?: { by: string; at: number } | null;
  /** 申請埋數（非場主）：要晒有帳戶嘅玩家同意 */
  closeReq?: { by: string; approvals: string[] } | null;
  /** 由 Google Sheet 匯入嘅舊紀錄：每人番數（key 係舊紀錄玩家），冇枱 */
  legacy?: { totals: Record<string, number>; water: number; paid: boolean } | null;
  /** 埋數嗰陣嘅轉賬（麻雀＋水＋開支合併）；Group 嘅 key 係「a + b」 */
  payout?: Payout | null;
  /** 邊幾筆已經轉咗：key = from>to */
  paid?: Record<string, { by: string; at: number }>;
  /** 今日有份但冇打牌嘅人（成員或者訪客），開支用 */
  people?: { id: string; name: string }[];
  /** 今晚唔用嘅預設 Group（team id） */
  skipTeams?: string[];
}

export interface Payout {
  /** 計法版本：舊版快照會自動重計 */
  v?: number;
  at: number;
  currency: string;
  transfers: { from: string; to: string; amount: number }[];
  names: Record<string, string>;
}

export const payKey = (t: { from: string; to: string }) => `${t.from}>${t.to}`;

/** 埋數時記低轉賬（之後「我的找數」用） */
export async function savePayout(g: string, s: string, payout: Payout): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { payout: clean(payout) });
}

/** 標記一筆轉賬已轉／未轉 */
export async function markPaid(g: string, s: string, key: string, uid: string, on: boolean): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { [`paid.${key}`]: on ? { by: uid, at: Date.now() } : deleteField() });
}

/** 收錢 email：存喺自己資料同所有牌友圈嘅成員資料（同圈嘅人先睇到） */
export async function setPayEmail(user: User, email: string, groupIds: string[]): Promise<void> {
  const v = email.trim();
  await setDoc(doc(fs(), 'users', user.uid), { payEmail: v || deleteField(), updatedAt: serverTimestamp() }, { merge: true });
  await Promise.all(groupIds.map(async (g) => {
    const ref = doc(fs(), 'groups', g, 'members', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { payEmail: v || deleteField() });
  }));
}

/** 真名（只係局主同超級管理員睇）同生日（月-日，同圈嘅人見到，方便一齊慶祝） */
export async function setProfileDetails(user: User, d: { firstName: string; lastName: string; birthday: string }, groupIds: string[]): Promise<void> {
  const bday = /^\d{2}-\d{2}$/.test(d.birthday) ? d.birthday : '';
  await setDoc(doc(fs(), 'users', user.uid), {
    firstName: d.firstName.trim() || deleteField(), lastName: d.lastName.trim() || deleteField(),
    birthday: bday || deleteField(), updatedAt: serverTimestamp(),
  }, { merge: true });
  await Promise.all(groupIds.map(async (g) => {
    const ref = doc(fs(), 'groups', g, 'members', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { birthday: bday || deleteField() });
  }));
}

/** 提咗用家補資料（之後兩個禮拜唔再提） */
export async function markNudged(uid: string): Promise<void> {
  await setDoc(doc(fs(), 'users', uid), { nudgedAt: Date.now() }, { merge: true });
}

/** 埋數設定（牌友圈層面，局主改） */
export interface SettleConfig {
  /** 貨幣代號，例如 CAD、HKD */
  currency: string;
  /** 幾多番 = 1 個貨幣單位 */
  perUnit: number;
  /** 水由誰保管（入佢個數）；空白 = 局主 */
  waterTo: string;
  /** 金額取整：向上、四捨五入、不變 */
  rounding: MoneyRounding;
}

export const DEFAULT_SETTLE: SettleConfig = { currency: 'CAD', perUnit: 6, waterTo: '', rounding: 'up' };

export function settleConfigOf(g: Group | null | undefined): SettleConfig {
  const raw = (g?.settle ?? {}) as Partial<SettleConfig> & { roundUp?: boolean };
  const c = { ...DEFAULT_SETTLE, ...raw };
  // 舊設定只有 roundUp
  if (!raw.rounding && raw.roundUp !== undefined) c.rounding = raw.roundUp ? 'up' : 'none';
  delete (c as { roundUp?: boolean }).roundUp;
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
  /** 冇打牌但有份嘅訪客名（id → 名） */
  names?: Record<string, string>;
  /** 全部人分：之後加入嘅人都自動有份（舊紀錄冇呢欄：揀晒全部玩家就當係） */
  all?: boolean;
  /** 備註 */
  note?: string;
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
  /** 夠拉時輸家揀咗「不找」：`puller>pulled#count`，全枱同步 */
  declined?: string[];
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
  /** 對方而家喺另一張枱打緊：接受就兩張枱對調 */
  fromTable?: string;
  outName?: string;
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
export async function createGroup(user: User, name: string, photo: string | null = user.photoURL): Promise<string> {
  const ref = doc(collection(fs(), 'groups'));
  const inviteCode = randomCode();
  await setDoc(ref, { name, ownerId: user.uid, inviteCode, joinMode: 'auto', rules: {}, createdAt: serverTimestamp() });
  await setDoc(doc(fs(), 'groups', ref.id, 'members', user.uid), {
    name: displayName(user),
    photoURL: photo ?? null,
    inviteCode,
    joinedAt: serverTimestamp(),
  });
  await setDoc(doc(fs(), 'users', user.uid), { groups: arrayUnion(ref.id), updatedAt: serverTimestamp() }, { merge: true });
  ensureJoinCode({ id: ref.id, inviteCode, joinCode: undefined }, name).catch(() => undefined);
  return ref.id;
}

const isDenied = (err: unknown) => typeof err === 'object' && !!err && 'code' in err && (err as { code: unknown }).code === 'permission-denied';

/**
 * 用邀請連結或者加入碼加入。
 * 自動加入 → 'joined'；要批准 → 送出申請 'requested'；不收新人或者碼錯 → 拋錯。
 */
export async function joinGroup(user: User, groupId: string, code: string, photo: string | null = user.photoURL, groupName = ''): Promise<'joined' | 'requested'> {
  const memberRef = doc(fs(), 'groups', groupId, 'members', user.uid);
  const userRef = doc(fs(), 'users', user.uid);
  const existing = await getDoc(memberRef);
  if (existing.exists()) {
    await setDoc(userRef, { groups: arrayUnion(groupId), pending: { [groupId]: deleteField() }, updatedAt: serverTimestamp() }, { merge: true });
    return 'joined';
  }
  const me = { name: displayName(user), photoURL: photo ?? null, inviteCode: code };
  try {
    await setDoc(memberRef, { ...me, joinedAt: serverTimestamp() });
    await setDoc(userRef, { groups: arrayUnion(groupId), updatedAt: serverTimestamp() }, { merge: true });
    return 'joined';
  } catch (err) {
    if (!isDenied(err)) throw err;
  }
  try {
    const reqRef = doc(fs(), 'groups', groupId, 'joinRequests', user.uid);
    const had = await getDoc(reqRef).catch(() => null);
    if (!had?.exists()) await setDoc(reqRef, { ...me, at: serverTimestamp() });
    await setDoc(userRef, { pending: { [groupId]: groupName || '牌友圈' }, updatedAt: serverTimestamp() }, { merge: true });
    return 'requested';
  } catch (err) {
    if (isDenied(err)) throw new Error('此牌友圈暫時不接受新成員，或連結已失效。請向局主查詢。');
    throw err;
  }
}

/** 申請批咗：搬去「我的牌友圈」；被拒或者取消：清走 */
export async function settlePending(uid: string, groupId: string, joined: boolean): Promise<void> {
  const data: Record<string, unknown> = { pending: { [groupId]: deleteField() }, updatedAt: serverTimestamp() };
  if (joined) data.groups = arrayUnion(groupId);
  await setDoc(doc(fs(), 'users', uid), data, { merge: true });
}

export async function cancelJoinRequest(uid: string, groupId: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', groupId, 'joinRequests', uid)).catch(() => undefined);
  await settlePending(uid, groupId, false);
}

/** 局主批准：開成員、刪申請（一齊做） */
export async function approveJoin(groupId: string, req: JoinRequest): Promise<void> {
  const batch = writeBatch(fs());
  batch.set(doc(fs(), 'groups', groupId, 'members', req.uid), { name: req.name, photoURL: req.photoURL, inviteCode: req.inviteCode, joinedAt: serverTimestamp() });
  batch.delete(doc(fs(), 'groups', groupId, 'joinRequests', req.uid));
  await batch.commit();
}

export async function rejectJoin(groupId: string, uid: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', groupId, 'joinRequests', uid));
}

export async function setJoinMode(groupId: string, mode: JoinMode): Promise<void> {
  await updateDoc(doc(fs(), 'groups', groupId), { joinMode: mode });
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function joinCodeCandidate(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** 局主：未有加入碼就開一個（撞碼就再試） */
const making = new Map<string, Promise<string>>();
export function ensureJoinCode(g: Pick<Group, 'id' | 'inviteCode' | 'joinCode'>, name: string): Promise<string> {
  if (g.joinCode) return Promise.resolve(g.joinCode);
  const key = `${g.id}:${g.inviteCode}`;
  const running = making.get(key);
  if (running) return running;
  const p = makeJoinCode(g, name).finally(() => making.delete(key));
  making.set(key, p);
  return p;
}

async function makeJoinCode(g: Pick<Group, 'id' | 'inviteCode'>, name: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = joinCodeCandidate();
    try {
      await setDoc(doc(fs(), 'codes', code), { g: g.id, invite: g.inviteCode, name, at: serverTimestamp() });
      await updateDoc(doc(fs(), 'groups', g.id), { joinCode: code });
      return code;
    } catch (err) {
      if (!isDenied(err)) throw err;
    }
  }
  throw new Error('未能產生加入碼，請再試');
}

/** 局主：重設連結同加入碼（舊連結、舊碼即時失效） */
export async function resetInvite(g: Group): Promise<void> {
  if (g.joinCode) await deleteDoc(doc(fs(), 'codes', g.joinCode)).catch(() => undefined);
  const inviteCode = randomCode();
  await updateDoc(doc(fs(), 'groups', g.id), { inviteCode, joinCode: deleteField() });
  await ensureJoinCode({ id: g.id, inviteCode, joinCode: undefined }, g.name);
}

/** 用加入碼搵牌友圈 */
export async function lookupJoinCode(code: string): Promise<{ g: string; invite: string; name: string } | null> {
  const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 6) return null;
  try {
    const snap = await getDoc(doc(fs(), 'codes', c));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { g: String(d.g ?? ''), invite: String(d.invite ?? ''), name: String(d.name ?? '') };
  } catch {
    return null;
  }
}

/** 改名或者換頭像之後同步去所有牌友圈 */
export async function syncMemberName(user: User, groupIds: string[], photo: string | null = user.photoURL): Promise<void> {
  await Promise.all(
    groupIds.map(async (g) => {
      const ref = doc(fs(), 'groups', g, 'members', user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) await setDoc(ref, { name: displayName(user), photoURL: photo ?? null }, { merge: true });
    }),
  );
}

/** 換頭像（null = 用返登入帳戶張相） */
export async function setAvatar(user: User, avatar: string | null, groupIds: string[]): Promise<void> {
  await setDoc(doc(fs(), 'users', user.uid), { avatar: avatar ?? deleteField(), updatedAt: serverTimestamp() }, { merge: true });
  await syncMemberName(user, groupIds, avatar ?? user.photoURL);
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

/** 大局中途改家規：之前嘅鋪照舊，之後嘅鋪用新家規 */
export async function saveSessionRules(g: string, s: Session, rules: RulesPatch): Promise<void> {
  const log = s.rulesLog?.length ? s.rulesLog : [{ at: 0, rules: s.rules ?? {} }];
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s.id), { rules: clean(rules), rulesLog: clean([...log, { at: Date.now(), rules }]) });
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

/** 幾張枱一齊執位：每張枱用換人（swap）換走唔再坐呢枱嘅人，再用換位（reseat）排位；未開局嘅枱直接改座位 */
export async function regroupTables(
  groupId: string, sessionId: string, by: string,
  plan: { tableId: string; current: string[]; seats: string[]; names: Record<string, string>; fresh: boolean }[],
): Promise<void> {
  for (const p of plan) {
    const ref = doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', p.tableId);
    const out = p.current.filter((x) => !p.seats.includes(x));
    const inn = p.seats.filter((x) => !p.current.includes(x));
    if (p.fresh) {
      await updateDoc(ref, { seats: p.seats, ...Object.fromEntries(inn.map((id) => [`names.${id}`, p.names[id] ?? '玩家'])) });
      continue;
    }
    const now = [...p.current];
    for (let i = 0; i < out.length; i++) {
      await applySwap(groupId, sessionId, p.tableId, by, out[i], inn[i], p.names[inn[i]] ?? '玩家');
      now[now.indexOf(out[i])] = inn[i];
    }
    if (now.join('|') !== p.seats.join('|')) {
      await appendEvent(groupId, sessionId, p.tableId, await nextSeq(groupId, sessionId, p.tableId), by, { type: 'reseat', seats: p.seats });
    }
  }
}

export async function requestSwap(groupId: string, sessionId: string, req: Omit<SwapRequest, 'id' | 'status'>): Promise<void> {
  const ref = doc(collection(fs(), 'groups', groupId, 'sessions', sessionId, 'requests'));
  await setDoc(ref, { ...req, status: 'pending', createdAt: serverTimestamp() });
}

export async function answerSwap(groupId: string, sessionId: string, req: SwapRequest, user: User, accept: boolean): Promise<void> {
  const ref = doc(fs(), 'groups', groupId, 'sessions', sessionId, 'requests', req.id);
  if (accept) {
    await applySwap(groupId, sessionId, req.tableId, user.uid, req.out, req.in, displayName(user));
    // 由另一張枱過嚟：嗰張枱就由離開嗰個補上（對調）
    if (req.fromTable) await applySwap(groupId, sessionId, req.fromTable, user.uid, req.in, req.out, req.outName ?? '玩家');
  }
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

/** 改開支：成份換晒（冇嘅欄清走） */
export async function updateExpense(g: string, s: string, id: string, e: Omit<ExpenseDoc, 'id' | 'at' | 'by'>): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s, 'expenses', id), {
    kind: e.kind, label: e.label, payer: e.payer, amount: e.amount, sharedBy: e.sharedBy,
    names: e.names ?? deleteField(), note: e.note ?? deleteField(), all: e.all ?? deleteField(),
  });
}

/** 今日人物：加一個冇打牌但有份嘅人（成員或者訪客） */
export async function addSessionPerson(g: string, s: string, person: { id: string; name: string }): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { people: arrayUnion({ id: person.id, name: person.name }) });
}

/** 今日開咗、未埋數嘅大局（冇就 null） */
export async function findTodaySession(g: string): Promise<string | null> {
  const snap = await getDocs(collection(fs(), 'groups', g, 'sessions'));
  const today = new Date().toDateString();
  const hit = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((x) => !x.data.closed && !x.data.legacy && x.data.createdAt && typeof x.data.createdAt.toDate === 'function' && x.data.createdAt.toDate().toDateString() === today)
    .sort((a, b) => b.data.createdAt.toMillis() - a.data.createdAt.toMillis())[0];
  return hit?.id ?? null;
}

/** 今晚唔用／恢復某個預設 Group */
export async function setSkipTeam(g: string, s: string, teamId: string, skip: boolean): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { skipTeams: skip ? arrayUnion(teamId) : arrayRemove(teamId) });
}

export async function removeSessionPerson(g: string, s: string, person: { id: string; name: string }): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { people: arrayRemove({ id: person.id, name: person.name }) });
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

/** 預設 Group（牌友圈層面）：每次埋數自動一齊計；全部成員同意先生效 */
export interface TeamDoc {
  id: string;
  members: string[];
  accepted: string[];
  by: string;
}

export const teamActive = (t: Pick<TeamDoc, 'members' | 'accepted'>) => t.members.length >= 2 && t.members.every((id) => t.accepted.includes(id));

/** 局主開嘅 Group 即刻生效；成員開嘅要其他人同意 */
export async function createTeam(g: string, by: string, members: string[], byOwner = false): Promise<void> {
  const ref = doc(collection(fs(), 'groups', g, 'teams'));
  await setDoc(ref, { members, accepted: byOwner ? members : members.includes(by) ? [by] : [], by, at: serverTimestamp() });
}

export async function acceptTeam(g: string, id: string, uid: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'teams', id), { accepted: arrayUnion(uid) });
}

export async function deleteTeam(g: string, id: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', g, 'teams', id));
}

/** pair 生效：兩個人入面，有帳戶嘅都同意咗 */
export const pairActive = (p: Pick<PairDoc, 'a' | 'b' | 'accepted'>) =>
  [p.a, p.b].every((id) => isGuest(id) || p.accepted.includes(id));

/** 輸家揀「不找」：記低，全枱唔再問，可以繼續入數 */
export async function declineSettle(g: string, s: string, t: string, key: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s, 'tables', t), { declined: arrayUnion(key) });
}

export const fanTableOf = (g: Group | null | undefined): FanTable =>
  g?.fanTable && Array.isArray(g.fanTable.sections) && g.fanTable.sections.length ? g.fanTable : DEFAULT_FAN_TABLE;

/** 淨係局主改得；記低改咗乜，同圈成員會收到提示 */
export async function saveFanTable(g: string, table: FanTable | null, by: { uid: string; name: string; changes: string[] }): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g), {
    fanTable: table ?? deleteField(),
    fanTableLog: { at: serverTimestamp(), by: by.uid, byName: by.name, changes: by.changes.slice(0, 12) },
  });
}

// ---------- 刪除（局主／超級管理員） ----------
async function deleteRefs(refs: { path: string }[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(fs());
    for (const r of refs.slice(i, i + 400)) batch.delete(doc(fs(), r.path));
    await batch.commit();
  }
}

async function listRefs(...path: string[]): Promise<{ path: string }[]> {
  const [first, ...rest] = path;
  const snap = await getDocs(collection(fs(), first, ...rest));
  return snap.docs.map((d) => ({ path: d.ref.path }));
}

/** 刪除成個大局：每張枱嘅每一鋪、開支、GP、換人請求，最後大局本身 */
export async function deleteSession(g: string, s: string): Promise<void> {
  const base = ['groups', g, 'sessions', s];
  const tables = await listRefs(...base, 'tables');
  for (const t of tables) {
    const id = t.path.split('/').pop() ?? '';
    await deleteRefs(await listRefs(...base, 'tables', id, 'events'));
  }
  await deleteRefs([
    ...tables,
    ...(await listRefs(...base, 'expenses')),
    ...(await listRefs(...base, 'pairs')),
    ...(await listRefs(...base, 'requests')),
  ]);
  await deleteRefs([{ path: base.join('/') }]);
}

/** 刪除一張枱（連每一鋪） */
export async function deleteTable(g: string, s: string, t: string): Promise<void> {
  await deleteRefs(await listRefs('groups', g, 'sessions', s, 'tables', t, 'events'));
  await deleteRefs([{ path: ['groups', g, 'sessions', s, 'tables', t].join('/') }]);
}

/** 刪除成個牌友圈：所有大局、成員，最後牌友圈本身 */
export async function deleteGroup(g: string): Promise<void> {
  const sessions = await listRefs('groups', g, 'sessions');
  for (const s of sessions) await deleteSession(g, s.path.split('/').pop() ?? '');
  await deleteRefs(await listRefs('groups', g, 'joinRequests').catch(() => []));
  await deleteRefs(await listRefs('groups', g, 'teams').catch(() => []));
  const snap = await getDoc(doc(fs(), 'groups', g)).catch(() => null);
  const code = snap?.exists() ? snap.data().joinCode : null;
  if (code) await deleteDoc(doc(fs(), 'codes', String(code))).catch(() => undefined);
  await deleteRefs(await listRefs('groups', g, 'members'));
  await deleteRefs([{ path: `groups/${g}` }]);
}

export async function removeMember(g: string, uid: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', g, 'members', uid));
}

/** 讀得到 admin/check 就係超級管理員 */
export async function checkSuperAdmin(): Promise<boolean> {
  try {
    await getDoc(doc(fs(), 'admin', 'check'));
    return true;
  } catch {
    return false;
  }
}

/** 超級管理員：列出所有牌友圈 */
export async function listAllGroups(): Promise<{ id: string; name: string; ownerId: string }[]> {
  const snap = await getDocs(collection(fs(), 'groups'));
  return snap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? ''), ownerId: String(d.data().ownerId ?? '') }));
}

// ---------- 大局：水、抽唔抽水、埋數 ----------
const sessionDoc = (g: string, s: string) => doc(fs(), 'groups', g, 'sessions', s);

export async function setSessionWaterTo(g: string, s: string, uid: string): Promise<void> {
  await updateDoc(sessionDoc(g, s), { waterTo: uid });
}

export async function setSessionNoWater(g: string, s: string, noWater: boolean): Promise<void> {
  await updateDoc(sessionDoc(g, s), { noWater });
}

export async function requestClose(g: string, s: string, uid: string): Promise<void> {
  await updateDoc(sessionDoc(g, s), { closeReq: { by: uid, approvals: [uid] } });
}

export async function approveClose(g: string, s: string, uid: string): Promise<void> {
  await updateDoc(sessionDoc(g, s), { 'closeReq.approvals': arrayUnion(uid) });
}

export async function cancelClose(g: string, s: string): Promise<void> {
  await updateDoc(sessionDoc(g, s), { closeReq: null });
}

/** 埋數：未完場嘅枱逐張入「完場」（拉住嘅數即找），再鎖住大局 */
export async function closeSession(g: string, s: string, uid: string, openTables: string[], payout?: Payout): Promise<void> {
  for (const t of openTables) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await appendEvent(g, s, t, await nextSeq(g, s, t), uid, { type: 'end' });
        break;
      } catch (err) {
        if (!(err instanceof ConflictError) || attempt === 2) throw err;
      }
    }
  }
  await updateDoc(sessionDoc(g, s), { closed: { by: uid, at: Date.now() }, closeReq: null, ...(payout ? { payout: clean(payout) } : {}) });
}

// ---------- 匯入舊紀錄 ----------
export const LEGACY = 'old:';
export const isLegacyId = (id: string) => id.startsWith(LEGACY);

export interface LegacyFile {
  format: 'jeukbou-legacy-v1';
  source: string;
  players: { key: string; name: string; payTo?: string }[];
  sessions: { date: string; paid: boolean; totals: Record<string, number>; water: number }[];
}

export function parseLegacy(text: string): LegacyFile {
  const d = JSON.parse(text) as LegacyFile;
  if (d.format !== 'jeukbou-legacy-v1' || !Array.isArray(d.sessions) || !Array.isArray(d.players)) throw new Error('檔案格式不正確');
  return d;
}

/** 舊紀錄 key → 成員 uid（局主配對優先，其次成員自己認領） */
export function legacyMap(g: Group | null | undefined, members: Member[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of members) if (m.legacyKey) out[m.legacyKey] = m.uid;
  Object.assign(out, g?.aliases ?? {});
  return out;
}

/** 匯入：可以先刪晒現有大局；每一場變一個冇枱嘅大局 */
export async function importLegacy(
  g: string, uid: string, file: LegacyFile, wipe: boolean, onProgress: (msg: string) => void,
): Promise<void> {
  if (wipe) {
    const existing = await getDocs(collection(fs(), 'groups', g, 'sessions'));
    let i = 0;
    for (const d of existing.docs) {
      i += 1;
      onProgress(`刪除舊大局 ${i}/${existing.size}`);
      await deleteSession(g, d.id);
    }
  }
  const names: Record<string, string> = {};
  for (const p of file.players) names[p.key] = p.name;
  await updateDoc(doc(fs(), 'groups', g), { legacyNames: names });
  for (let i = 0; i < file.sessions.length; i += 200) {
    const batch = writeBatch(fs());
    for (const s of file.sessions.slice(i, i + 200)) {
      const [y, m, day] = s.date.split('-').map(Number);
      const at = new Date(y, m - 1, day, 20, 0, 0);
      const ref = doc(collection(fs(), 'groups', g, 'sessions'));
      batch.set(ref, {
        name: `${m}月${day}日 舊紀錄`,
        createdBy: uid,
        createdAt: TimestampCtor.fromDate(at),
        legacy: { totals: s.totals, water: s.water, paid: !!s.paid },
      });
    }
    onProgress(`匯入 ${Math.min(i + 200, file.sessions.length)}/${file.sessions.length} 場`);
    await batch.commit();
  }
}

/** 局主配對（uid 空白 = 取消） */
export async function setLegacyAlias(g: string, key: string, uid: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g), { [`aliases.${key}`]: uid || deleteField() });
}

/** 成員認領自己（key 空白 = 取消） */
export async function claimLegacy(g: string, uid: string, key: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'members', uid), { legacyKey: key || deleteField() });
}
