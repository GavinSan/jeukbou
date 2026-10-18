// 底部玻璃 tab bar（似 iOS）：枱、大局、埋數、龍虎榜、家規
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
};

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

/** 由目前位置計 5 個 tab */
export function appTabs(ctx: { g?: string; s?: string; t?: string }, path: string): { tabs: Tab[]; active: string | null } {
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
