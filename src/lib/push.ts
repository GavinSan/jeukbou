// 真推播（FCM）：app 閂咗都收到約局、三缺一、番數表更新。
// 每部機開咗「通知」就攞一個推播 token，存喺 users/{uid}/pushTokens；伺服器（Cloud Functions）用佢發通知。
// 冇設定 VITE_FIREBASE_VAPID_KEY 就乜都唔做（淨係用 app 開住時嘅本機通知）。
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { app, db } from '../firebase.ts';

const VAPID = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim() || '';
const KEY = 'jeukbou-push';

export const pushConfigured = () => !!VAPID;

interface Saved { uid: string; id: string; at: number }

function saved(): Saved | null {
  try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as Saved) : null; } catch { return null; }
}

async function tokenId(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].slice(0, 20).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type PushResult = 'ok' | 'off' | 'unsupported' | 'denied';

/** 登記呢部機收推播；force = 唔理上次幾時登記過 */
export async function registerPush(uid: string, force = false): Promise<PushResult> {
  if (!VAPID || !app || !db) return 'off';
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  if (Notification.permission !== 'granted') return 'denied';
  const last = saved();
  if (!force && last?.uid === uid && Date.now() - last.at < 3 * 86400000) return 'ok';
  const m = await import('firebase/messaging');
  if (!(await m.isSupported())) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  const token = await m.getToken(m.getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: reg });
  if (!token) return 'unsupported';
  const id = await tokenId(token);
  // 換咗帳戶：舊帳戶嗰個 token 唔再收
  if (last && (last.uid !== uid || last.id !== id)) await deleteDoc(doc(db, 'users', last.uid, 'pushTokens', last.id)).catch(() => undefined);
  await setDoc(doc(db, 'users', uid, 'pushTokens', id), { token, ua: navigator.userAgent.slice(0, 160), at: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify({ uid, id, at: Date.now() } satisfies Saved)); } catch { /* 存唔到就下次再登記 */ }
  return 'ok';
}

/** 閂通知或者登出：呢部機唔再收 */
export async function unregisterPush(): Promise<void> {
  const last = saved();
  try { localStorage.removeItem(KEY); } catch { /* 無所謂 */ }
  if (!VAPID || !app || !db || !last) return;
  await deleteDoc(doc(db, 'users', last.uid, 'pushTokens', last.id)).catch(() => undefined);
  try {
    const m = await import('firebase/messaging');
    if (await m.isSupported()) await m.deleteToken(m.getMessaging(app));
  } catch { /* 刪唔到就算，伺服器發唔到會自己清 */ }
}
