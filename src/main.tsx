import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';
import { applySkin, prefs } from './lib/prefs.ts';

// 未出畫面之前就套用風格（光暗跟風格），唔會閃一下
applySkin(prefs().skin);

// 唔准縮放（iOS Safari 唔理 user-scalable=no，要自己擋雙指手勢；雙擊放大由 CSS touch-action 處理）
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
