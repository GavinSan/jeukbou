// 設定：只影響呢部機
import { useState } from 'react';
import { setPref, usePrefs } from '../lib/prefs.ts';
import type { Prefs } from '../lib/prefs.ts';
import { buzz } from '../lib/haptics.ts';
import { sfx, unlock } from '../lib/sound.ts';
import { Sheet } from '../ui.tsx';

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);

const ROWS: { key: keyof Prefs; label: string; note: string }[] = [
  { key: 'hints', label: '提示文字', note: '顯示各頁的簡短說明' },
  { key: 'sound', label: '聲效', note: '食糊、找數、擲骰' },
  {
    key: 'vibe',
    label: '震動',
    note: canVibrate ? '同枱有人食糊或找數時震動' : isIOS ? 'iPhone 網頁版只有輕震；App 版會完整支援' : '此瀏覽器不支援震動',
  },
];

export default function Settings({ onClose }: { onClose: () => void }) {
  const p = usePrefs();
  return (
    <Sheet onClose={onClose} label="設定">
      <h2>設定</h2>
      <div className="list flat">
        {ROWS.map((r) => (
          <div key={r.key} className="rule-row">
            <span className="grow">{r.label}<small>{r.note}</small></span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={p[r.key]}
              aria-label={r.label}
              onClick={() => {
                unlock();
                const on = !p[r.key];
                setPref(r.key, on);
                if (on && r.key === 'sound') setTimeout(() => sfx.tap(), 30);
                if (on && r.key === 'vibe') buzz('tap');
              }}
            />
          </div>
        ))}
      </div>
      <p className="muted small">設定只儲存在這部裝置。</p>
      <button type="button" className="btn big" onClick={onClose}>完成</button>
    </Sheet>
  );
}

/** 齒輪掣：撳開設定 */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="iconbtn" aria-label="設定" onClick={() => { unlock(); setOpen(true); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
      {open && <Settings onClose={() => setOpen(false)} />}
    </>
  );
}
