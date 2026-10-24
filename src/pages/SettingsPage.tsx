// 設定頁（首頁底部 tab）：個人資料、偏好、登出
import type { User } from 'firebase/auth';
import { FeedbackButton, PrefsList, ProfileEditor, SignOutButton, SkinPicker } from '../components/Settings.tsx';
import { useIsSuperAdmin } from '../lib/admin.ts';
import { setPref, usePrefs } from '../lib/prefs.ts';
import { useProfile } from '../lib/live.ts';
import { useMyHistory, useTierSync } from '../lib/stats.ts';
import { Link } from '../lib/router.tsx';
import { TopBar } from '../ui.tsx';

export default function SettingsPage({ user }: { user: User }) {
  const admin = useIsSuperAdmin(user.uid);
  const { adminMode } = usePrefs();
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
      <FeedbackButton />
      {admin && (
        <section className="stack admin-mode">
          <div className="water-toggle">
            <span className="grow">使用超級管理員身份<small className="muted">{adminMode ? '　開咗：所有功能最大權限，可以 override' : '　閂咗：同普通用家睇到嘅一樣'}</small></span>
            <button type="button" role="switch" className="switch" aria-checked={adminMode} aria-label="使用超級管理員身份" onClick={() => setPref('adminMode', !adminMode)} />
          </div>
          <Link to="/admin" className="listrow list"><span className="grow">超級管理員</span><span className="muted small">牌友圈、用家、風格、通知、測試</span></Link>
        </section>
      )}
      <SignOutButton />
    </main>
  );
}
