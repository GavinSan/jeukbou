// 一張枱嘅計分引擎：輸入每一鋪（事件），輸出新狀態同每筆數。
// 所有分數由事件推算，所以撤回 = 由頭 replay 少一鋪。

import type { Rules } from './rules.ts';
import { DEFAULT_RULES, halfOf } from './rules.ts';

export type PlayerId = string;

/** puller 拉緊 pulled：pulled 未找俾 puller 嘅數（籌碼擺喺 pulled 左下角） */
export interface Chain {
  puller: PlayerId;
  pulled: PlayerId;
  owed: number;
  count: number;
}

export interface TableState {
  /** 4 個位，0–3 = 起始東南西北 */
  seats: PlayerId[];
  dealerSeat: number;
  /** 連莊次數 n，莊番 = 2n + 1 */
  streak: number;
  /** 過咗幾多次莊，4 次 = 一圈 */
  dealerTurns: number;
  /** 打咗幾多鋪（食糊 + 流局） */
  hand: number;
  /** 已經真正找咗嘅數（+ 收，− 俾） */
  settled: Record<PlayerId, number>;
  /** 抽水累積 */
  water: number;
  chains: Chain[];
  /** 上一鋪食糊係雙響 / 三響，用嚟計反雙 / 反三響 */
  lastMultiWin: { loser: PlayerId; winners: PlayerId[] } | null;
  /** 打完預定圈數之後加咗幾多個快圈（快東、快南…） */
  extraRounds: number;
  /** 打完預定圈數（或者快圈），等全枱揀：打快圈、換人、定完場 */
  roundsDone: boolean;
  ended: boolean;
}

export interface WinnerHand {
  player: PlayerId;
  /** 牌型番（唔包底、莊、雙響、反響，引擎自動加） */
  fan: number;
}

export type TableEvent =
  /** 食出：1 個 winner + loser；雙響 / 三響：2–3 個 winner + loser；自摸：1 個 winner，loser = null */
  | {
      type: 'win'; winners: WinnerHand[]; loser: PlayerId | null;
      /** 呢鋪莊點計：唔填 = 跟家規（1 + 連莊 × 2）；one = 當 1 番（例如擺骰）；none = 唔計 */
      dealer?: 'one' | 'none';
    }
  /** 特別事項（花、槓、骰…）：即時找數，唔影響拉，唔抽水 */
  | {
      type: 'special'; player: PlayerId; label: string; amount: number; direction: 'collect' | 'pay';
      /** 介面用：邊款特別事項、追牌係番子定非番子、同一隻追咗幾多次 */
      meta?: { art?: string; chase?: 'fan' | 'other'; repeat?: number; instant?: boolean };
    }
  | { type: 'falseWin'; player: PlayerId }
  | { type: 'draw' }
  /** 打完圈數之後繼續：rounds = 1 係快圈（快東、快南…），4 = 再打四圈；拉住嘅數照拉 */
  | { type: 'extend'; rounds?: number }
  /** 中途換位（例如打完四圈）：同一班人重新排位，坐東位嘅做莊；拉住嘅數照拉 */
  | { type: 'reseat'; seats: PlayerId[] }
  /** 輸家喺第 3、6、9… 拉揀找數 */
  | { type: 'settle'; puller: PlayerId; pulled: PlayerId }
  /** 換位：批咗即時生效，呢張枱有拉就即時找數 */
  | { type: 'swap'; out: PlayerId; in: PlayerId }
  | { type: 'end' };

export type LineKind = 'pending' | 'settle' | 'instant' | 'water';

export interface Line {
  /** pending = 擺低籌碼；settle = 找數；instant = 特別事項即時找；water = 抽水 */
  kind: LineKind;
  from: PlayerId;
  /** null = 水 */
  to: PlayerId | null;
  amount: number;
  note: string;
}

export interface Prompt {
  type: 'maySettle';
  puller: PlayerId;
  pulled: PlayerId;
  owed: number;
  count: number;
}

export interface StepResult {
  state: TableState;
  lines: Line[];
  prompts: Prompt[];
}

export class RuleError extends Error {}

const WINDS = ['東', '南', '西', '北'];

export function createTable(seats: PlayerId[], dealerSeat = 0): TableState {
  if (seats.length !== 4 || new Set(seats).size !== 4) throw new RuleError('一張枱需要 4 位不同玩家');
  const settled: Record<PlayerId, number> = {};
  for (const p of seats) settled[p] = 0;
  return {
    seats: [...seats],
    dealerSeat,
    streak: 0,
    dealerTurns: 0,
    hand: 0,
    settled,
    water: 0,
    chains: [],
    lastMultiWin: null,
    extraRounds: 0,
    roundsDone: false,
    ended: false,
  };
}

