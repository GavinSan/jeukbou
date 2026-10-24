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
  limit,
  orderBy,
  query,
  runTransaction,
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
import { regionOfTz } from './payMethods.ts';
import type { PayMethod } from './payMethods.ts';

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
  /** 牌友圈 icon：一個 emoji，或者細圖（data URL） */
  icon?: string;
  /** 簡介，例如「25 抽 1・私人局」 */
  description?: string;
  /** public = 人哋搜尋得到（加唔加入仍然跟加入方式）；private = 要邀請 */
  visibility?: 'public' | 'private';
  /** 麻雀打法（牌型）：開牌友圈時揀，之後唔改得；冇 = 港式台牌 */
  variant?: string;
  /** 開牌友圈時局主喺邊（時區估）：HK、CA、US… */
  region?: string;
}

/** 成員權限：局主分配 */
export type Perm = 'approve' | 'remove' | 'records' | 'rules';
export const PERMS: { key: Perm; label: string; note: string }[] = [
  { key: 'approve', label: '批人入', note: '批准或拒絕加入申請' },
  { key: 'remove', label: '移除成員', note: '將人移出牌友圈' },
  { key: 'records', label: '管紀錄', note: '刪除大局／枱、埋數後仍然可以改開支' },
  { key: 'rules', label: '改家規', note: '改家規、番數表、水由誰保管' },
];

/** 我喺呢個牌友圈做唔做得某樣嘢（局主同超級管理員乜都得） */
export function canDo(g: Pick<Group, 'ownerId'> | null | undefined, me: Pick<Member, 'perms'> | null | undefined, uid: string, admin: boolean, perm: Perm): boolean {
  if (admin) return true;
  if (!g) return false;
  if (g.ownerId === uid) return true;
  return !!me?.perms?.includes(perm);
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
  /** 收款方法（淨係佢揀咗顯示嘅） */
  pay?: PayMethod[];
  /** 生日（MM-DD），同圈嘅人見到 */
  birthday?: string;
  /** 局主分配嘅權限 */
  perms?: Perm[];
}

export interface Session {
  id: string;
  name: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  /** 是日終結：幾時撳（毫秒）同邊個撳；之後再開枱就清返 */
  endedAt?: number | null;
  endedBy?: string;
  /** 開局嗰陣複製咗牌友圈嘅家規；舊大局冇就用牌友圈嘅 */
  rules?: RulesPatch;
  /** 中途改家規嘅紀錄：每鋪用當時嘅家規（at = 毫秒；第一條 at = 0 係開局時嘅家規） */
  rulesLog?: { at: number; rules: RulesPatch }[];
  /** 水由誰保管；冇就係場主（開局嗰個） */
  waterTo?: string;
  /** 呢局唔抽水（打牌嘅人揀） */
  noWater?: boolean;
  /** 直播室禁言：uid → 幾時解禁（毫秒） */
  chatBlock?: Record<string, number>;
  /** 有人夠拉（被拉三、六…）通知邊個：off／呢張枱／成個大局／成個牌友圈 */
  pullPush?: PullPush;
  /** 已埋數 */
  closed?: { by: string; at: number } | null;
  /** 申請埋數（非場主）：要晒有帳戶嘅玩家同意 */
  closeReq?: { by: string; approvals: string[] } | null;
  /** 由 Google Sheet 匯入嘅舊紀錄：每人番數（key 係舊紀錄玩家），冇枱 */
  legacy?: { totals: Record<string, number>; water: number; paid: boolean } | null;
  /** 埋數嗰陣嘅轉賬（麻雀＋水＋開支合併）；Group 嘅 key 係「a + b」 */
  payout?: Payout | null;
  /** 邊幾筆已經轉咗：key = from>to */
  /** ok = false：俾錢嘅人話轉咗，等收錢嘅人確認 */
  paid?: Record<string, PaidMark>;
  /** 今日有份但冇打牌嘅人（成員或者訪客），開支用 */
  people?: { id: string; name: string }[];
  /** 今晚唔用嘅預設 Group（team id） */
  skipTeams?: string[];
  /** 幾張枱一齊執位（抽牌） */
  draw?: Draw | null;
  /** 電視直播播緊嘅音樂（YouTube／Spotify／Apple Music 連結） */
  music?: string;
}

