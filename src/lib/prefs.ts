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

export type Skin = 'classic' | 'teahouse' | 'chachaan' | 'neon' | 'glass' | 'clay' | 'brutal' | 'paper' | 'pixel' | 'palace' | 'jade' | 'porcelain';
/**
 * 每款風格自己定光定暗（唔跟部機嘅深色模式），而且唔止換色：
 * 形狀、字款、陰影、質感都唔同。premium：豪華風格（之後可以做付費解鎖；而家人人用得）
 */
export const SKINS: { key: Skin; name: string; note: string; colors: string[]; dark?: boolean; bar: string; premium?: boolean }[] = [
  { key: 'classic', name: '綠絨', note: '墨綠枱布・象牙牌', colors: ['#1E5B49', '#F4EFDF', '#B02E26'], bar: '#1E5B49' },
  { key: 'teahouse', name: '茶樓', note: '紅木・米黃・楷書', colors: ['#8E2A20', '#FFF8EE', '#C9A24B'], bar: '#8E2A20' },
  { key: 'chachaan', name: '茶餐廳', note: '薄荷綠紙巾・卡位紅', colors: ['#2E8B74', '#F7F1E1', '#D6332B'], bar: '#2E8B74' },
  { key: 'neon', name: '霓虹', note: '深夜街頭・發光字', colors: ['#0B0B14', '#3CF2A4', '#FF4D8D'], dark: true, bar: '#0B0B14' },
  { key: 'glass', name: '玻璃', note: '極光底・磨砂玻璃卡', colors: ['#2B1F5C', '#5EC8E5', '#F28AC4'], dark: true, bar: '#1B1440' },
  { key: 'clay', name: '黏土', note: '粉彩・軟膠圓角', colors: ['#F6D7E3', '#BDE0D3', '#8E7CE0'], bar: '#F3E6EE' },
  { key: 'brutal', name: '粗獷', note: '粗黑邊・硬陰影・撞色', colors: ['#FFE14D', '#111111', '#FF5A8A'], bar: '#FFE14D' },
  { key: 'paper', name: '報紙', note: '新聞紙・宋體・墨色', colors: ['#F2EDE2', '#1A1A1A', '#B3261E'], bar: '#F2EDE2' },
  { key: 'pixel', name: '像素', note: '8-bit 遊戲機・方格字', colors: ['#14142B', '#7CF27C', '#FFCC33'], dark: true, bar: '#14142B' },
  { key: 'palace', name: '金殿', note: '黑漆・金箔', colors: ['#0D0B08', '#E8C46A', '#8A6418'], dark: true, bar: '#0B0906', premium: true },
  { key: 'jade', name: '翡翠', note: '帝王綠・白玉・金邊', colors: ['#0B5A45', '#F4F1E6', '#C9A24B'], bar: '#0B5A45', premium: true },
  { key: 'porcelain', name: '青花', note: '白瓷・鈷藍纏枝・描金', colors: ['#F7F8FB', '#1F3F8F', '#C9A24B'], bar: '#F7F8FB', premium: true },
];
/** 舊風格名 → 最似嘅新風格 */
const RENAMED: Record<string, Skin> = { ocean: 'glass', sakura: 'clay', matcha: 'chachaan', midnight: 'pixel', amber: 'paper', violet: 'glass', imperial: 'palace', minimal: 'paper' };

const KEY = 'jeukbou-prefs';
const DEFAULTS: Prefs = { hints: false, sound: true, vibe: true, notify: false, skin: 'classic' };
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const old = localStorage.getItem('jeukbou-sound');
    const base = { ...DEFAULTS, ...(old === 'off' ? { sound: false } : {}) };
    const out: Prefs = raw ? { ...base, ...JSON.parse(raw) } : base;
    // 已經冇咗嘅風格：轉去最似嗰款
    if (!SKINS.some((k) => k.key === out.skin)) out.skin = RENAMED[out.skin] ?? 'classic';
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
  const k = SKINS.find((x) => x.key === s) ?? SKINS[0];
  const root = document.documentElement;
  root.dataset.skin = k.key;
  // 光暗跟風格走，唔跟部機設定
  root.dataset.theme = k.dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', k.bar);
  // 揀咗先載入嘅字款（其他人唔使下載）
  const font = SKIN_FONTS[k.key];
  if (font && !document.getElementById(`font-${k.key}`)) {
    const l = document.createElement('link');
    l.id = `font-${k.key}`; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${font}&display=swap`;
    document.head.appendChild(l);
  }
}

const SKIN_FONTS: Partial<Record<Skin, string>> = { pixel: 'Press+Start+2P', paper: 'Noto+Serif+TC:wght@700;900' };
