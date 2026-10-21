// 教人將雀簿加到主畫面：按部機（iPhone Safari／iPhone 其他瀏覽器／Android）出唔同步驟
import { useState } from 'react';
import type { ReactNode } from 'react';
import { isStandalone, iosBrowserName, inAppBrowser, platform, promptInstall, snoozeInstall, shouldNudgeInstall, skipGuideBeforeLogin, useInstall } from '../lib/install.ts';
import type { Platform } from '../lib/install.ts';
import { Logo, Sheet } from '../ui.tsx';
import { askNotify, notifySupported } from '../lib/notify.ts';
import { registerPush } from '../lib/push.ts';
import { setPref, usePrefs } from '../lib/prefs.ts';

const ShareIcon = () => (
  <svg className="ig-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5v10h14V11h-1" /></svg>
);
const MoreIcon = () => (
  <svg className="ig-ic" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
);
const AddIcon = () => (
  <svg className="ig-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
);
const KebabIcon = () => (
  <svg className="ig-ic" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
);

function CopyLink({ url, label }: { url: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn plain" onClick={async () => {
      try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt('複製呢條連結', url); }
    }}>{done ? '已複製 ✓' : label}</button>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="ig-steps">{items.map((s, i) => <li key={i}><span className="ig-no">{i + 1}</span><span className="grow">{s}</span></li>)}</ol>;
}

export function InstallSteps({ inviteLink, p = platform() }: { inviteLink?: string | null; p?: Platform }) {
  const { canPrompt } = useInstall();
  const inApp = inAppBrowser();
  const here = typeof location !== 'undefined' ? location.origin + (inviteLink ?? '') : '';
  return (
    <div className="ig">
      {p === 'ios-safari' && (
        <Steps items={[
          <>撳 Safari 底部嘅 <MoreIcon />（如果見到 <ShareIcon /> 分享掣，就直接撳佢）</>,
          <>揀 <ShareIcon />「分享」</>,
          <>向下碌，撳 <AddIcon />「加入主畫面」</>,
          <>確認「以網頁 App 開啟」開咗，撳右上角「加入」</>,
          <>返主畫面撳「雀簿」圖示，<b>喺嗰度登入</b></>,
        ]} />
      )}
      {p === 'ios-other' && (
        <>
          <p className="ig-warn">你而家喺 <b>{iosBrowserName()}</b> 入面開緊。{inApp ? `${inApp} 入面加唔到主畫面，` : ''}要用 <b>Safari</b> 開先加得最穩陣。</p>
          <Steps items={[
            inApp ? <>撳右上角或者右下角嘅 <MoreIcon />／<ShareIcon />，揀「用 Safari 開啟」</> : <>撳下面「複製連結」，開 Safari 貼上網址</>,
            <>喺 Safari 撳底部 <MoreIcon /> → <ShareIcon />「分享」→ <AddIcon />「加入主畫面」</>,
            <>返主畫面撳「雀簿」圖示，<b>喺嗰度登入</b></>,
          ]} />
          <CopyLink url={here} label="複製連結" />
        </>
      )}
      {p === 'android' && (
        inApp ? (
          <>
            <p className="ig-warn">你而家喺 <b>{inApp}</b> 入面開緊，要轉去 <b>Chrome</b> 先加到主畫面。</p>
            <Steps items={[
              <>撳右上角 <KebabIcon />，揀「用 Chrome 開啟」（或者「喺瀏覽器開啟」）</>,
              <>喺 Chrome 撳右上角 <KebabIcon /> →「加到主畫面」或者「安裝應用程式」</>,
              <>返主畫面撳「雀簿」圖示開</>,
            ]} />
            <CopyLink url={here} label="複製連結" />
          </>
        ) : canPrompt ? (
          <>
            <button type="button" className="btn big" onClick={() => promptInstall()}>安裝雀簿</button>
            <small className="muted">撳完揀「安裝」，之後喺主畫面開。</small>
          </>
        ) : (
          <Steps items={[
            <>撳 Chrome 右上角 <KebabIcon /></>,
            <>揀「加到主畫面」或者「安裝應用程式」</>,
            <>撳「安裝」，之後喺主畫面撳「雀簿」圖示開</>,
          ]} />
        )
      )}
      {p === 'desktop' && <p className="muted">電腦用 Chrome／Edge：撳網址列右邊嘅安裝圖示，或者選單 →「安裝雀簿」。</p>}
      {inviteLink && (
        <div className="ig-invite">
          <b>你有邀請連結</b>
          <small>主畫面版會由主頁開始。先複製邀請連結，加咗之後喺 app 登入，去「牌友圈 → 新增」貼上就加入到。</small>
          <CopyLink url={here} label="複製邀請連結" />
        </div>
      )}
      <ul className="ig-why">
        <li>全螢幕，好似真 app 咁</li>
        <li>開得快，冇網都睇到之前嘅數</li>
        <li>收到約局同三缺一通知{p.startsWith('ios') ? '（iPhone 一定要加咗先收到）' : ''}</li>
      </ul>
    </div>
  );
}

