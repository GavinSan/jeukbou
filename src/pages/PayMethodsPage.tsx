// 設定 → 收款資料：香港轉數快／PayMe、加拿大 Interac、美國 Zelle／Venmo、英國、澳洲、日本…；每個方法自己揀顯示定收埋
import type { User } from 'firebase/auth';
import { PayMethodsEditor } from '../components/PayMethods.tsx';
import { setPayMethods } from '../lib/data.ts';
import { useProfile } from '../lib/live.ts';
import { methodsOf } from '../lib/payMethods.ts';
import { Loading, TopBar } from '../ui.tsx';

export default function PayMethodsPage({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  if (profile.loading) return <main className="page"><TopBar back="/settings" title="收款資料" /><Loading /></main>;
  const list = methodsOf(profile.data.payMethods, profile.data.payEmail);
  return (
    <main className="page">
      <TopBar back="/settings" title="收款資料" />
      <p className="muted small">同圈牌友找數時，撳你個名就見到你揀咗「顯示」嘅方法，一撳複製或者開 app。收埋咗嘅淨係你自己見到。</p>
      <PayMethodsEditor list={list} onSave={(next) => setPayMethods(user, next.map((m) => (m.id === 'legacy' ? { ...m, id: 'interac1' } : m)), profile.data.groups)} />
    </main>
  );
}
