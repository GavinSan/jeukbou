import { Suspense, useEffect, useState } from 'react';
import { ErrorBoundary, lazyPage } from './lib/lazy.tsx';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, configError } from './firebase.ts';
import { match, usePath } from './lib/router.tsx';
import { Loading, NameForm, TopBar, saveProfile } from './ui.tsx';
import Login from './pages/Login.tsx';
import Home from './pages/Home.tsx';
const Join = lazyPage(() => import('./pages/Join.tsx'));
import GroupPage from './pages/GroupPage.tsx';
const NewSession = lazyPage(() => import('./pages/NewSession.tsx'));
import SessionPage from './pages/SessionPage.tsx';
import TablePage from './pages/TablePage.tsx';
const RulesPage = lazyPage(() => import('./pages/RulesPage.tsx'));
const SettlePage = lazyPage(() => import('./pages/SettlePage.tsx'));
const BoardPage = lazyPage(() => import('./pages/BoardPage.tsx'));
const AdminPage = lazyPage(() => import('./pages/AdminPage.tsx'));
const ImportPage = lazyPage(() => import('./pages/ImportPage.tsx'));
const PlayersPage = lazyPage(() => import('./pages/PlayersPage.tsx'));
const GroupsPage = lazyPage(() => import('./pages/Groups.tsx'));
const RankPage = lazyPage(() => import('./pages/RankPage.tsx'));
const SettingsPage = lazyPage(() => import('./pages/SettingsPage.tsx'));
const MyPayPage = lazyPage(() => import('./pages/MyPayPage.tsx'));
const PayPage = lazyPage(() => import('./pages/PayPage.tsx'));
const LivePage = lazyPage(() => import('./pages/LivePage.tsx'));
import TabBar, { HOME_DEMO_TABS, appTabs } from './components/TabBar.tsx';
import { navContext } from './lib/nav.ts';
import { applySkin, prefs, usePrefs } from './lib/prefs.ts';
import { GroupWatchers, NoticeBar } from './components/Watch.tsx';
import { UpdateWatcher } from './lib/update.tsx';
import { registerPush } from './lib/push.ts';
const Demo = lazyPage(() => import('./demo.tsx'));

function Routes({ user, refresh }: { user: User; refresh: () => void }) {
  const path = usePath();
  let m: Record<string, string> | null;

  if (path === '/admin') return <AdminPage user={user} />;
  if (path === '/groups') return <GroupsPage user={user} />;
  if (path === '/rank') return <RankPage user={user} />;
  if (path === '/settings') return <SettingsPage user={user} />;
  if (path === '/pay') return <MyPayPage user={user} />;
  if ((m = match('/join/:g/:code/s/:s', path))) return <Join user={user} groupId={m.g} code={m.code} sessionId={m.s} />;
  if ((m = match('/join/:g/:code', path))) return <Join user={user} groupId={m.g} code={m.code} />;
  if ((m = match('/g/:g/new', path))) return <NewSession user={user} groupId={m.g} />;
  if ((m = match('/live/:g/:s', path))) return <LivePage user={user} groupId={m.g} sessionId={m.s} />;
  if ((m = match('/g/:g/s/:s/t/:t', path))) return <TablePage user={user} groupId={m.g} sessionId={m.s} tableId={m.t} />;
  if ((m = match('/g/:g/s/:s/pay', path))) return <PayPage user={user} groupId={m.g} sessionId={m.s} />;
  if ((m = match('/g/:g/s/:s/settle', path))) return <SettlePage user={user} groupId={m.g} sessionId={m.s} />;
  if ((m = match('/g/:g/s/:s/rules', path))) return <RulesPage user={user} groupId={m.g} sessionId={m.s} />;
  if ((m = match('/g/:g/s/:s', path))) return <SessionPage key={m.s} user={user} groupId={m.g} sessionId={m.s} />;
  if ((m = match('/g/:g/import', path))) return <ImportPage user={user} groupId={m.g} />;
  if ((m = match('/g/:g/players', path))) return <PlayersPage user={user} groupId={m.g} />;
  if ((m = match('/g/:g/board', path))) return <BoardPage user={user} groupId={m.g} />;
  if ((m = match('/g/:g/rules', path))) return <RulesPage user={user} groupId={m.g} />;
  if ((m = match('/g/:g', path))) return <GroupPage user={user} groupId={m.g} />;
  return <Home user={user} refresh={refresh} />;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // 改名之後 Firebase 嘅 user 係同一個物件，要手動叫畫面再畫一次
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const path = usePath();
  const { skin } = usePrefs();
  useEffect(() => { applySkin(skin); }, [skin]);

  // 大局頁記低我坐邊張枱之後，tab 要更新
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener('jeukbou-nav', on);
    return () => window.removeEventListener('jeukbou-nav', on);
  }, []);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) saveProfile(u).catch(() => undefined);
      // 開咗通知嘅機：幾日更新一次推播 token
      if (u && prefs().notify) registerPush(u.uid).catch(() => undefined);
    });
  }, []);

  if (path === '/demo' || path.startsWith('/demo/')) {
    const demoTabs = [
      { key: 'session', label: '大局', href: '/demo' },
      { key: 'settle', label: '埋數', href: '/demo/settle' },
      { key: 'table', label: '枱', href: '/demo/t/0', raised: true },
      { key: 'board', label: '龍虎榜', href: '/demo/board' },
      { key: 'rules', label: '家規', href: '/demo/rules' },
    ];
    const active = path.startsWith('/demo/t/') ? 'table' : path === '/demo/settle' ? 'settle' : path === '/demo/board' ? 'board' : path === '/demo/rules' ? 'rules' : 'session';
    return (
      <>
        <Suspense fallback={<main className="page narrow"><Loading /></main>}><Demo /></Suspense>
        {path === '/demo/admin' || path === '/demo/live' ? null : path === '/demo/home' || path === '/demo/rank' || path === '/demo/groups' || path === '/demo/pay' || path === '/demo/skins'
          ? <TabBar tabs={HOME_DEMO_TABS} active={path === '/demo/rank' ? 'rank' : path === '/demo/groups' ? 'groups' : path === '/demo/pay' ? 'pay' : path === '/demo/skins' ? 'settings' : 'home'} />
          : <TabBar tabs={demoTabs} active={active} />}
      </>
    );
  }
  if (configError) {
    return (
      <main className="page narrow">
        <h1>雀簿</h1>
        <p className="error">{configError}</p>
      </main>
    );
  }
  if (user === undefined) return <main className="page narrow"><Loading /></main>;
  if (!user) return <Login refresh={refresh} joining={path.startsWith('/join/')} />;
  if (!user.displayName?.trim()) {
    return (
      <main className="page">
        <TopBar />
        <section className="panel">
          <h2>設定顯示名稱</h2>
          <p className="muted">枱面、龍虎榜和埋數會顯示此名稱，之後可修改。</p>
          <NameForm user={user} initial="" onDone={refresh} />
        </section>
      </main>
    );
  }
  const nav = appTabs(navContext(path), path);
  return (
    <>
      <ErrorBoundary key={path}><Suspense fallback={<main className="page narrow"><Loading /></main>}><Routes user={user} refresh={refresh} /></Suspense></ErrorBoundary>
      {/* 加入頁唔使底部 tab */}
      {!path.startsWith('/join/') && !path.startsWith('/live/') && path !== '/admin' && <TabBar tabs={nav.tabs} active={nav.active} />}
      <GroupWatchers uid={user.uid} />
      <NoticeBar />
      <UpdateWatcher />
    </>
  );
}