/** 一齊執位：X 張枱 = X × 4 隻牌（壹貳參肆…），同一隻字 = 同一張枱 */
export interface Draw {
  id: string;
  by: string;
  at: number;
  /** pick = 每人自己揀牌；auto = 電腦派 */
  mode: 'pick' | 'auto';
  /** 原本打緊嘅枱（會完場，除非同一班人坐返一齊揀繼續） */
  tables: string[];
  /** 參加嘅人（可以減走離開嘅、加新嚟嘅） */
  players: { id: string; name: string }[];
  /** 每隻牌係第幾張枱（0 起），已經洗亂 */
  tiles: number[];
  /** 邊隻牌（index）俾邊個揀咗 */
  picks: Record<string, string>;
  /** 揀牌次序（全場排名高嘅先） */
  order: string[];
  /** propose = 等其他枱同意；picking = 揀緊；done = 揀晒 */
  status: 'propose' | 'picking' | 'done';
  approvals: string[];
  /** 由高分到低分輪住揀：輪到先揀得（場主可以幫冇電話嘅人揀，但唔可以跳位） */
  strict?: boolean;
}

/** 輪到邊個揀（未揀嘅人入面排最前） */
export const drawNext = (d: Pick<Draw, 'order' | 'picks'>): string | undefined => {
  const done = new Set(Object.values(d.picks));
  return d.order.find((id) => !done.has(id));
};

/** 約局：約將來嘅日子同時間，大家應去唔去 */
export interface Meetup {
  id: string;
  by: string;
  byName: string;
  at: number;
  place: string;
  note: string;
  going: string[];
  maybe: string[];
  no: string[];
  names: Record<string, string>;
  createdAt: number;
  /** 想開幾多枱（1 = 4 個人）；人多過咗照樣可以加入 */
  tables: number;
}

export async function createMeetup(g: string, user: User, m: { at: number; place: string; note: string; tables?: number }): Promise<void> {
  await setDoc(doc(collection(fs(), 'groups', g, 'meetups')), {
    by: user.uid, byName: displayName(user), at: m.at, place: m.place.trim().slice(0, 60), note: m.note.trim().slice(0, 200),
    going: [user.uid], maybe: [], no: [], names: { [user.uid]: displayName(user) }, createdAt: Date.now(),
    tables: Math.max(1, Math.min(10, Math.round(m.tables ?? 1))),
    // 伺服器發通知時用嚟寫返當地時間
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  });
}

/** 開約局嗰個改：日子時間、地點、枱數、備註（已經應咗嘅人會收到通知） */
export async function updateMeetup(g: string, id: string, m: { at: number; place: string; note: string; tables: number }): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'meetups', id), {
    at: m.at, place: m.place.trim().slice(0, 60), note: m.note.trim().slice(0, 200),
    tables: Math.max(1, Math.min(10, Math.round(m.tables))),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  });
}

/** 應約：去／唔去（一揀咗就係其中一樣；舊嘅「可能」會清走） */
export async function rsvpMeetup(g: string, id: string, user: User, status: 'going' | 'no'): Promise<void> {
  const uid = user.uid;
  await updateDoc(doc(fs(), 'groups', g, 'meetups', id), {
    going: status === 'going' ? arrayUnion(uid) : arrayRemove(uid),
    maybe: arrayRemove(uid),
    no: status === 'no' ? arrayUnion(uid) : arrayRemove(uid),
    [`names.${uid}`]: displayName(user),
  });
}

/** 約局嘅局主：開局嗰個仲去就係佢；佢改咗唔去，就由最早應「去」嗰個接手（可以取消約局） */
export function meetupHost(m: Pick<Meetup, 'by' | 'going'>): string {
  return m.going.includes(m.by) || !m.going.length ? m.by : m.going[0];
}

export async function deleteMeetup(g: string, id: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', g, 'meetups', id));
}

/** 鬼馬啲嘅人數講法（可以約多過一枱） */
export function meetupMood(n: number, tables = 1): string {
  if (n <= 0) return '未有人應';
  const full = Math.floor(n / 4);
  const rem = n % 4;
  if (full === 0) return rem === 1 ? '一缺三，快啲搵人！' : rem === 2 ? '二缺二，再嗌多兩個' : '三缺一！仲差一個 🔥';
  if (rem === 0) {
    if (full < tables) return `夠 ${full} 枱，想開 ${tables} 枱，再嗌 ${(tables - full) * 4} 個`;
    return full === 1 ? '夠腳！開枱 🀄 想打多枱照加入' : `${full} 枱都夠腳！🀄`;
  }
  const lack = rem === 1 ? '一缺三' : rem === 2 ? '二缺二' : '三缺一 🔥';
  return `夠 ${full} 枱・第 ${full + 1} 枱${lack}`;
}

