import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATER, applyExpenses, effectiveGroups, mergePairs, minimalTransfers, sessionTotals, settleSession, toMoney } from './settlement.ts';
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
  assert.throws(() => mergePairs({}, [['A', 'B'], ['B', 'C']]), /已經喺第二個 Group/);
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

test('埋數：麻雀數向上取整，差額入水戶口；開支分開計', () => {
  const r = settleSession({
    fan: { A: 61, B: 30, C: -43, D: -50 },
    water: 2,
    waterTo: 'H',
    perUnit: 6,
    rounding: 'up',
    expenses: [{ label: '晚餐', payer: 'A', amount: 80, sharedBy: ['A', 'B', 'C', 'D'] }],
    players: ['A', 'B', 'C', 'D'],
    pairs: [['C', 'D']],
  });
  // 61/6 = 10.17 → 11；30/6 = 5；C + D 一齊計：−93/6 = −15.5 → −16（唔係逐個取整 −8 −9 = −17）
  assert.deepEqual(r.game, { A: 11, B: 5, C: -7.17, D: -8.33 });
  assert.equal(r.water.total, 0);
  assert.equal(r.water.to, 'H');
  assert.equal(r.gameLedger.accounts.H, 0);
  assert.equal(r.gameLedger.accounts['C + D'], -16);
  assert.deepEqual(r.expense, { A: 60, B: -20, C: -20, D: -20 });
  assert.equal(r.expenseLedger.accounts['C + D'], -40);
  assert.equal(r.combined.accounts.A, 71);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(r.gameLedger.accounts)) < 1e-9);
  assert.ok(Math.abs(sum(r.combined.accounts)) < 1e-9);
});

test('埋數：唔取整、水歸今晚其中一個玩家', () => {
  const r = settleSession({
    fan: { A: 12, B: -15, C: 0, D: 0 },
    water: 3,
    waterTo: 'C',
    perUnit: 6,
    rounding: 'none',
    expenses: [],
    players: ['A', 'B', 'C', 'D'],
    pairs: [],
  });
  assert.equal(r.game.B, -2.5);
  assert.equal(r.gameLedger.accounts.C, 0.5);
  assert.deepEqual(r.gameLedger.transfers.map((t) => [t.from, t.to, t.amount]), [['B', 'A', 2], ['B', 'C', 0.5]]);
});

test('埋數：四捨五入', () => {
  const r = settleSession({
    fan: { A: 63, B: -21, C: -42, D: 0 }, water: 0, waterTo: 'A', perUnit: 6, rounding: 'round', expenses: [], players: ['A', 'B', 'C', 'D'], pairs: [],
  });
  // 10.5 → 11；−3.5 → −4；−7 → −7；水戶口（A）吸收 0
  assert.deepEqual(r.game, { A: 11, B: -4, C: -7, D: 0 });
  assert.equal(r.water.total, 0);
  assert.equal(r.gameLedger.accounts.A, 11);
});

test('埋數：開支都跟取整，差額入保管水嗰個', () => {
  const r = settleSession({
    fan: { A: 0, B: 0, C: 0 }, water: 0, waterTo: 'A', perUnit: 6, rounding: 'up',
    expenses: [{ label: '晚餐', payer: 'A', amount: 100, sharedBy: ['A', 'B', 'C'] }], players: ['A', 'B', 'C'], pairs: [],
  });
  // B、C 各 −33.33 → −34；A +66.67 → +67，差額 −1 計返 A → 68
  assert.equal(r.expense.B, -34);
  assert.equal(r.expense.C, -34);
  assert.equal(r.expense.A, 68);
});

test('Group：三個人一齊計', () => {
  const m = mergePairs({ A: 10, B: -4, C: -1, D: -5 }, [['A', 'B', 'C']]);
  assert.deepEqual(m, { 'A + B + C': 5, D: -5 });
});

test('預設 Group：今晚冇嚟嘅人唔計，得返一個就唔合，唔會炒', () => {
  // 預設 A+B、C+D+E；今晚 B、E 冇嚟
  const g = effectiveGroups([['A', 'B'], ['C', 'D', 'E']], [], ['A', 'C', 'D', 'F']);
  assert.deepEqual(g, [['C', 'D']]);
  const r = settleSession({
    fan: { A: 12, C: -6, D: -12, F: 6 }, water: 0, waterTo: 'A', perUnit: 6, rounding: 'none', expenses: [], players: ['A', 'C', 'D', 'F'], pairs: g,
  });
  assert.equal(r.gameLedger.accounts['C + D'], -3);
  assert.equal(r.gameLedger.accounts.A, 2);
  // 全部人都冇嚟：冇 Group
  assert.deepEqual(effectiveGroups([['X', 'Y']], [], ['A', 'B']), []);
});

test('預設 Group 同今晚臨時 Group 撞人：預設優先，唔會報錯', () => {
  const g = effectiveGroups([['A', 'B']], [['B', 'C'], ['C', 'D']], ['A', 'B', 'C', 'D']);
  assert.deepEqual(g, [['A', 'B'], ['C', 'D']]);
  assert.doesNotThrow(() => settleSession({
    fan: { A: 6, B: -6, C: 6, D: -6 }, water: 0, waterTo: 'A', perUnit: 6, rounding: 'none', expenses: [], players: ['A', 'B', 'C', 'D'], pairs: g,
  }));
});

test('Group 先合埋番數先取整，開支都係；總數保持 0', () => {
  const r = settleSession({
    fan: { A: 45, B: -8, C: 20, D: -57 }, water: 0, waterTo: 'C', perUnit: 6, rounding: 'up',
    expenses: [{ label: '晚餐', payer: 'C', amount: 100, sharedBy: ['A', 'B', 'C', 'D'] }], players: ['A', 'B', 'C', 'D'], pairs: [['A', 'B']],
  });
  // A + B：37/6 = 6.17 → 7（逐個取整會係 8 − 2 = 6）
  assert.equal(r.gameLedger.accounts['A + B'], 7);
  // 開支：A + B 各 −25 → −50
  assert.equal(r.expenseLedger.accounts['A + B'], -50);
  const sum = (o: Record<string, number>) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 100);
  assert.equal(sum(r.gameLedger.accounts), 0);
  assert.equal(sum(r.expenseLedger.accounts), 0);
  assert.equal(sum(r.combined.accounts), 0);
});
