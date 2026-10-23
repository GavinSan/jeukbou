// AirPlay 說明：預覽電視畫面、點樣射上電視，撳掣入電視模式（即係 Live）
import { useState } from 'react';
import { go } from '../lib/router.tsx';
import type { ReactNode } from 'react';

export function AirPlaySheet({ tvHref, preview }: { tvHref: string; preview: ReactNode }) {
  const [how, setHow] = useState(false);
  return (
    <div className="airplay">
      <h2 className="airplay-title">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2" /><path d="M12 15l5 6H7z" /></svg>
        AirPlay
      </h2>
      <div className="airplay-tv" aria-hidden="true">
        <div className="airplay-screen">{preview}</div>
        <i className="airplay-stand" />
      </div>
      <p className="center-text">將麻雀枱射上電視，分數會即時更新。</p>
      <p className="airplay-note">♫ 其他 App 嘅音樂會喺電視度播。</p>
      {how && (
        <ol className="airplay-how">
          <li>撳下面「開電視模式」，再<b>打橫部機</b>。</li>
          <li>iPhone：由右上角向下掃開<b>控制中心</b> →「螢幕鏡像」→ 揀你部 Apple TV 或者 AirPlay 電視。</li>
          <li>Android：落拉通知欄 →「投放／Smart View」→ 揀電視。</li>
          <li>其他人照用自己部機入數，電視即時更新。</li>
          <li>建議用一部後備電話或者 iPad 專門射電視，咁你自己部機可以照用。</li>
        </ol>
      )}
      <div className="airplay-acts">
        <button type="button" className="btn plain" onClick={() => setHow((v) => !v)}>{how ? '收起' : '點樣用 AirPlay'}</button>
        <button type="button" className="btn big" onClick={() => go(tvHref)}>開電視模式</button>
      </div>
    </div>
  );
}
