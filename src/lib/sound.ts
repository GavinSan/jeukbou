// 聲效：全部用 Web Audio 即場合成，唔使聲音檔。
// iPhone 要用戶撳過一下先出到聲，所以第一次撳掣時 unlock()。

import { prefs, setPref } from './prefs.ts';

let ctx: AudioContext | null = null;

export const soundOn = (): boolean => prefs().sound;
export const setSoundOn = (on: boolean) => setPref('sound', on);

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => undefined); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
}

function ready(): AudioContext | null {
  if (!soundOn() || !ctx || ctx.state !== 'running') return null;
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** 一下牌撞牌嘅「嗒」 */
function clack(c: AudioContext, at: number, gain = 0.5, freq = 2400) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.05);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 6;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + 0.06);

  const body = c.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(380, at);
  body.frequency.exponentialRampToValueAtTime(180, at + 0.06);
  const bg = c.createGain();
  bg.gain.setValueAtTime(gain * 0.5, at);
  bg.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
  body.connect(bg).connect(c.destination);
  body.start(at);
  body.stop(at + 0.08);
}

/** 籌碼「叮叮」 */
function ping(c: AudioContext, at: number, freq: number, gain = 0.18) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + 0.3);
}

/** 一粒音：可以滑音 */
function tone(c: AudioContext, at: number, freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; to?: number; attack?: number } = {}) {
  const o = c.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, at);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, at + dur);
  const g = c.createGain();
  const peak = opts.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + (opts.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** 一嚿噪音：沙沙、嘭 */
function hiss(c: AudioContext, at: number, dur: number, opts: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; gain?: number } = {}) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.05);
  const f = c.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.setValueAtTime(opts.freq ?? 1200, at);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, at + dur);
  f.Q.value = opts.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.3, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + dur + 0.05);
}

const jitter = (x: number, pct = 0.06) => x * (1 + (Math.random() * 2 - 1) * pct);
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];