/** 直播室留言 */
export async function sendChat(g: string, s: string, user: User, text: string): Promise<void> {
  const t = text.trim().slice(0, 200);
  if (!t) return;
  // 同一次寫埋 chatLast：規則用嚟限每 2 秒最多一句
  const b = writeBatch(fs());
  b.set(doc(collection(fs(), 'groups', g, 'sessions', s, 'chat')), { by: user.uid, name: displayName(user), text: t, at: serverTimestamp() });
  b.set(doc(fs(), 'groups', g, 'sessions', s, 'chatLast', user.uid), { at: serverTimestamp() });
  await b.commit();
}

/** 問題回報／建議（可以附一張細相）：淨係超級管理員睇到；每分鐘最多一次 */
export interface FeedbackDoc { id: string; uid: string; name: string; email: string; text: string; image?: string; page: string; ua: string; at: number | null; kind: 'bug' | 'idea' }
export async function sendFeedback(user: User, input: { text: string; image?: string; kind: 'bug' | 'idea'; page: string }): Promise<void> {
  const t = input.text.trim().slice(0, 2000);
  if (!t) throw new Error('寫少少嘢先');
  const b = writeBatch(fs());
  b.set(doc(collection(fs(), 'feedback')), {
    uid: user.uid, name: displayName(user), email: user.email ?? '', text: t, kind: input.kind,
    ...(input.image ? { image: input.image } : {}),
    page: input.page.slice(0, 200), ua: (typeof navigator === 'undefined' ? '' : navigator.userAgent).slice(0, 300), at: serverTimestamp(),
  });
  b.set(doc(fs(), 'feedbackLast', user.uid), { at: serverTimestamp() });
  try { await b.commit(); } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'permission-denied') throw new Error('送得太密，隔一分鐘再試');
    throw err;
  }
}

/** 超級管理員：最近嘅問題回報 */
export async function loadFeedback(n = 50): Promise<FeedbackDoc[]> {
  const snap = await getDocs(query(collection(fs(), 'feedback'), orderBy('at', 'desc'), limit(n)));
  return snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, uid: x.uid, name: x.name ?? '', email: x.email ?? '', text: x.text ?? '', image: x.image, page: x.page ?? '', ua: x.ua ?? '', at: x.at?.toMillis?.() ?? null, kind: x.kind === 'idea' ? 'idea' : 'bug' };
  });
}
export async function deleteFeedback(id: string): Promise<void> {
  await deleteDoc(doc(fs(), 'feedback', id));
}

/** 直播室禁言（場主、局主、超級管理員）：until = 幾時解禁（毫秒）；0 = 即刻解禁 */
export async function setChatBlock(g: string, s: string, uid: string, until: number): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { [`chatBlock.${uid}`]: until > Date.now() ? until : deleteField() });
}

export async function setSessionMusic(g: string, s: string, url: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { music: url.trim() || deleteField() });
}

export const UPPER_NUM = ['壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖', '拾'];
export const tableNameUpper = (i: number) => `第${UPPER_NUM[i] ?? String(i + 1)}枱`;

export async function startDraw(g: string, s: string, draw: Draw): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { draw: clean(draw) });
}

export async function cancelDraw(g: string, s: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { draw: deleteField() });
}

/** 同意執位：每張原本嘅枱有一個人同意就開始 */
export async function approveDraw(g: string, s: string, uid: string, seatsOf: Record<string, string[]>): Promise<void> {
  const ref = doc(fs(), 'groups', g, 'sessions', s);
  await runTransaction(fs(), async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data()?.draw as Draw | undefined;
    if (!d || d.status !== 'propose') return;
    const approvals = [...new Set([...d.approvals, uid])];
    const ok = d.tables.every((t) => (seatsOf[t] ?? []).some((p) => approvals.includes(p)));
    tx.update(ref, { 'draw.approvals': approvals, ...(ok ? { 'draw.status': 'picking' } : {}) });
  });
}

