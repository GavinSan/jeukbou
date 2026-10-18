// 個人設定：只存喺呢部機（localStorage）
import { useSyncExternalStore } from 'react';

export interface Prefs {
  /** 顯示說明文字 */
  hints: boolean;
  sound: boolean;
  /** 震機 */
  vibe: boolean;
}

const KEY = 'jeukbou-prefs';
const DEFAULTS: Prefs = { hints: true, sound: true, vibe: true };
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const old = localStorage.getItem('jeukbou-sound');
    const base = { ...DEFAULTS, ...(old === 'off' ? { sound: false } : {}) };
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return DEFAULTS;
  }
}

let current: Prefs = load();

export const prefs = (): Prefs => current;

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* 存唔到就算 */ }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, prefs, prefs);
}