export function applyEvent(prev: TableState, ev: TableEvent, rules: Rules = DEFAULT_RULES): StepResult {
  if (prev.ended) throw new RuleError('此枱已完場');
  const s: TableState = structuredClone(prev);
  // 舊資料冇呢兩個欄
  s.extraRounds ??= 0;
  s.roundsDone ??= false;
  if (s.roundsDone && (ev.type === 'win' || ev.type === 'draw' || ev.type === 'special' || ev.type === 'falseWin')) {
    throw new RuleError('已打完圈數，請先揀打快圈或者完場');
  }
  const lines: Line[] = [];
  const prompts: Prompt[] = [];
  const received: Record<PlayerId, number> = {};

  const move = (from: PlayerId, to: PlayerId, amount: number) => {
    s.settled[from] = (s.settled[from] ?? 0) - amount;
    s.settled[to] = (s.settled[to] ?? 0) + amount;
  };
  const settle = (from: PlayerId, to: PlayerId, amount: number, note: string) => {
    if (amount === 0) return;
    move(from, to, amount);
    lines.push({ kind: 'settle', from, to, amount, note });
    received[to] = (received[to] ?? 0) + amount;
  };
  const instant = (from: PlayerId, to: PlayerId, amount: number, note: string) => {
    if (amount === 0) return;
    move(from, to, amount);
    lines.push({ kind: 'instant', from, to, amount, note });
  };
  const takeWater = (player: PlayerId, amount: number) => {
    const w = rules.water;
    if (!w.enabled || w.per <= 0 || amount <= 0) return;
    const cut = Math.floor(amount / w.per) * w.take;
    if (cut <= 0) return;
    s.settled[player] = (s.settled[player] ?? 0) - cut;
    s.water += cut;
    lines.push({ kind: 'water', from: player, to: null, amount: cut, note: `${amount} 抽 ${cut}` });
  };
  const settleAllChains = (note: string) => {
    for (const c of s.chains) settle(c.pulled, c.puller, c.owed, note);
    s.chains = [];
  };
  const passDealer = () => {
    s.dealerSeat = (s.dealerSeat + 1) % 4;
    s.streak = 0;
    s.dealerTurns += 1;
    // 打完圈數唔會自動完場：停低問全枱（打快圈 / 換人 / 完場），拉照拉
    if (rules.rounds > 0 && s.dealerTurns >= (rules.rounds + s.extraRounds) * 4) s.roundsDone = true;
  };
  const mustSeat = (p: PlayerId) => {
    if (!s.seats.includes(p)) throw new RuleError(`${p} 不在此枱`);
  };

  switch (ev.type) {
    case 'win': {
      const W = ev.winners.map((w) => w.player);
      if (W.length < 1 || W.length > 3) throw new RuleError('贏家需為 1 至 3 位');
      if (new Set(W).size !== W.length) throw new RuleError('贏家重複');
      W.forEach(mustSeat);
      for (const w of ev.winners) {
        if (!Number.isFinite(w.fan) || w.fan < 0) throw new RuleError('番數須為 0 或以上');
      }
      const selfDraw = ev.loser === null;
      if (selfDraw && W.length !== 1) throw new RuleError('自摸只能有一位贏家');
      if (!selfDraw) {
        mustSeat(ev.loser as PlayerId);
        if (W.includes(ev.loser as PlayerId)) throw new RuleError('出銃者不能同時食糊');
      }

      const dealer = s.seats[s.dealerSeat];
      const autoZ = rules.dealer.enabled ? 2 * s.streak + 1 : 0;
      const z = ev.dealer === 'none' ? 0 : ev.dealer === 'one' ? 1 : autoZ;
      const multiLabel = W.length === 2 ? '雙響' : W.length === 3 ? '三響' : '';
      const bonus = W.length === 2 ? rules.multiWinBonus.double : W.length === 3 ? rules.multiWinBonus.triple : 0;

      let rev: { players: PlayerId[]; amount: number; label: string } | null = null;
      const lm = s.lastMultiWin;
      if (rules.reverse.enabled && selfDraw && lm && lm.loser === W[0]) {
        const triple = lm.winners.length === 3;
        rev = {
          players: lm.winners,
          amount: triple ? rules.reverse.triple : rules.reverse.double,
          label: triple ? '反三響' : '反雙響',
        };
      }

      interface Pay { w: PlayerId; p: PlayerId; amount: number; parts: string[]; done: boolean }
      const pays: Pay[] = [];
      for (const { player: w, fan } of ev.winners) {
        const payers = selfDraw ? s.seats.filter((x) => x !== w) : [ev.loser as PlayerId];
        for (const p of payers) {
          const parts = [`${fan} 番`, `底 ${rules.base}`];
          let amount = fan + rules.base;
          if (bonus) { amount += bonus; parts.push(`${multiLabel} ${bonus}`); }
          if (z && (w === dealer || p === dealer)) { amount += z; parts.push(`莊 ${z}`); }
          if (rev && rev.players.includes(p)) { amount += rev.amount; parts.push(`${rev.label} ${rev.amount}`); }
          pays.push({ w, p, amount, parts, done: false });
        }
      }
      const payOf = (w: PlayerId, p: PlayerId) => pays.find((x) => x.w === w && x.p === p);
      const earned: Record<PlayerId, number> = {};
      const reversed = new Set<string>();

      const kept: Chain[] = [];
      for (const c of s.chains) {
        if (W.includes(c.puller)) {
          const pay = payOf(c.puller, c.pulled);
          if (pay) {
            const extra = halfOf(c.owed, rules.rounding);
            const add = pay.amount + extra;
            c.owed += add;
            c.count += 1;
            pay.done = true;
            earned[c.puller] = (earned[c.puller] ?? 0) + add;
            lines.push({ kind: 'pending', from: c.pulled, to: c.puller, amount: add, note: `${pay.parts.join(' + ')} + 拉 ${extra}（第 ${c.count} 拉）` });
            if (rules.la.settleEvery > 0 && c.count % rules.la.settleEvery === 0) {
              prompts.push({ type: 'maySettle', puller: c.puller, pulled: c.pulled, owed: c.owed, count: c.count });
            }
          }
          kept.push(c);
        } else if (W.includes(c.pulled) && payOf(c.pulled, c.puller)) {
          // 劈：食返嘅人自己留大嗰半（拉嗰邊加嘅一半向上取整，所以俾出去嗰半就細啲），例如 21 → 俾 10、自己留 11
          const kept = halfOf(c.owed, rules.rounding);
          settle(c.pulled, c.puller, c.owed - kept, `劈：${c.owed} ÷ 2`);
          reversed.add(`${c.pulled}>${c.puller}`);
        } else {
          settle(c.pulled, c.puller, c.owed, '斷拉，全數找');
        }
      }
      s.chains = kept;

      for (const pay of pays) {
        if (pay.done) continue;
        earned[pay.w] = (earned[pay.w] ?? 0) + pay.amount;
        if (rules.la.enabled) {
          s.chains.push({ puller: pay.w, pulled: pay.p, owed: pay.amount, count: 1 });
          const tag = reversed.has(`${pay.w}>${pay.p}`) ? '（反拉）' : '';
          lines.push({ kind: 'pending', from: pay.p, to: pay.w, amount: pay.amount, note: pay.parts.join(' + ') + tag });
        } else {
          settle(pay.p, pay.w, pay.amount, pay.parts.join(' + '));
        }
      }

      if (rules.water.timing === 'win') {
        for (const w of W) takeWater(w, earned[w] ?? 0);
      }

      s.lastMultiWin = W.length > 1 ? { loser: ev.loser as PlayerId, winners: W } : null;
      s.hand += 1;
      if (W.includes(dealer)) s.streak += 1;
      else passDealer();
      break;
    }

    case 'draw': {
      s.hand += 1;
      if (rules.dealer.drawKeepsDealer) {
        if (rules.dealer.drawAddsStreak) s.streak += 1;
      } else {
        passDealer();
      }
      break;
    }

    case 'special': {
      mustSeat(ev.player);
      if (!(ev.amount > 0)) throw new RuleError('金額須大於 0');
      for (const other of s.seats) {
        if (other === ev.player) continue;
        if (ev.direction === 'collect') instant(other, ev.player, ev.amount, ev.label);
        else instant(ev.player, other, ev.amount, ev.label);
      }
      break;
    }

    case 'falseWin': {
      mustSeat(ev.player);
      for (const other of s.seats) {
        if (other !== ev.player) instant(ev.player, other, rules.falseWinPenalty, '詐糊');
      }
      break;
    }

    case 'settle': {
      const c = s.chains.find((x) => x.puller === ev.puller && x.pulled === ev.pulled);
      if (!c) throw new RuleError(`${ev.puller} 沒有拉 ${ev.pulled}`);
      const every = rules.la.settleEvery;
      if (every <= 0 || c.count % every !== 0) {
        throw new RuleError(`第 ${c.count} 拉不能找數，須等到第 ${every > 0 ? Math.ceil(c.count / every) * every : '—'} 拉`);
      }
      settle(c.pulled, c.puller, c.owed, `第 ${c.count} 拉找數`);
      s.chains = s.chains.filter((x) => x !== c);
      break;
    }

    case 'swap': {
      mustSeat(ev.out);
      if (s.seats.includes(ev.in)) throw new RuleError(`${ev.in} 已在此枱`);
      if (rules.swapSettle === 'table') {
        settleAllChains('換位找數');
      } else {
        const involved = (c: Chain) => c.puller === ev.out || c.pulled === ev.out;
        for (const c of s.chains) if (involved(c)) settle(c.pulled, c.puller, c.owed, '換位找數');
        s.chains = s.chains.filter((c) => !involved(c));
      }
      s.seats = s.seats.map((p) => (p === ev.out ? ev.in : p));
      if (s.settled[ev.in] === undefined) s.settled[ev.in] = 0;
      const lm = s.lastMultiWin;
      if (lm && (lm.loser === ev.out || lm.winners.includes(ev.out))) s.lastMultiWin = null;
      break;
    }

    case 'end': {
      settleAllChains('完場找數');
      s.ended = true;
      break;
    }

    case 'extend': {
      // 打多一個快圈（快東、快南…）；拉住嘅數照拉
      if (!s.roundsDone) throw new RuleError('未打完圈數');
      s.extraRounds += Math.max(1, Math.round(ev.rounds ?? 1));
      s.roundsDone = false;
      break;
    }

    case 'reseat': {
      const now = [...s.seats].sort().join('|');
      if (ev.seats.length !== s.seats.length || [...ev.seats].sort().join('|') !== now) throw new RuleError('換位只可以同一班人重新排');
      s.seats = [...ev.seats];
      s.dealerSeat = 0;
      s.streak = 0;
      s.lastMultiWin = null;
      break;
    }
  }

  if (rules.water.timing === 'settle') {
    for (const [p, amt] of Object.entries(received)) takeWater(p, amt);
  }
  return { state: s, lines, prompts };
}