/** 揀牌：用 transaction，兩個人同時撳同一隻，只會有一個成功 */
export async function pickTile(g: string, s: string, tile: number, player: string): Promise<'ok' | 'taken' | 'done-already' | 'not-turn'> {
  const ref = doc(fs(), 'groups', g, 'sessions', s);
  return runTransaction(fs(), async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data()?.draw as Draw | undefined;
    if (!d || d.status !== 'picking') return 'taken';
    if (d.picks[String(tile)]) return 'taken';
    if (Object.values(d.picks).includes(player)) return 'done-already';
    if (d.strict && drawNext(d) !== player) return 'not-turn';
    const picks = { ...d.picks, [String(tile)]: player };
    const done = Object.keys(picks).length >= d.tiles.length;
    tx.update(ref, { [`draw.picks.${tile}`]: player, ...(done ? { 'draw.status': 'done' } : {}) });
    return 'ok';
  });
}

/** 電腦派：未揀嘅人隨機派晒剩低嘅牌 */
export async function autoDeal(g: string, s: string): Promise<void> {
  const ref = doc(fs(), 'groups', g, 'sessions', s);
  await runTransaction(fs(), async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data()?.draw as Draw | undefined;
    if (!d || (d.status !== 'picking' && d.status !== 'propose')) return;
    const used = new Set(Object.values(d.picks));
    const left = d.players.map((p) => p.id).filter((id) => !used.has(id));
    const free = d.tiles.map((_, i) => i).filter((i) => !d.picks[String(i)]);
    for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
    const picks = { ...d.picks };
    left.forEach((id, k) => { if (free[k] !== undefined) picks[String(free[k])] = id; });
    tx.update(ref, { 'draw.picks': picks, 'draw.status': 'done' });
  });
}

/** 執位生效：原本嘅枱完場（拉住嘅數找晒），開新枱；同一班人坐返一齊又揀「繼續」嘅就保留原枱 */
export async function applyDraw(
  g: string, s: string, by: string,
  plan: { keep: string | null; seats: string[]; names: Record<string, string>; name: string }[],
  endTables: string[], startOrder: number,
): Promise<void> {
  for (const t of endTables) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await appendEvent(g, s, t, await nextSeq(g, s, t), by, { type: 'end' }); break; } catch (err) { if (!(err instanceof ConflictError) || attempt === 2) throw err; }
    }
  }
  let order = startOrder;
  for (const p of plan) {
    if (p.keep) continue;
    await addTable(g, s, order++, { name: p.name, seats: p.seats, names: p.names });
  }
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { draw: deleteField() });
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
export interface PaidMark { by: string; at: number; ok?: boolean }

/** 一筆轉賬嘅狀態：未轉、等確認（俾錢嘅人話轉咗）、搞掂 */
export function paidState(m: PaidMark | null | undefined): 'none' | 'pending' | 'done' {
  return !m ? 'none' : m.ok === false ? 'pending' : 'done';
}

/** pending = 俾錢嘅人撳「已轉」而牌友圈要收錢嘅人確認 */
export async function markPaid(g: string, s: string, key: string, uid: string, on: boolean, pending = false): Promise<void> {
  // lastPaid：規則用嚟核對改緊邊一筆（俾錢／收錢嘅人先改得，局主、場主就乜都改得）
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { [`paid.${key}`]: on ? { by: uid, at: Date.now(), ...(pending ? { ok: false } : {}) } : deleteField(), lastPaid: key });
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

