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

export const sfx = {
  /** 推牌：食糊 */
  win() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    clack(c, t, 0.55, 2600);
    clack(c, t + 0.07, 0.45, 2200);
    clack(c, t + 0.13, 0.4, 2400);
  },
  /** 籌碼：找數、特別事項 */
  chips() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    [2900, 3400, 3100].forEach((f, i) => ping(c, t + i * 0.06, f));
  },
  /** 找數：似打機扣血，「嘭」一下再一路跌落去 */
  settle() {
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    // 重擊：低頻 thump
    const k = c.createOscillator();
    k.type = 'sine';
    k.frequency.setValueAtTime(160, t);
    k.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const kg = c.createGain();
    kg.gain.setValueAtTime(0.7, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    k.connect(kg).connect(c.destination);
    k.start(t);
    k.stop(t + 0.24);
    // 碎聲
    const n = c.createBufferSource();
    n.buffer = noiseBuffer(c, 0.12);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.1);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    n.connect(lp).connect(ng).connect(c.destination);
    n.start(t);
    n.stop(t + 0.12);
    // 8-bit 扣血：方波一級級跌
    const sq = c.createOscillator();
    sq.type = 'square';
    const steps = [660, 520, 400, 300, 220, 160];
    steps.forEach((f, i) => sq.frequency.setValueAtTime(f, t + 0.06 + i * 0.045));
    const sf = c.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 2200;
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.12, t + 0.07);
    sg.gain.setValueAtTime(0.12, t + 0.28);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    sq.connect(sf).connect(sg).connect(c.destination);
    sq.start(t + 0.05);
    sq.stop(t + 0.4);
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
