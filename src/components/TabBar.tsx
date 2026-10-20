// 底部玻璃 tab bar（似 iOS）：首頁一組（主頁、牌友圈、段位、設定）；牌友圈入面一組（枱、大局、埋數、龍虎榜、家規）
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from '../lib/router.tsx';

export interface Tab {
  key: string;
  label: string;
  href: string | null;
  /** 中間凸出嚟嘅大掣（枱） */
  raised?: boolean;
  /** 未有枱：顯示「＋」 */
  plus?: boolean;
}

const ICONS: Record<string, ReactNode> = {
  table: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="12" cy="16.5" r="1.2" /><circle cx="7.5" cy="12" r="1.2" /><circle cx="16.5" cy="12" r="1.2" /></>,
  session: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></>,
  settle: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  board: <><path d="M4 20V13h4v7M10 20V6h4v14M16 20v-9h4v9" /></>,
  rules: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  pay: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="12" cy="12" r="3" /><path d="M7 9.5v5M17 9.5v5" /></>,
  home: <><path d="M3.5 11.2L12 4l8.5 7.2" /><path d="M5.8 9.6V20.5h12.4V9.6" /><path d="M10 20.5v-5.5h4v5.5" /></>,
  groups: <><circle cx="9" cy="8.3" r="3.5" /><circle cx="17" cy="9.5" r="2.7" /><path d="M3 20.5a6 6 0 0 1 12 0" /><path d="M15.2 15a4.8 4.8 0 0 1 5.8 5.5" /></>,
  rank: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4M8.5 20h7" /></>,
  settings: <g transform="translate(2.04 2.04) scale(0.83)" strokeWidth="2.15"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></g>,
  plus: <><path d="M12 6v12M6 12h12" /></>,
};

const HOME_PATHS = ['/', '/groups', '/pay', '/rank', '/settings'];
export const HOME_TABS: Tab[] = [
  { key: 'home', label: '主頁', href: '/' },
  { key: 'groups', label: '牌友圈', href: '/groups' },
  { key: 'pay', label: '找數', href: '/pay' },
  { key: 'rank', label: '段位', href: '/rank' },
  { key: 'settings', label: '設定', href: '/settings' },
];
export const HOME_DEMO_TABS: Tab[] = [
  { key: 'home', label: '主頁', href: '/demo/home' },
  { key: 'groups', label: '牌友圈', href: '/demo/groups' },
  { key: 'pay', label: '找數', href: '/demo/pay' },
  { key: 'rank', label: '段位', href: '/demo/rank' },
  { key: 'settings', label: '設定', href: '/demo/home' },
];

export default function TabBar({ tabs, active }: { tabs: Tab[]; active: string | null }) {
  const i = tabs.findIndex((t) => t.key === active);
  const lens = i >= 0 && !tabs[i].raised;
  useEffect(() => {
    document.body.classList.add('has-tabbar');
    return () => document.body.classList.remove('has-tabbar');
  }, []);
  return (
    <nav className="tabbar icon-only" aria-label="主要頁面" style={{ '--n': tabs.length, '--i': Math.max(0, i) } as CSSProperties}>
      {lens && <span className="tab-lens" aria-hidden="true" />}
      {tabs.map((t) => {
        const icon = t.plus ? 'plus' : t.key;
        const body = (
          <>
            <svg width={t.raised ? 28 : 26} height={t.raised ? 28 : 26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={t.raised ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
            {t.raised && t.plus && <small className="tab-plus-text">開枱</small>}
          </>
        );
        const cls = `tab${t.key === active ? ' active' : ''}${t.raised ? ' raised' : ''}${t.plus ? ' plus' : ''}`;
        return t.href ? (
          <Link key={t.key} to={t.href} className={cls} ariaLabel={t.plus ? `開${t.label}` : t.label}>{body}</Link>
        ) : (
          <span key={t.key} className={`${cls} off`} aria-disabled="true" aria-label={`${t.label}（未有）`} title={`${t.label}（未有）`}>{body}</span>
        );
      })}
    </nav>
  );
}

/** 由目前位置計底部 tab */
export function appTabs(ctx: { g?: string; s?: string; t?: string }, path: string): { tabs: Tab[]; active: string | null } {
  // 首頁一組：主頁、牌友圈、段位、設定
  if (HOME_PATHS.includes(path)) {
    return { tabs: HOME_TABS, active: path === '/' ? 'home' : path.slice(1) };
  }
  const { g, s, t } = ctx;
  const S = g && s ? `/g/${g}/s/${s}` : null;
  // 中間凸出嘅枱：有枱就去枱；未有就「＋」開枱（大局入面）或者開大局（牌友圈）
  const tableTab: Tab = S && t
    ? { key: 'table', label: '枱', href: `${S}/t/${t}`, raised: true }
    : S
      ? { key: 'table', label: '枱', href: `${S}#add-table`, raised: true, plus: true }
      : g
        ? { key: 'table', label: '大局', href: `/g/${g}/new`, raised: true, plus: true }
        : { key: 'table', label: '枱', href: null, raised: true };
  const tabs: Tab[] = [
    { key: 'session', label: '大局', href: S ?? (g ? `/g/${g}` : '/') },
    { key: 'settle', label: '埋數', href: S ? `${S}/settle` : null },
    tableTab,
    { key: 'board', label: '龍虎榜', href: g ? `/g/${g}/board` : null },
    { key: 'rules', label: '家規', href: S ? `${S}/rules` : g ? `/g/${g}/rules` : null },
  ];
  let active: string | null = null;
  if (/\/t\/[^/]+$/.test(path)) active = 'table';
  else if (path.endsWith('/settle')) active = 'settle';
  else if (path.endsWith('/board')) active = 'board';
  else if (path.endsWith('/rules')) active = 'rules';
  else if (/^\/g\/[^/]+(\/s\/[^/]+)?$/.test(path) || path === '/') active = 'session';
  return { tabs, active };
}