/** 登入前：手機用瀏覽器開，就先教加主畫面（iPhone 主畫面版同 Safari 分開登入） */
export function InstallGate({ joining, onSkip }: { joining: boolean; onSkip: () => void }) {
  const inviteLink = joining ? location.pathname : null;
  const ios = platform().startsWith('ios');
  return (
    <main className="page narrow install-gate">
      <div className="brand">
        <Logo />
        <h1>雀簿</h1>
      </div>
      <section className="panel stack">
        <h2>先加到主畫面，再登入</h2>
        <p className="muted small">{ios ? 'iPhone 主畫面版同 Safari 係分開登入嘅，喺呢度登入咗，主畫面版都要再登入一次。所以先加，再喺主畫面版登入。' : '加咗之後由主畫面開，用起嚟好似真 app 咁。'}</p>
        <InstallSteps inviteLink={inviteLink} />
      </section>
      <button type="button" className="textbtn" onClick={() => { skipGuideBeforeLogin(); onSkip(); }}>唔加住，直接喺呢度登入</button>
    </main>
  );
}

/** 主頁：已登入但用緊瀏覽器開，每次開都輕輕提（撳「遲啲」三日內唔提） */
export function InstallCard() {
  const [show, setShow] = useState(() => shouldNudgeInstall());
  const [open, setOpen] = useState(false);
  const { installed } = useInstall();
  if (!show || installed) return null;
  return (
    <>
      <section className="nudge install" role="status">
        <span className="nudge-icon" aria-hidden="true">📲</span>
        <span className="grow">
          <b>加雀簿到主畫面</b>
          <small>全螢幕、開得快、收到約局通知。</small>
        </span>
        <span className="nudge-acts">
          <button type="button" className="btn small-btn" onClick={() => setOpen(true)}>教我</button>
          <button type="button" className="textbtn" onClick={() => { snoozeInstall(3); setShow(false); }}>遲啲先</button>
        </span>
      </section>
      {open && (
        <Sheet onClose={() => setOpen(false)} label="加到主畫面">
          <h2>加到主畫面</h2>
          {platform().startsWith('ios') && <p className="muted small">加咗之後要喺主畫面版再登入一次（同 Safari 分開）。</p>}
          <InstallSteps />
        </Sheet>
      )}
    </>
  );
}

const NOTIFY_SNOOZE = 'jeukbou-notify-snooze';

/** 主頁：加咗主畫面（或者 Android／電腦）但未開通知，就提一提；撳「遲啲」一個禮拜唔提 */
export function NotifyCard({ uid }: { uid: string }) {
  const p = usePrefs();
  const [hidden, setHidden] = useState(() => {
    try { return Date.now() < Number(localStorage.getItem(NOTIFY_SNOOZE) ?? 0); } catch { return false; }
  });
  const [msg, setMsg] = useState('');
  if (hidden || p.notify || !notifySupported()) return null;
  if (platform().startsWith('ios') && !isStandalone()) return null;
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return null;
  return (
    <section className="nudge" role="status">
      <span className="nudge-icon" aria-hidden="true">🔔</span>
      <span className="grow">
        <b>開通知？</b>
        <small>{msg || '有人約局、三缺一、番數表更新即刻知。'}</small>
      </span>
      <span className="nudge-acts">
        <button type="button" className="btn small-btn" onClick={async () => {
          const r = await askNotify();
          if (r !== 'granted') { setMsg(r === 'denied' ? '通知被封鎖咗，要去手機設定開返。' : '呢部機唔支援通知。'); return; }
          setPref('notify', true);
          registerPush(uid, true).catch(() => undefined);
        }}>開</button>
        <button type="button" className="textbtn" onClick={() => {
          try { localStorage.setItem(NOTIFY_SNOOZE, String(Date.now() + 7 * 86400000)); } catch { /* 存唔到就算 */ }
          setHidden(true);
        }}>遲啲先</button>
      </span>
    </section>
  );
}
