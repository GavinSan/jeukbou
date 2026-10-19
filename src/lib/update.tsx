// 新版本：每分鐘同埋返到 app 時睇 /version.json。
// 返到 app（由背景切返嚟）而又冇入緊數，就自動重新載入；用緊就喺頂部提示「更新」。
import { useEffect, useState } from 'react';

const busyNow = () => document.body.classList.contains('entering') || document.body.classList.contains('editing-ft') || !!document.querySelector('.sheet');

export function UpdateWatcher() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let alive = true;
    const check = async (auto: boolean) => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const j = (await res.json()) as { id?: string };
        if (!alive || !j.id || j.id === __BUILD_ID__) return;
        if (auto && !busyNow()) window.location.reload();
        else setFresh(true);
      } catch { /* 冇網就算 */ }
    };
    const timer = window.setInterval(() => check(false), 60000);
    const onVis = () => { if (document.visibilityState === 'visible') check(true); };
    document.addEventListener('visibilitychange', onVis);
    check(true);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!fresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>有新版本</span>
      <button type="button" className="btn small-btn" onClick={() => window.location.reload()}>更新</button>
    </div>
  );
}
