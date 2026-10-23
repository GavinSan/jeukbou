// 設定頁（首頁底部 tab）：個人資料、偏好、登出
import type { User } from 'firebase/auth';
import { PrefsList, ProfileEditor, SignOutButton, SkinPicker } from '../components/Settings.tsx';
import { useSuperAdmin } from '../lib/admin.ts';
import { useProfile } from '../lib/live.ts';
import { useMyHistory, useTierSync } from '../lib/stats.ts';
import { Link } from '../lib/router.tsx';
import { TopBar } from '../ui.tsx';

export default function SettingsPage({ user }: { user: User }) {
  const admin = useSuperAdmin(user.uid);
  // 風格解鎖要知段位
  const profile = useProfile(user.uid);
  const h = useMyHistory(profile.loading ? null : user.uid, profile.data.groups);
  useTierSync(h, !profile.loading);
  return (
    <main className="page">
      <TopBar title="設定" />
      <section className="panel"><ProfileEditor /></section>
      <section className="stack"><h2 className="section-head">風格</h2><SkinPicker /></section>
      <section className="stack"><PrefsList /></section>
      {admin && <Link to="/admin" className="listrow list"><span className="grow">超級管理員</span><span className="muted small">牌友圈、用家、風格、通知、測試</span></Link>}
      <SignOutButton />
    </main>
  );
}
