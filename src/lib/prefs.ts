// 個人設定：只存喺呢部機（localStorage）
import { useSyncExternalStore } from 'react';

export interface Prefs {
  /** 顯示說明文字 */
  hints: boolean;
  sound: boolean;
  /** 震機 */
  vibe: boolean;
  /** 番數表更新時彈系統通知 */
  notify: boolean;
  /** 介面風格 */
  skin: Skin;
}

export type Skin = 'classic' | 'teahouse' | 'neon' | 'minimal';
export const SKINS: { key: Skin; name: string; note: string; colors: string[] }[] = [
  { key: 'classic', name: '綠絨', note: '原本：綠絨布枱、象牙牌', colors: ['#1E5B49', '#F4EFDF', '#B02E26'] },
  { key: 'teahouse', name: '茶樓', note: '暖色、紅木枱、楷書標題', colors: ['#8E2A20', '#FFF8EE', '#C9A24B'] },
  { key: 'neon', name: '霓虹', note: '夜晚霓虹、會發光', colors: ['#241B4D', '#3CF2A4', '#FF4D8D'] },
  { key: 'minimal', name: '簡約', note: '黑白、細邊、密啲', colors: ['#222222', '#FFFFFF', '#0A7D3E'] },
];

const KEY = 'jeukbou-prefs';
const DEFAULTS: Prefs = { hints: true, sound: true, vibe: true, notify: false, skin: 'classic' };
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

/** 套用風格：網址有 ?skin= 就用網址（示範用），否則用設定 */
export function applySkin(skin: Skin) {
  let s: string = skin;
  try {
    const q = new URLSearchParams(window.location.search).get('skin');
    if (q && SKINS.some((x) => x.key === q)) s = q;
  } catch { /* 唔緊要 */ }
  document.documentElement.dataset.skin = s;
}