/** 收款方法：存喺自己度；顯示嘅（show）同步去每個牌友圈嘅成員資料，等牌友找數時見到 */
export async function setPayMethods(user: User, list: PayMethod[], groupIds: string[]): Promise<void> {
  const clean = list.slice(0, 12).map((m) => JSON.parse(JSON.stringify(m)) as PayMethod);
  const shown = clean.filter((m) => m.show);
  // 舊版只識 Interac email：保留第一個顯示嘅 Interac email
  const legacy = shown.find((m) => m.kind === 'interac' && m.value.includes('@'))?.value ?? '';
  await setDoc(doc(fs(), 'users', user.uid), { payMethods: clean, payEmail: legacy || deleteField(), updatedAt: serverTimestamp() }, { merge: true });
  await Promise.all(groupIds.map(async (g) => {
    const ref = doc(fs(), 'groups', g, 'members', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { pay: shown, payEmail: legacy || deleteField() });
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
  /** 俾錢嗰個撳「已轉」之後，要收錢嗰個確認先算數 */
  confirmPay?: boolean;
  /** 顯示貨幣（閂 = 預設港幣，唔顯示貨幣代號）；舊牌友圈冇設定 = 顯示 */
  showCurrency?: boolean;
}

export const DEFAULT_SETTLE: SettleConfig = { currency: 'CAD', perUnit: 6, waterTo: '', rounding: 'none' };

export function settleConfigOf(g: Group | null | undefined): SettleConfig {
  const raw = (g?.settle ?? {}) as Partial<SettleConfig> & { roundUp?: boolean };
  const c = { ...DEFAULT_SETTLE, ...raw };
  // 舊設定只有 roundUp
  if (!raw.rounding && raw.roundUp !== undefined) c.rounding = raw.roundUp ? 'up' : 'none';
  delete (c as { roundUp?: boolean }).roundUp;
  if (!c.waterTo && g) c.waterTo = g.ownerId;
  if (c.showCurrency === undefined) c.showCurrency = true;
  return c;
}

/** 開支（晚餐、的士…）或者已經私下轉咗嘅錢；同麻雀數分開 */
export interface ExpenseDoc {
  id: string;
  /** expense 開支；transfer 已經私下轉咗；gift 請飲茶／打賞（payer 請 sharedBy[0]，埋數時一齊找） */
  kind: 'expense' | 'transfer' | 'gift';
  label: string;
  payer: string;
  amount: number;
  /** 分嘅人；transfer 就係收錢嗰個；gift 就係被請嗰個 */
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
  /** 枱上而家有帳戶嘅人（新枱先有；舊枱冇 = undefined） */
  liveUsers?: string[];
  /** 最近一次擲骰（全枱見到） */
  dice?: Dice | null;
  /** 夠拉時輸家揀咗「不找」：`puller>pulled#count`，全枱同步 */
  declined?: string[];
  /** 打完圈數，等其他枱一齊執位 */
  waitRegroup?: boolean;
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
export async function createGroup(user: User, name: string, photo: string | null = user.photoURL, opts: { variant?: string } = {}): Promise<string> {
  const ref = doc(collection(fs(), 'groups'));
  const inviteCode = randomCode();
  // 新牌友圈：預設用港幣、唔顯示貨幣；記低局主喺邊（由時區估），開咗「顯示貨幣」就跟呢個揀
  const region = regionOfTz();
  await setDoc(ref, {
    name, ownerId: user.uid, inviteCode, joinMode: 'auto', rules: {}, createdAt: serverTimestamp(),
    region, settle: { currency: 'HKD', showCurrency: false }, variant: opts.variant || 'hktw',
  });
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
/** 雀壇名 → 唯一 key（細楷、去頭尾空白、多個空白當一個；「/」唔用得做 id） */
export const nameKeyOf = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\//g, '∕');

export class NameTakenError extends Error {
  constructor(name: string) { super(`「${name}」已經有人用緊，諗過第個`); }
}

/**
 * 認領雀壇名（全 app 唯一）：有人用緊就 NameTakenError。
 * 第一次認領（冇 nameKey）免費；之後每改一次用一張改名卷（renames + 1，資料庫規則會核對）。
 */
export async function claimName(user: User, raw: string): Promise<void> {
  const name = raw.trim();
  if (!name) throw new Error('請輸入雀壇名');
  const key = nameKeyOf(name);
  await runTransaction(fs(), async (tx) => {
    const nref = doc(fs(), 'names', key);
    const uref = doc(fs(), 'users', user.uid);
    const [ns, us] = await Promise.all([tx.get(nref), tx.get(uref)]);
    if (ns.exists() && ns.data().uid !== user.uid) throw new NameTakenError(name);
    const u = us.exists() ? us.data() : {};
    const oldKey: string | null = typeof u.nameKey === 'string' ? u.nameKey : null;
    const renames = Number(u.renames ?? 0) + (oldKey && u.name !== name ? 1 : 0);
    tx.set(nref, { uid: user.uid, name, at: serverTimestamp() });
    if (oldKey && oldKey !== key) tx.delete(doc(fs(), 'names', oldKey));
    tx.set(uref, { name, nameKey: key, renames, updatedAt: serverTimestamp() }, { merge: true });
  });
}

/** 個名有冇人用緊（改名時即時提示） */
export async function nameTaken(user: User, raw: string): Promise<boolean> {
  const key = nameKeyOf(raw);
  if (!key) return false;
  const snap = await getDoc(doc(fs(), 'names', key));
  return snap.exists() && snap.data().uid !== user.uid;
}

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

/** 枱上而家有帳戶嘅人（訪客唔計）：資料庫規則用嚟決定邊個可以入數、擲骰 */
export const liveUsersOf = (seats: string[]) => seats.filter((id) => !isGuest(id));

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
    batch.set(tableRef, { name: t.name, order: i, seats: t.seats, names: t.names, liveUsers: liveUsersOf(t.seats), createdAt: serverTimestamp() });
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
  /** 換人：req = 換人請求 id（未坐低嘅人接受邀請）；pair = 由邊張枱對調過嚟。規則用嚟核對 */
  extra?: { req?: string; pair?: string },
): Promise<void> {
  const ref = doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId, 'events', pad(seq));
  try {
    await setDoc(ref, { seq, by, event: clean(event), at: serverTimestamp(), ...(extra ?? {}) });
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
  await setDoc(ref, { name: table.name, order, seats: table.seats, names: table.names, liveUsers: liveUsersOf(table.seats), createdAt: serverTimestamp() });
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
  via?: { req?: string; pair?: string },
): Promise<void> {
  const ref = doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId);
  const snap = await getDoc(ref);
  const cur = snap.get('liveUsers');
  // 先入紀錄（規則睇入數嗰陣邊個坐喺度），再更新枱上嘅人
  const extra = { ...(via?.req ? { req: via.req } : {}), ...(via?.pair ? { pair: via.pair } : {}) };
  try {
    await appendEvent(groupId, sessionId, tableId, await nextSeq(groupId, sessionId, tableId), by, { type: 'swap', out, in: incoming }, extra);
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    // 啱啱有人入咗數，攞過新序號再試一次
    await appendEvent(groupId, sessionId, tableId, await nextSeq(groupId, sessionId, tableId), by, { type: 'swap', out, in: incoming }, extra);
  }
  const patch: Record<string, unknown> = { [`names.${incoming}`]: inName };
  // 舊枱冇 liveUsers 就照舊（規則用 names）
  if (Array.isArray(cur)) patch.liveUsers = [...cur.map(String).filter((x) => x !== out), ...(isGuest(incoming) ? [] : [incoming])].filter((x, i, a) => a.indexOf(x) === i);
  if (via?.req) patch.lastReq = via.req;
  if (via?.pair) patch.lastPair = via.pair;
  await updateDoc(ref, patch);
}

/** 舊枱補返 liveUsers（坐喺度嘅人開枱時自動做） */
export async function backfillLiveUsers(groupId: string, sessionId: string, tableId: string, seats: string[]): Promise<void> {
  await updateDoc(doc(fs(), 'groups', groupId, 'sessions', sessionId, 'tables', tableId), { liveUsers: liveUsersOf(seats) });
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
    await applySwap(groupId, sessionId, req.tableId, user.uid, req.out, req.in, displayName(user), { req: req.id });
    // 由另一張枱過嚟：嗰張枱就由離開嗰個補上（對調）
    if (req.fromTable) await applySwap(groupId, sessionId, req.fromTable, user.uid, req.in, req.out, req.outName ?? '玩家', { pair: req.tableId });
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

/** 局主設定成員權限 */
export async function setMemberPerms(g: string, uid: string, perms: Perm[]): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'members', uid), { perms });
}

/** 牌友圈資料：icon、簡介、公開／私人；公開嘅會放一份去 publicGroups 俾人搜尋 */
export async function updateGroupProfile(g: Group, p: { name?: string; icon: string; description: string; visibility: 'public' | 'private' }, memberCount: number): Promise<void> {
  const icon = p.icon.slice(0, 200000);
  const name = (p.name ?? g.name).trim().slice(0, 30) || g.name;
  await updateDoc(doc(fs(), 'groups', g.id), { name, icon: icon || deleteField(), description: p.description.trim().slice(0, 200) || deleteField(), visibility: p.visibility });
  const pub = doc(fs(), 'publicGroups', g.id);
  if (p.visibility === 'public') {
    await setDoc(pub, {
      name, icon, description: p.description.trim().slice(0, 200), inviteCode: g.inviteCode, joinMode: g.joinMode ?? 'auto',
      members: memberCount, updatedAt: serverTimestamp(),
    });
  } else {
    await deleteDoc(pub).catch(() => undefined);
  }
}

export interface PublicGroup {
  id: string;
  name: string;
  icon: string;
  description: string;
  inviteCode: string;
  joinMode: JoinMode;
  members: number;
}

export async function loadPublicGroups(): Promise<PublicGroup[]> {
  const snap = await getDocs(collection(fs(), 'publicGroups'));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id, name: String(x.name ?? ''), icon: String(x.icon ?? ''), description: String(x.description ?? ''),
      inviteCode: String(x.inviteCode ?? ''), joinMode: x.joinMode === 'approve' || x.joinMode === 'closed' ? x.joinMode : 'auto', members: Number(x.members ?? 0),
    };
  });
}

