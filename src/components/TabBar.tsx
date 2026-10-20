// 底部玻璃 tab bar（似 iOS）：首頁一組（主頁、牌友圈、段位、設定）；牌友圈入面一組（枱、大局、埋數、龍虎榜、家規）
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from '../lib/router.tsx';

export interface Tab {
  key: string;
  label: string;
  href: string | null;
}

const ICONS: Record<string, ReactNode> = {
  table: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="12" cy="16.5" r="1.2" /><circle cx="7.5" cy="12" r="1.2" /><circle cx="16.5" cy="12" r="1.2" /></>,
  session: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></>,
  settle: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  board: <><path d="M4 20V13h4v7M10 20V6h4v14M16 20v-9h4v9" /></>,
  rules: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  pay: <><rect x="3" y="6" width="18" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /><path d="M6.5 9.5v5M17.5 9.5v5" /></>,
  home: <><path d="M4 11l8-6.5 8 6.5" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></>,
  groups: <><circle cx="9" cy="9" r="3.2" /><circle cx="16.5" cy="10.5" r="2.5" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M14.5 15.2A4.5 4.5 0 0 1 21 19" /></>,
  rank: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4M8.5 20h7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
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
  useEffect(() => {
    document.body.classList.add('has-tabbar');
    return () => document.body.classList.remove('has-tabbar');
  }, []);
  return (
    <nav className="tabbar" aria-label="主要頁面" style={{ '--n': tabs.length, '--i': Math.max(0, i) } as CSSProperties}>
      {i >= 0 && <span className="tab-lens" aria-hidden="true" />}
      {tabs.map((t) => {
        const body = (
          <>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[t.key]}</svg>
            <span>{t.label}</span>
          </>
        );
        return t.href ? (
          <Link key={t.key} to={t.href} className={`tab${t.key === active ? ' active' : ''}`} ariaLabel={t.label}>{body}</Link>
        ) : (
          <span key={t.key} className="tab off" aria-disabled="true" title={`${t.label}（未有）`}>{body}</span>
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
  const tabs: Tab[] = [
    { key: 'table', label: '枱', href: S && t ? `${S}/t/${t}` : null },
    { key: 'session', label: '大局', href: S ?? (g ? `/g/${g}` : '/') },
    { key: 'settle', label: '埋數', href: S ? `${S}/settle` : null },
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