export interface Replay {
  state: TableState;
  steps: StepResult[];
}

export function replay(seats: PlayerId[], events: TableEvent[], rules: Rules = DEFAULT_RULES, dealerSeat = 0): Replay {
  let state = createTable(seats, dealerSeat);
  const steps: StepResult[] = [];
  for (const ev of events) {
    const r = applyEvent(state, ev, rules);
    steps.push(r);
    state = r.state;
  }
  return { state, steps };
}

/** 未找數：正數 = 等緊收，負數 = 擺低緊（欠） */
export function pending(state: TableState): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const p of Object.keys(state.settled)) out[p] = 0;
  for (const c of state.chains) {
    out[c.puller] = (out[c.puller] ?? 0) + c.owed;
    out[c.pulled] = (out[c.pulled] ?? 0) - c.owed;
  }
  return out;
}

export function seatWind(state: TableState, player: PlayerId): string {
  const i = state.seats.indexOf(player);
  if (i < 0) return '';
  return WINDS[(i - state.dealerSeat + 4) % 4];
}

export function roundInfo(state: TableState) {
  return {
    roundWind: WINDS[Math.floor(state.dealerTurns / 4) % 4],
    /** 打緊快圈 */
    quick: (state.extraRounds ?? 0) > 0,
    /** 下一個快圈叫咩（快東、快南…） */
    nextQuick: `快${WINDS[Math.floor(state.dealerTurns / 4) % 4]}`,
    dealer: state.seats[state.dealerSeat],
    streak: state.streak,
    dealerFan: 2 * state.streak + 1,
    hand: state.hand + 1,
  };
}

/** 已找數總和 + 水 = 0（未找嘅籌碼唔計） */
export function isBalanced(state: TableState): boolean {
  const sum = Object.values(state.settled).reduce((a, b) => a + b, 0) + state.water;
  return Math.abs(sum) < 1e-9;
}