export const sfx = {
  /** 推牌：食糊；每次略有不同，番數高就多一下「叮」 */
  win(fan = 0) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) clack(c, t + i * jitter(0.065, 0.2), jitter(0.5 - i * 0.05), jitter(2400, 0.15));
    if (fan >= 20) {
      const notes = fan >= 70 ? [0, 2, 4, 5, 7] : fan >= 40 ? [0, 2, 4] : [0, 3];
      notes.forEach((k, i) => tone(c, t + 0.25 + i * 0.07, PENTA[k], 0.5, { type: 'triangle', gain: 0.14 }));
    }
  },
  /** 自摸：一下翻牌 + 清脆兩粒音 */
  selfDraw() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    hiss(c, t, 0.12, { type: 'highpass', freq: 3000, gain: 0.18 });
    clack(c, t + 0.1, 0.6, 2800);
    tone(c, t + 0.2, 1046.5, 0.35, { type: 'triangle', gain: 0.16 });
    tone(c, t + 0.29, 1568, 0.45, { type: 'triangle', gain: 0.14 });
  },
  /** 雙響／三響：連環推牌 */
  multi(n = 2) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < 3; i++) clack(c, t + k * 0.22 + i * 0.05, 0.5, jitter(2200 + k * 300));
      tone(c, t + k * 0.22 + 0.12, 660 * (k + 1) ** 0.5, 0.25, { type: 'square', gain: 0.05 });
    }
  },
  /** 特別事項：每款唔同 */
  special(art: string) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    switch (art) {
      case 'flower': // 風鈴
        [0, 2, 4, 6, 7].forEach((k, i) => tone(c, t + i * jitter(0.08), PENTA[k], 0.7, { type: 'sine', gain: 0.12 }));
        break;
      case 'grass': // 沙沙
        hiss(c, t, 0.5, { type: 'bandpass', freq: 5000, to: 2500, q: 0.8, gain: 0.2 });
        hiss(c, t + 0.15, 0.4, { type: 'bandpass', freq: 4000, to: 2000, q: 0.8, gain: 0.14 });
        break;
      case 'kong': // 四隻牌重重哋
        for (let i = 0; i < 4; i++) clack(c, t + i * 0.09, 0.6, 1500 + i * 120);
        tone(c, t + 0.36, 110, 0.3, { type: 'sine', gain: 0.4, to: 60 });
        break;
      case 'heaven': { // 天槓：四下重重砸牌（一下比一下高）＋ 銅鑼 ＋ 金光叮叮
        for (let i = 0; i < 4; i++) {
          const at = t + 0.15 + i * 0.16;
          clack(c, at, 0.9, 1100 + i * 260);
          tone(c, at, 120 - i * 8, 0.32, { type: 'sine', gain: 0.55, to: 55 });
        }
        const g = t + 0.85;
        tone(c, g, 98, 2.6, { type: 'sine', gain: 0.42, attack: 0.01 });
        tone(c, g, 147.5, 2.2, { type: 'triangle', gain: 0.14, attack: 0.01 });
        tone(c, g, 233, 1.6, { type: 'sine', gain: 0.1, attack: 0.02, to: 228 });
        hiss(c, g, 1.2, { type: 'bandpass', freq: 3200, to: 1400, q: 0.7, gain: 0.12 });
        [0, 2, 4, 5, 7, 5, 7].forEach((k, i) => tone(c, g + 0.25 + i * 0.07, PENTA[k] * 2, 0.6, { type: 'sine', gain: 0.07 }));
        [2400, 2900, 3300, 2700].forEach((f, i) => ping(c, t + 1.4 + i * 0.09, jitter(f, 0.04), 0.12));
        break;
      }
      case 'forgot': // 唔記得開：「咚」一聲重重，跟住「哎～」跌落嚟
        tone(c, t, 90, 0.5, { type: 'sine', gain: 0.55, to: 45 });
        clack(c, t, 0.7, 900);
        [523.25, 466.16, 392, 311.13].forEach((f, i) => tone(c, t + 0.18 + i * 0.13, f, 0.18, { type: 'triangle', gain: 0.12, to: f * 0.94 }));
        tone(c, t + 0.75, 233, 0.5, { type: 'sawtooth', gain: 0.05, to: 180 });
        break;
      case 'triple': // 骰仔碌完，升調小號「噹噹噹～」
        for (let i = 0; i < 7; i++) clack(c, t + i * 0.06 + Math.random() * 0.03, 0.3, 1800 + Math.random() * 1500);
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + 0.5 + i * 0.1, f, i === 3 ? 0.5 : 0.14, { type: 'square', gain: 0.06 }));
        break;
      case 'dice123': // 骰仔碌完，「哇哇哇～」跌落嚟
        for (let i = 0; i < 7; i++) clack(c, t + i * 0.06 + Math.random() * 0.03, 0.3, 1800 + Math.random() * 1500);
        [392, 370, 349.23].forEach((f, i) => tone(c, t + 0.5 + i * 0.22, f, 0.2, { type: 'sawtooth', gain: 0.06, to: f * 0.97 }));
        tone(c, t + 1.16, 329.63, 0.6, { type: 'sawtooth', gain: 0.06, to: 300 });
        break;
      case 'pong': // 叫碰唔碰：「咦？」兩聲反問
        tone(c, t, 330, 0.16, { type: 'triangle', gain: 0.14, to: 440 });
        tone(c, t + 0.2, 300, 0.32, { type: 'triangle', gain: 0.14, to: 520 });
        clack(c, t + 0.55, 0.4, 2000);
        break;
      case 'chase':
        hiss(c, t, 0.35, { type: 'bandpass', freq: 600, to: 3000, q: 2, gain: 0.25 });
        clack(c, t + 0.3, 0.6, 2600);
        break;
      default:
        [2900, 3400, 3100].forEach((f, i) => ping(c, t + i * 0.06, jitter(f, 0.03)));
    }
  },
  /** 詐糊：嗡嗡 */
  falseWin() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 140, 0.5, { type: 'sawtooth', gain: 0.09 });
    tone(c, t, 147, 0.5, { type: 'sawtooth', gain: 0.07 });
  },
  /** 流局：兩粒向下嘅音 */
  draw() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 659.25, 0.3, { type: 'triangle', gain: 0.14 });
    tone(c, t + 0.18, 493.88, 0.45, { type: 'triangle', gain: 0.14 });
    hiss(c, t, 0.4, { type: 'lowpass', freq: 800, gain: 0.08 });
  },
  /** 完場：小小號角 */
  end() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + i * 0.12, f, i === 3 ? 0.8 : 0.25, { type: 'triangle', gain: 0.15 }));
  },
  /** 撤回：倒吸一口氣 */
  undo() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    hiss(c, t, 0.25, { type: 'bandpass', freq: 3000, to: 500, q: 1.5, gain: 0.2 });
    tone(c, t, 700, 0.2, { type: 'sine', gain: 0.1, to: 350 });
  },
  /** 即摸連撳：每撳一下音高一級，越嚟越急 */
  ramp(level: number) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    const base = [392, 523.25, 659.25, 880][Math.max(0, Math.min(3, level))];
    tone(c, t, base, 0.18 + level * 0.06, { type: 'square', gain: 0.06 + level * 0.015, to: base * 1.5 });
    for (let i = 0; i < level; i++) tone(c, t + 0.06 * (i + 1), base * (1.25 + i * 0.25), 0.15, { type: 'triangle', gain: 0.1 });
    if (level >= 3) hiss(c, t + 0.1, 0.4, { type: 'highpass', freq: 2000, gain: 0.15 });
  },
  /** 煙花：咻……嘭 */
  firework(power = 1) {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    const n = Math.min(8, Math.max(1, Math.round(power)));
    for (let i = 0; i < n; i++) {
      const at = t + i * jitter(0.28, 0.3);
      tone(c, at, jitter(900), 0.5, { type: 'sine', gain: 0.05, to: jitter(2600) });
      hiss(c, at + 0.5, 0.6, { type: 'lowpass', freq: 1800, to: 200, gain: 0.45 });
      tone(c, at + 0.5, 90, 0.35, { type: 'sine', gain: 0.35, to: 40 });
      for (let k = 0; k < 4; k++) hiss(c, at + 0.6 + k * 0.05 + Math.random() * 0.1, 0.06, { type: 'highpass', freq: 5000, gain: 0.12 });
    }
  },
  /** 彩炮：啪 */
  popper() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    hiss(c, t, 0.15, { type: 'highpass', freq: 1500, gain: 0.5 });
    tone(c, t, 180, 0.12, { type: 'sine', gain: 0.3, to: 80 });
    for (let k = 0; k < 6; k++) hiss(c, t + 0.1 + k * 0.04, 0.05, { type: 'highpass', freq: 6000, gain: 0.1 });
  },
  /** 籌碼：找數、特別事項 */
  chips() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    [2900, 3400, 3100].forEach((f, i) => ping(c, t + i * 0.06, f));
  },
  /** 找數：清脆「叮叮」提示聲（好似收銀機／門鈴），唔再係扣血聲 */
  settle() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    const bell = (at: number, f: number, g: number) => {
      tone(c, at, f, 0.9, { type: 'sine', gain: g, attack: 0.004 });
      tone(c, at, f * 2.76, 0.35, { type: 'sine', gain: g * 0.25, attack: 0.004 });
      tone(c, at, f * 5.4, 0.18, { type: 'sine', gain: g * 0.08, attack: 0.002 });
    };
    bell(t, 1318.5, 0.22);
    bell(t + 0.16, 1760, 0.2);
  },
  /** 一下：撳掣、流局 */
  tap() {
    const c = ready();
    if (!c) return;
    clack(c, c.currentTime, 0.35, 2000);
  },
  /** 擲骰 */
  dice() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 9; i++) clack(c, t + i * 0.07 + Math.random() * 0.03, 0.25 + Math.random() * 0.2, 1800 + Math.random() * 1600);
  },
};
