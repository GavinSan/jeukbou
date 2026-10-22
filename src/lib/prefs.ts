// 個人設定：只存喺呢部機（localStorage）
import { useSyncExternalStore } from 'react';

export interface Prefs {
  /** 顯示說明文字（預設閂 = 簡潔） */
  hints: boolean;
  sound: boolean;
  /** 震機 */
  vibe: boolean;
  /** 番數表更新時彈系統通知 */
  notify: boolean;
  /** 介面風格 */
  skin: Skin;
}

export type Skin = 'classic' | 'teahouse' | 'neon' | 'ocean' | 'sakura' | 'matcha' | 'midnight' | 'amber' | 'violet' | 'palace' | 'jade' | 'imperial';
/** premium：豪華風格（之後可以做付費解鎖；而家人人用得） */
export const SKINS: { key: Skin; name: string; note: string; colors: string[]; premium?: boolean }[] = [
  { key: 'classic', name: '綠絨', note: '墨綠・象牙', colors: ['#1E5B49', '#F4EFDF', '#B02E26'] },
  { key: 'teahouse', name: '茶樓', note: '紅木・米黃', colors: ['#8E2A20', '#FFF8EE', '#C9A24B'] },
  { key: 'neon', name: '霓虹', note: '深紫・螢光', colors: ['#241B4D', '#3CF2A4', '#FF4D8D'] },
  { key: 'ocean', name: '海洋', note: '深藍・海水綠', colors: ['#174A6B', '#E8F3F7', '#1FA39A'] },
  { key: 'sakura', name: '櫻花', note: '粉紅・白', colors: ['#B5476B', '#FFF1F4', '#E58FA8'] },
  { key: 'matcha', name: '抹茶', note: '橄欖綠・奶白', colors: ['#5B6B2E', '#F6F2E2', '#9CB04A'] },
  { key: 'midnight', name: '午夜', note: '夜藍・銀', colors: ['#18223F', '#C9D3E6', '#5B8DEF'] },
  { key: 'amber', name: '琥珀', note: '啡・金', colors: ['#6B4423', '#FBF2E0', '#D9A23A'] },
  { key: 'violet', name: '紫晶', note: '紫・淡紫', colors: ['#4B2E83', '#F3EEFB', '#9C7BE0'] },
  { key: 'palace', name: '金殿', note: '黑漆・金箔', colors: ['#0D0B08', '#E8C46A', '#8A6418'], premium: true },
  { key: 'jade', name: '翡翠', note: '帝王綠・白玉・金邊', colors: ['#0B5A45', '#F4F1E6', '#C9A24B'], premium: true },
  { key: 'imperial', name: '紫禁', note: '宮牆紅・琉璃金', colors: ['#5C0B10', '#F2C14E', '#1E1A3A'], premium: true },
];

const KEY = 'jeukbou-prefs';
const DEFAULTS: Prefs = { hints: false, sound: true, vibe: true, notify: false, skin: 'classic' };
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const old = localStorage.getItem('jeukbou-sound');
    const base = { ...DEFAULTS, ...(old === 'off' ? { sound: false } : {}) };
    const out: Prefs = raw ? { ...base, ...JSON.parse(raw) } : base;
    // 已經冇咗嘅風格（例如簡約）：轉返綠絨
    if (!SKINS.some((k) => k.key === out.skin)) out.skin = 'classic';
    // 提示文字改咗預設閂（簡潔）：舊用家都閂一次，想睇再去設定開
    if (localStorage.getItem('jeukbou-hints-v2') !== '1') {
      out.hints = false;
      localStorage.setItem('jeukbou-hints-v2', '1');
      localStorage.setItem(KEY, JSON.stringify(out));
    }
    return out;
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
