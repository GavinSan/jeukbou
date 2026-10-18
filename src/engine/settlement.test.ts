import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATER, applyExpenses, mergePairs, minimalTransfers, sessionTotals, settleSession, toMoney } from './settlement.ts';
import { replay } from './table.ts';
import { withRules } from './rules.ts';

// 9月19日 嘅真實結果（Google Sheet）
const SEP19: Record<string, number> = { Tat: -80, Robin: -190, Athena: 97, Gavin: -67, Janice: -100, Ivan: -15, Viola: 296, AF: -65, [WATER]: 124 };

const sum = (o: Record<string, number>) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 100);

test('9月19日：6 番 = CAD $1，同 Sheet 一樣', () => {
  const cad = toMoney(SEP19, 6);
  assert.equal(cad.Viola, 49.33);
  assert.equal(cad.Robin, -31.67);
  assert.equal(cad[WATER], 20.67);
  assert.equal(sum(cad), 0);
});

test('最少轉賬：每個人收 / 俾啱數，總數清晒', () => {
  const cad = toMoney(SEP19, 6);
  const tr = minimalTransfers(cad);
  const net: Record<string, number> = {};
  for (const t of tr) {
    net[t.from] = (net[t.from] ?? 0) - Math.round(t.amount * 100);
    net[t.to] = (net[t.to] ?? 0) + Math.round(t.amount * 100);
  }
  for (const [k, v] of Object.entries(cad)) assert.equal(net[k] ?? 0, Math.round(v * 100), k);
  assert.ok(tr.length <= Object.keys(cad).length - 1);
  assert.deepEqual(tr[0], { from: 'Robin', to: 'Viola', amount: 31.67 });
});

test('港紙：1 番 = HK$1', () => {
  assert.equal(toMoney({ A: 25, B: -25 }, 1).A, 25);
});

test('一 pair 一齊計：Robin + Tat 合埋', () => {
  const m = mergePairs({ Robin: -84.63, Tat: -44.13, Gavin: 128.76 }, [['Robin', 'Tat']]);
  assert.deepEqual(m, { 'Robin + Tat': -128.76, Gavin: 128.76 });
  assert.throws(() => mergePairs({}, [['A', 'B'], ['B', 'C']]), /已經喺第二個 pair/);
});

test('開支：揀邊個分，晚飯 $58 四個人分，Gavin 俾咗', () => {
  const b = applyExpenses({ Gavin: 0, Athena: 0, Ivan: 0, Viola: 0, Robin: 0 }, [
    { label: '晚飯', payer: 'Gavin', amount: 58, sharedBy: ['Gavin', 'Athena', 'Ivan', 'Viola'] },
  ]);
  assert.deepEqual(b, { Gavin: 43.5, Athena: -14.5, Ivan: -14.5, Viola: -14.5, Robin: 0 });
});

test('開支除唔盡：仙數分到最前嗰幾個', () => {
  const b = applyExpenses({}, [{ label: '蛋糕', payer: WATER, amount: 10, sharedBy: ['A', 'B', 'C'] }]);
  assert.deepEqual(b, { [WATER]: 10, A: -3.34, B: -3.33, C: -3.33 });
});

test('幾張枱加埋，連水', () => {
  const rules = withRules({ dealer: { enabled: false }, rounds: 0 });
  const t1 = replay(['G', 'A', 'I', 'V'], [{ type: 'win', winners: [{ player: 'G', fan: 15 }], loser: null }, { type: 'end' }], rules).state;
  const t2 = replay(['J', 'S', 'C', 'G2'], [{ type: 'falseWin', player: 'C' }, { type: 'end' }], rules).state;
  const tot = sessionTotals([t1, t2]);
  assert.equal(tot.G, 58);
  assert.equal(tot.C, -180);
  assert.equal(tot[WATER], 2);
  assert.equal(sum(tot), 0);
});

test('埋數：番換錢、水俾晚餐、剩水平分、GP 合埋、總數為 0', () => {
  const r = settleSession({
    fan: { A: 60, B: 30, C: -42, D: -50 },
    water: 2,
    perUnit: 6,
    expenses: [
      { label: '晚餐', payer: 'A', amount: 80, sharedBy: ['A', 'B', 'C', 'D'] },
      { label: '汽水（水支付）', payer: 'B', amount: 0.2, sharedBy: [WATER] },
    ],
    waterTo: 'split',
    players: ['A', 'B', 'C', 'D'],
    pairs: [['C', 'D']],
  });
  assert.equal(r.game.A, 10);
  assert.equal(r.game.B, 5);
  assert.equal(r.game.C, -7);
  assert.equal(r.water.collected, 0.33);
  assert.equal(r.water.left, 0.13);
  // A：贏 10，俾咗 80 晚餐，自己分 20，分返水 0.04
  assert.equal(r.net.A, 70.04);
  assert.equal(r.net.B, -14.77);
  const sum = Object.values(r.net).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) < 1e-9, `總數 ${sum}`);
  assert.ok('C + D' in r.accounts);
  const paid = r.transfers.filter((t) => t.from === 'C + D').reduce((a, t) => a + t.amount, 0);
  assert.ok(Math.abs(paid + r.accounts['C + D']) < 1e-9);
});

test('埋數：剩水全部歸一個人；水唔夠就由佢補', () => {
  const r = settleSession({
    fan: { A: 12, B: -12, C: 0, D: 0 },
    water: 6,
    perUnit: 6,
    expenses: [{ label: '場租', payer: 'C', amount: 3, sharedBy: [WATER] }],
    waterTo: 'D',
    players: ['A', 'B', 'C', 'D'],
    pairs: [],
  });
  assert.equal(r.water.left, -2);
  assert.equal(r.waterShare.D, -2);
  assert.equal(r.waterShare.A, 0);
  const sum = Object.values(r.net).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) < 1e-9);
});