export async function removeMember(g: string, uid: string): Promise<void> {
  await deleteDoc(doc(fs(), 'groups', g, 'members', uid));
}

/** 超級管理員：設定某款風格點開放（auto＝跟段位／要授權、open＝全部人、closed＝暫停） */
export async function setSkinMode(skin: string, mode: 'auto' | 'open' | 'closed'): Promise<void> {
  await setDoc(doc(fs(), 'config', 'skins'), { modes: { [skin]: mode } }, { merge: true });
}

/** 超級管理員：一款風格點開放。default = 預設；open = 全部人；closed = 暫停；grant = 要授權；數字 = 升到第幾個段位 */
export async function setSkinRule(skin: string, rule: 'default' | 'open' | 'closed' | 'grant' | number): Promise<void> {
  const mode = rule === 'open' ? 'open' : rule === 'closed' ? 'closed' : 'auto';
  const tier = rule === 'grant' ? -2 : typeof rule === 'number' ? rule : null;
  await setDoc(doc(fs(), 'config', 'skins'), { modes: { [skin]: mode }, tiers: { [skin]: tier === null ? deleteField() : tier } }, { merge: true });
}

/** 超級管理員：開／收一款豪華風格俾某個用家 */
export async function setSkinGrant(uid: string, skin: string, on: boolean): Promise<void> {
  await setDoc(doc(fs(), 'skinGrants', uid), { skins: on ? arrayUnion(skin) : arrayRemove(skin) }, { merge: true });
}

