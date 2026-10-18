import { Suspense, lazy, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, configError } from './firebase.ts';
import { match, usePath } from './lib/router.tsx';
import { Loading, NameForm, TopBar, saveProfile } from './ui.tsx';
import Login from './pages/Login.tsx';
import Home from './pages/Home.tsx';
const Join = lazy(() => import('./pages/Join.tsx'));
import GroupPage from './pages/GroupPage.tsx';
const NewSession = lazy(() => import('./pages/NewSession.tsx'));
import SessionPage from './pages/SessionPage.tsx';
import TablePage from './pages/TablePage.tsx';
const RulesPage = lazy(() => import('./pages/RulesPage.tsx'));
const SettlePage = lazy(() => import('./pages/SettlePage.tsx'));
const Demo = lazy(() => import('./demo.tsx'));

function Routes({ user, refresh }: { user: User; refresh: () => void }) {
  const path = usePath();
  let m: Record<string, string> | null;

  if ((m = match('/join/:g/:code/s/:s', path))) return <Join user={user} groupId={m.g} code={m.code} sessionId={m.s} />;
  if ((m = match('/join/:g/:code', path))) return <Join user={user} groupId={m.g} code={m.code} />;
  if ((m = match('/g/:g/new', path))) return <NewSession user={user} groupId={m.g} />;
  if ((m = match('/g/:g/s/:s/t/:t', path))) return <TablePage user={user} groupId={m.g} sessionId={m.s} tableId={m.t} />;
  if ((m = match('/g/:g/s/:s/settle', path))) return <SettlePage user={user} groupId={m.g} sessionId={m.s} />;
  if ((m = match('/g/:g/s/:s/rules', path))) return <RulesPage user={user} groupId={m.g} sessionId={m.s} />;
  if ((m = match('/g/:g/s/:s', path))) return <SessionPage user={user} groupId={m.g} sessionId={m.s} />;
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

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) saveProfile(u).catch(() => undefined);
    });
  }, []);

  if (path === '/demo' || path.startsWith('/demo/')) return <Suspense fallback={<main className="page narrow"><Loading /></main>}><Demo /></Suspense>;
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
  return <Suspense fallback={<main className="page narrow"><Loading /></main>}><Routes user={user} refresh={refresh} /></Suspense>;
}
