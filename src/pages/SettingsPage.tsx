// 設定頁（首頁底部 tab）：個人資料、偏好、登出
import type { User } from 'firebase/auth';
import { PrefsList, ProfileEditor, SignOutButton } from '../components/Settings.tsx';
import { useSuperAdmin } from '../lib/admin.ts';
import { Link } from '../lib/router.tsx';
import { TopBar } from '../ui.tsx';

export default function SettingsPage({ user }: { user: User }) {
  const admin = useSuperAdmin(user.uid);
  return (
    <main className="page">
      <TopBar title="設定" />
      <section className="panel"><ProfileEditor /></section>
      <section className="stack"><PrefsList /></section>
      {admin && <Link to="/admin" className="listrow list"><span className="grow">超級管理員</span><span className="muted small">所有牌友圈</span></Link>}
      <SignOutButton />
    </main>
  );
}
