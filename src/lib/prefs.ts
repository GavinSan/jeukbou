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

export type Skin = 'classic' | 'teahouse' | 'chachaan' | 'neon' | 'glass' | 'clay' | 'brutal' | 'paper' | 'pixel' | 'palace' | 'jade' | 'porcelain' | 'obsidian' | 'sapphire' | 'ruby' | 'amethyst' | 'rosegold' | 'marble';
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
  { key: 'obsidian', name: '黑曜', note: '黑玻璃・白金', colors: ['#0A0A0D', '#DCE1EA', '#8C93A3'], dark: true, bar: '#0A0A0D', premium: true },
  { key: 'sapphire', name: '藍寶', note: '深海軍藍・銀', colors: ['#06112A', '#2F5DB8', '#CCD6EA'], dark: true, bar: '#06112A', premium: true },
  { key: 'ruby', name: '紅寶', note: '深緋紅・玫瑰金', colors: ['#17060B', '#A11A33', '#F2BCA4'], dark: true, bar: '#17060B', premium: true },
  { key: 'amethyst', name: '紫晶', note: '深紫・淡紫銀', colors: ['#120A20', '#7B50CA', '#E4D6FF'], dark: true, bar: '#120A20', premium: true },
  { key: 'rosegold', name: '玫瑰金', note: '淡粉・玫瑰金', colors: ['#FAF0EC', '#8A4A53', '#DFA488'], bar: '#FAF0EC', premium: true },
  { key: 'marble', name: '雲石', note: '白雲石・黑石枱・金', colors: ['#FFFFFF', '#2C2C2F', '#B8933F'], bar: '#F3F2EF', premium: true },
];
/** 舊風格名 → 最似嘅新風格 */
const RENAMED: Record<string, Skin> = { ocean: 'glass', sakura: 'clay', matcha: 'chachaan', midnight: 'pixel', amber: 'paper', violet: 'amethyst', imperial: 'ruby', minimal: 'paper' };

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

/** 暫時用另一款風格（Live 自己揀嘅）；null = 跟設定 */
let override: Skin | null = null;
export function setSkinOverride(skin: Skin | null) {
  if (override === skin) return;
  override = skin;
  applySkin(current.skin);
}

/** 套用風格：網址有 ?skin= 就用網址（示範用），否則用設定（Live 揀咗就用 Live 嗰款） */
export function applySkin(skin: Skin) {
  let s: string = override ?? skin;
  let forced = false;
  try {
    const q = new URLSearchParams(window.location.search).get('skin');
    if (q && SKINS.some((x) => x.key === q)) { s = q; forced = true; }
  } catch { /* 唔緊要 */ }
  // 未解鎖嘅風格：照留住個設定，但暫時用返綠絨（網址 ?skin= 係示範／測試用，唔理）
  if (!forced && skinLock(s as Skin, access)) s = 'classic';
  const k = SKINS.find((x) => x.key === s) ?? SKINS[0];
  const root = document.documentElement;
  root.dataset.skin = k.key;
  // 光暗跟風格走，唔跟部機設定
  root.dataset.theme = k.dark ? 'dark' : 'light';
  // 豪華風格共用嘅金屬邊、標題、掣
  if (k.premium) root.dataset.premium = '1'; else delete root.dataset.premium;
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

// ---------- 風格解鎖 ----------
/** 每款風格開放方式（超級管理員設定）：auto＝基本款跟段位、豪華款要授權；open＝全部人用得；closed＝暫停 */
export type SkinMode = 'auto' | 'open' | 'closed';
/** 基本款要幾高段位先用得（TIERS 嘅位置同名） */
export const SKIN_TIER: Partial<Record<Skin, { i: number; name: string }>> = {
  teahouse: { i: 1, name: '雀仔' }, chachaan: { i: 1, name: '雀仔' },
  paper: { i: 2, name: '雀友' }, clay: { i: 2, name: '雀友' },
  neon: { i: 3, name: '雀士' }, glass: { i: 3, name: '雀士' },
  brutal: { i: 4, name: '雀豪' }, pixel: { i: 5, name: '雀霸' },
};
/** 段位名（同 stats.ts 嘅 TIERS 一樣次序；放喺度免得 prefs 依賴 stats） */
export const TIER_NAMES = ['雀蛋', '雀仔', '雀友', '雀士', '雀豪', '雀霸', '雀王', '雀聖', '雀神', '雀仙'];
export interface SkinAccess {
  /** 而家段位（TIERS 嘅位置），未知係 -1 */
  tier: number;
  admin: boolean;
  modes: Record<string, SkinMode>;
  /** 超級管理員改咗嘅解鎖段位（TIERS 位置；-2 = 要授權）；冇就用預設 */
  tiers: Record<string, number>;
  /** 超級管理員開俾呢個用家嘅豪華風格 */
  grants: string[];
  /** 已經由伺服器讀過（未讀到之前唔鎖，免得錯鎖） */
  known: boolean;
}
const ACCESS_KEY = 'jeukbou-skin-access';
const NO_ACCESS: SkinAccess = { tier: -1, admin: false, modes: {}, tiers: {}, grants: [], known: false };
function loadAccess(): SkinAccess {
  try { const raw = localStorage.getItem(ACCESS_KEY); if (raw) return { ...NO_ACCESS, ...JSON.parse(raw) }; } catch { /* 冇就算 */ }
  return NO_ACCESS;
}
let access: SkinAccess = loadAccess();
const accessListeners = new Set<() => void>();

/** 用唔用得：null＝用得；否則係原因（顯示俾用家睇） */
export function skinLock(key: Skin, a: SkinAccess = access): string | null {
  if (key === 'classic' || a.admin || !a.known) return null;
  const mode = a.modes[key] ?? 'auto';
  if (mode === 'closed') return '暫停開放';
  if (mode === 'open') return null;
  const def = SKINS.find((x) => x.key === key);
  const granted = a.grants.includes(key);
  // 超級管理員改咗要幾高段位（或者要授權）就跟佢；冇就用預設
  const set = a.tiers?.[key];
  if (set === -2 || (set === undefined && def?.premium)) return granted ? null : `${def?.premium ? '豪華風格：' : ''}要管理員開通`;
  const need = set !== undefined && set >= 0 ? { i: set, name: TIER_NAMES[set] ?? '' } : SKIN_TIER[key];
  if (!need || granted) return null;
  if (a.tier < 0) return null;
  return a.tier >= need.i ? null : `升到「${need.name}」先用得`;
}

/** 更新解鎖資料（段位喺主頁／段位頁／設定計；管理員、開放設定、授權喺 App 讀） */
export function updateSkinAccess(patch: Partial<SkinAccess>) {
  const next = { ...access, ...patch };
  if (JSON.stringify(next) === JSON.stringify(access)) return;
  access = next;
  try { localStorage.setItem(ACCESS_KEY, JSON.stringify(access)); } catch { /* 存唔到就算 */ }
  accessListeners.forEach((l) => l());
  applySkin(current.skin);
}
export function resetSkinAccess() {
  access = NO_ACCESS;
  try { localStorage.removeItem(ACCESS_KEY); } catch { /* 唔緊要 */ }
  accessListeners.forEach((l) => l());
}
export function useSkinAccess(): SkinAccess {
  return useSyncExternalStore((l) => { accessListeners.add(l); return () => accessListeners.delete(l); }, () => access, () => access);
}
