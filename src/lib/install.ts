// 加到主畫面：睇下而家係咪已經喺主畫面開（standalone），定係用緊 Safari／Chrome／WhatsApp 入面開；
// Android／電腦 Chrome 有「安裝」事件，捉住佢等我哋自己個掣用。
import { useSyncExternalStore } from 'react';

export type Platform = 'ios-safari' | 'ios-other' | 'android' | 'desktop';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  return mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || mm('(display-mode: minimal-ui)')
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const isIOSDevice = () => /iP(hone|ad|od)/.test(ua())
  || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** WhatsApp／Instagram／Facebook／LINE／WeChat 入面開嘅細瀏覽器：加唔到主畫面 */
export function inAppBrowser(): string | null {
  const u = ua();
  if (/WhatsApp/i.test(u)) return 'WhatsApp';
  if (/Instagram/i.test(u)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(u)) return 'Facebook';
  if (/Line\//i.test(u)) return 'LINE';
  if (/MicroMessenger/i.test(u)) return 'WeChat';
  if (/Android/.test(u) && /; wv\)/.test(u)) return 'App';
  return null;
}

export function platform(): Platform {
  const u = ua();
  if (isIOSDevice()) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(u) || inAppBrowser() ? 'ios-other' : 'ios-safari';
  if (/Android/.test(u)) return 'android';
  return 'desktop';
}

/** iPhone 上面嘅其他瀏覽器叫咩名 */
export function iosBrowserName(): string {
  const u = ua();
  return inAppBrowser() ?? (/CriOS/.test(u) ? 'Chrome' : /FxiOS/.test(u) ? 'Firefox' : /EdgiOS/.test(u) ? 'Edge' : /GSA\//.test(u) ? 'Google App' : '呢個瀏覽器');
}

// ---------- Android／電腦嘅安裝事件 ----------
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; emit(); });
}

let snap = { canPrompt: false, installed: false };
function snapshot() {
  const next = { canPrompt: !!deferred, installed };
  if (next.canPrompt !== snap.canPrompt || next.installed !== snap.installed) snap = next;
  return snap;
}

export function useInstall() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, snapshot, snapshot);
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  const r = await e.userChoice;
  if (r.outcome === 'accepted') { installed = true; emit(); }
  return r.outcome;
}

// ---------- 幾時提 ----------
const SNOOZE = 'jeukbou-install-snooze';
const SKIP = 'jeukbou-install-skip';

/** 手機、未加主畫面、冇撳「遲啲」 */
export function shouldNudgeInstall(): boolean {
  if (isStandalone() || platform() === 'desktop') return false;
  try { return Date.now() > Number(localStorage.getItem(SNOOZE) ?? 0); } catch { return true; }
}

export function snoozeInstall(days = 3) {
  try { localStorage.setItem(SNOOZE, String(Date.now() + days * 86400000)); } catch { /* 存唔到就算 */ }
}

/** 登入前嘅教學：手機、未加主畫面、今次冇撳「直接登入」 */
export function shouldGuideBeforeLogin(): boolean {
  if (isStandalone() || platform() === 'desktop') return false;
  try { return sessionStorage.getItem(SKIP) !== '1'; } catch { return true; }
}

export function skipGuideBeforeLogin() {
  try { sessionStorage.setItem(SKIP, '1'); } catch { /* 存唔到就算 */ }
}

/** 由邀請連結（或者成段邀請訊息）抽返 /join/… 路徑 */
export function parseInvite(text: string): string | null {
  const m = /\/join\/([A-Za-z0-9_-]{6,})\/([A-Za-z0-9_-]{4,})(?:\/s\/([A-Za-z0-9_-]{6,}))?/.exec(text);
  if (!m) return null;
  return `/join/${m[1]}/${m[2]}${m[3] ? `/s/${m[3]}` : ''}`;
}
