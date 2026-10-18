// 底部 tab 用：記住最近去過嘅牌友圈、大局、自己張枱（只存喺呢部機）
import { match } from './router.tsx';

export interface NavContext {
  g?: string;
  s?: string;
  t?: string;
}

const KEY = 'jeukbou-nav';

function load(): NavContext {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as NavContext;
  } catch {
    return {};
  }
}

function save(c: NavContext) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* 存唔到就算 */ }
}

/** 由網址讀 g / s / t，冇就用上次記低嘅 */
export function navContext(path: string): NavContext {
  const last = load();
  const m =
    match('/g/:g/s/:s/t/:t', path) ??
    match('/g/:g/s/:s/:rest', path) ??
    match('/g/:g/s/:s', path) ??
    match('/g/:g/:rest', path) ??
    match('/g/:g', path);
  if (!m) return last;
  const next: NavContext = { g: m.g };
  if (m.s) next.s = m.s;
  else if (last.g === m.g) { next.s = last.s; next.t = last.t; }
  if (m.t) next.t = m.t;
  else if (m.s && last.s === m.s) next.t = last.t;
  save(next);
  return next;
}

/** 大局頁知道我坐邊張枱，就記低 */
export function rememberTable(g: string, s: string, t: string | null) {
  const c = load();
  if (c.g === g && c.s === s && c.t === (t ?? undefined)) return;
  save({ g, s, t: t ?? undefined });
  window.dispatchEvent(new Event('jeukbou-nav'));
}
