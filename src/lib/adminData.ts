// 超級管理員用嘅讀寫：所有牌友圈、用家、任何一份文件（規則淨係俾超級管理員）
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { nameKeyOf } from './data.ts';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase.ts';
import { fs } from './data.ts';

export interface AdminGroup {
  id: string;
  name: string;
  ownerId: string;
  members: { uid: string; name: string; email?: string }[];
  sessions: { id: string; name: string; at: number; closed: boolean; legacy: boolean }[];
  joinMode: string;
  joinCode: string;
}

export interface AdminUser {
  uid: string;
  name: string;
  email: string;
  payEmail: string;
  renameGrants?: number;
  groups: string[];
  updatedAt: number;
  firstName: string;
  lastName: string;
  birthday: string;
}

const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);

export async function loadAllGroups(): Promise<AdminGroup[]> {
  const snap = await getDocs(collection(fs(), 'groups'));
  return Promise.all(snap.docs.map(async (d) => {
    const data = d.data();
    const [m, s] = await Promise.all([getDocs(collection(fs(), 'groups', d.id, 'members')), getDocs(collection(fs(), 'groups', d.id, 'sessions'))]);
    return {
      id: d.id,
      name: String(data.name ?? ''),
      ownerId: String(data.ownerId ?? ''),
      joinMode: String(data.joinMode ?? 'auto'),
      joinCode: String(data.joinCode ?? ''),
      members: m.docs.map((x) => ({ uid: x.id, name: String(x.data().name ?? '玩家') })),
      sessions: s.docs.map((x) => ({ id: x.id, name: String(x.data().name ?? ''), at: ms(x.data().createdAt), closed: !!x.data().closed, legacy: !!x.data().legacy }))
        .sort((a, b) => b.at - a.at),
    };
  }));
}

export async function loadAllUsers(): Promise<AdminUser[]> {
  const snap = await getDocs(collection(fs(), 'users'));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      uid: d.id, name: String(x.name ?? ''), email: String(x.email ?? ''), payEmail: String(x.payEmail ?? ''), renameGrants: Number(x.renameGrants ?? 0),
      firstName: String(x.firstName ?? ''), lastName: String(x.lastName ?? ''), birthday: String(x.birthday ?? ''),
      groups: Array.isArray(x.groups) ? x.groups.map(String) : [], updatedAt: ms(x.updatedAt),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function renameGroup(g: string, name: string) {
  await updateDoc(doc(fs(), 'groups', g), { name });
}

export async function setOwner(g: string, uid: string) {
  await updateDoc(doc(fs(), 'groups', g), { ownerId: uid });
}

export async function reopenSession(g: string, s: string) {
  await updateDoc(doc(fs(), 'groups', g, 'sessions', s), { closed: null, closeReq: null });
}

/** 改用家顯示名：自己資料 + 所有牌友圈成員資料 */
export async function renameUser(u: AdminUser, name: string) {
  // 雀壇名全 app 唯一：管理員改都要認領；唔使改名卷
  const key = nameKeyOf(name);
  const taken = await getDoc(doc(fs(), 'names', key));
  if (taken.exists() && taken.data().uid !== u.uid) throw new Error(`「${name}」已經有人用緊`);
  const userSnap = await getDoc(doc(fs(), 'users', u.uid));
  const oldKey = userSnap.exists() ? userSnap.data().nameKey : null;
  await setDoc(doc(fs(), 'names', key), { uid: u.uid, name, at: Timestamp.now() });
  if (typeof oldKey === 'string' && oldKey !== key) await deleteDoc(doc(fs(), 'names', oldKey));
  await setDoc(doc(fs(), 'users', u.uid), { name, nameKey: key }, { merge: true });
  await Promise.all(u.groups.map(async (g) => {
    const ref = doc(fs(), 'groups', g, 'members', u.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { name });
  }));
}

/** 送改名卷（總數） */
export async function grantRename(uid: string, total: number) {
  await setDoc(doc(fs(), 'users', uid), { renameGrants: Math.max(0, Math.round(total)) }, { merge: true });
}

/** 加用家入牌友圈（唔使邀請碼） */
export async function addToGroup(u: AdminUser, g: string) {
  const gSnap = await getDoc(doc(fs(), 'groups', g));
  if (!gSnap.exists()) throw new Error('搵唔到呢個牌友圈');
  await setDoc(doc(fs(), 'groups', g, 'members', u.uid), { name: u.name || '玩家', photoURL: null, inviteCode: String(gSnap.data().inviteCode ?? ''), joinedAt: Timestamp.now() });
  await setDoc(doc(fs(), 'users', u.uid), { groups: [...new Set([...u.groups, g])] }, { merge: true });
}

export async function removeFromGroup(uid: string, g: string, groups: string[]) {
  await deleteDoc(doc(fs(), 'groups', g, 'members', uid));
  await setDoc(doc(fs(), 'users', uid), { groups: groups.filter((x) => x !== g) }, { merge: true });
}

/** 寄重設密碼 email（只係 Email 登入嘅帳戶有用；Google 登入嘅唔使密碼） */
export async function sendReset(email: string) {
  if (!auth) throw new Error('未設定登入');
  await sendPasswordResetEmail(auth, email.trim());
}

// ---------- 文件瀏覽 ----------
/** Firestore 值 → 可以編輯嘅 JSON（時間變 {"__time": 毫秒}） */
export function toJson(v: unknown): unknown {
  if (v instanceof Timestamp) return { __time: v.toMillis() };
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toJson(x)]));
  return v;
}

export function fromJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.__time === 'number') return Timestamp.fromMillis(o.__time);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fromJson(x)]));
  }
  return v;
}

const parts = (path: string) => path.split('/').map((x) => x.trim()).filter(Boolean);

export async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const p = parts(path);
  if (p.length % 2) throw new Error('文件路徑要雙數段，例如 groups/abc');
  const snap = await getDoc(doc(fs(), p[0], ...p.slice(1)));
  return snap.exists() ? (toJson(snap.data()) as Record<string, unknown>) : null;
}

export async function listCollection(path: string): Promise<{ id: string; preview: string }[]> {
  const p = parts(path);
  if (!(p.length % 2)) throw new Error('集合路徑要單數段，例如 groups 或者 groups/abc/sessions');
  const snap = await getDocs(collection(fs(), p[0], ...p.slice(1)));
  return snap.docs.map((d) => {
    const x = d.data();
    const label = x.name ?? x.label ?? x.email ?? (x.event?.type ? `第 ${x.seq} 項 ${x.event.type}` : '');
    return { id: d.id, preview: String(label ?? '') };
  });
}

export async function writeDoc(path: string, json: string) {
  const p = parts(path);
  if (p.length % 2) throw new Error('文件路徑要雙數段');
  const data = fromJson(JSON.parse(json)) as Record<string, unknown>;
  await setDoc(doc(fs(), p[0], ...p.slice(1)), data);
}

export async function removeDoc(path: string) {
  const p = parts(path);
  if (p.length % 2) throw new Error('文件路徑要雙數段');
  await deleteDoc(doc(fs(), p[0], ...p.slice(1)));
}

/** 每種文件下面有咩集合（Firestore 網頁版睇唔到，靠呢度提示） */
export function childCollections(path: string): string[] {
  const p = parts(path);
  if (p.length === 2 && p[0] === 'groups') return ['members', 'sessions', 'joinRequests', 'teams'];
  if (p.length === 4 && p[2] === 'sessions') return ['tables', 'expenses', 'pairs', 'requests'];
  if (p.length === 6 && p[4] === 'tables') return ['events'];
  return [];
}
