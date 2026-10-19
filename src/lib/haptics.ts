// 震機：Android 用 Vibration API；iPhone（iOS 18 起）冇呢個 API，
// 用「撳一下開關」嘅觸感代替，只係一下輕震，而且未必次次有。
import { prefs } from './prefs.ts';

const PATTERN = { win: [35, 45, 35], hit: [90, 50, 160], tap: [18], tick: [6] } as const;
export type Buzz = keyof typeof PATTERN;

let iosLabel: HTMLLabelElement | null = null;
function iosTick() {
  if (!iosLabel) {
    iosLabel = document.createElement('label');
    iosLabel.setAttribute('aria-hidden', 'true');
    iosLabel.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    iosLabel.appendChild(input);
    document.body.appendChild(iosLabel);
  }
  iosLabel.click();
}

export function buzz(kind: Buzz) {
  if (!prefs().vibe || typeof navigator === 'undefined') return;
  const pattern = PATTERN[kind];
  if (typeof navigator.vibrate === 'function') {
    try { navigator.vibrate([...pattern]); } catch { /* 冇權就算 */ }
    return;
  }
  // iPhone：一個震就一下，間隔跟返 pattern
  let at = 0;
  for (let i = 0; i < pattern.length; i += 2) {
    setTimeout(iosTick, at);
    at += pattern[i] + (pattern[i + 1] ?? 0);
  }
}
