// 番數表更新提示：同圈有人改咗番數表，其他成員開 app 時見到提示；
// 有開通知而 app 喺背景就彈系統通知。睇過邊個版本只記喺呢部機。
import { useSyncExternalStore } from 'react';
import { prefs } from './prefs.ts';

const START = 'jeukbou-watch-start';
const SEEN = 'jeukbou-ft-seen';

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 存唔到就算 */ }
}

/** 第一次用呢個功能嘅時間：之前嘅修改唔提 */
function startAt(): number {
  const v = read<number>(START, 0);
  if (v) return v;
  const now = Date.now();
  write(START, now);
  return now;
}

export function seenAt(g: string): number {
  return read<Record<string, number>>(SEEN, {})[g] ?? startAt();
}

export function markSeen(g: string, at: number | null | undefined) {
  if (!at) return;
  const all = read<Record<string, number>>(SEEN, {});
  if ((all[g] ?? 0) >= at) { dismiss(g); return; }
  all[g] = at;
  write(SEEN, all);
  dismiss(g);
}

// ---------- 畫面上嘅提示 ----------
export interface Notice {
  g: string;
  title: string;
  body: string;
  url: string;
  at: number;
}

let notices: Notice[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pushNotice(n: Notice) {
  if (notices.some((x) => x.g === n.g && x.at >= n.at)) return;
  notices = [...notices.filter((x) => x.g !== n.g), n];
  emit();
}

function dismiss(g: string) {
  if (!notices.some((x) => x.g === g)) return;
  notices = notices.filter((x) => x.g !== g);
  emit();
}

export function useNotices(): Notice[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => notices, () => notices);
}

// ---------- 系統通知 ----------
export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;

export async function askNotify(): Promise<NotificationPermission | 'unsupported'> {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

const shown = new Set<string>();

export async function systemNotify(n: Notice) {
  const tag = `${n.g}:${n.at}`;
  if (shown.has(tag)) return;
  shown.add(tag);
  if (!prefs().notify || !notifySupported() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(n.title, { body: n.body, tag: n.g, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: n.url } });
  } catch { /* 唔支援就算 */ }
}