/** 超級管理員：所有人嘅豪華風格授權 */
export async function listSkinGrants(): Promise<Record<string, string[]>> {
  const snap = await getDocs(collection(fs(), 'skinGrants'));
  return Object.fromEntries(snap.docs.map((d) => [d.id, Array.isArray(d.get('skins')) ? d.get('skins').map(String) : []]));
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

export type PullPush = 'off' | 'table' | 'session' | 'group';
/** 等執位：打完圈數嘅枱等其他枱打完一齊執位；on = false 就取消（例如決定打快東） */
export async function setTableWait(g: string, s: string, t: string, on: boolean): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s, 'tables', t), on ? { waitRegroup: true, waitAt: Date.now() } : { waitRegroup: deleteField(), waitAt: deleteField() });
}

/** 是日終結（冇枱打緊先撳得）：記低時間，計「打咗幾耐」；on = false 就取消 */
export async function setSessionEnded(g: string, s: string, user: User, on: boolean): Promise<void> {
  await updateDoc(sessionDoc(g, s), on ? { endedAt: Date.now(), endedBy: user.uid } : { endedAt: deleteField(), endedBy: deleteField() });
}

export async function setSessionPullPush(g: string, s: string, v: PullPush): Promise<void> {
  await updateDoc(sessionDoc(g, s), { pullPush: v });
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

/** 一次過配對幾個舊紀錄名（例如同一個人喺唔同場寫法唔同） */
export async function setLegacyAliases(g: string, pairs: Record<string, string>): Promise<void> {
  const patch: Record<string, string> = {};
  for (const [k, uid] of Object.entries(pairs)) if (uid) patch[`aliases.${k}`] = uid;
  if (Object.keys(patch).length) await updateDoc(doc(fs(), 'groups', g), patch);
}

/** 舊紀錄名比較：細楷、去標點，用第一個字（「ATHENA C.」=「Athena」） */
export function legacyStem(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').trim().split(' ')[0] ?? '';
}

/** 成員認領自己（key 空白 = 取消） */
export async function claimLegacy(g: string, uid: string, key: string): Promise<void> {
  await updateDoc(doc(fs(), 'groups', g, 'members', uid), { legacyKey: key || deleteField() });
}
