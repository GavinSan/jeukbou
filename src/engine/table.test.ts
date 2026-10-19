// 用 Gavin 畀嘅例子做測試（2026-10-16 對話）。單位：番。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRules } from './rules.ts';
import type { Rules } from './rules.ts';
import { applyEvent, createTable, isBalanced, pending, replay, roundInfo, seatWind } from './table.ts';
import type { TableEvent, TableState } from './table.ts';
import { chipsFor } from './chips.ts';

const SEATS = ['Gavin', 'Athena', 'Ivan', 'Viola'];
// 淨係睇拉 / 劈：熄莊番同抽水，等數字同例子一樣
const PURE: Rules = withRules({ dealer: { enabled: false }, water: { enabled: false }, rounds: 0 });

const eat = (w: string, fan: number, loser: string): TableEvent => ({ type: 'win', winners: [{ player: w, fan }], loser });
const selfDraw = (w: string, fan: number): TableEvent => ({ type: 'win', winners: [{ player: w, fan }], loser: null });
const chain = (s: TableState, a: string, b: string) => s.chains.find((c) => c.puller === a && c.pulled === b);

test('連食三鋪 20：未找 20 → 50 → 95，第 3 拉可以找數', () => {
  // 底 5 + 15 番 = 20
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), eat('Gavin', 15, 'Ivan'), eat('Gavin', 15, 'Ivan')], PURE);
  assert.deepEqual(r.steps.map((s) => s.lines[0].amount), [20, 30, 45]);
  assert.deepEqual(r.steps.map((s) => chain(s.state, 'Gavin', 'Ivan')?.owed), [20, 50, 95]);
  assert.equal(r.steps[1].prompts.length, 0);
  assert.deepEqual(r.steps[2].prompts, [{ type: 'maySettle', puller: 'Gavin', pulled: 'Ivan', owed: 95, count: 3 }]);
  assert.equal(r.state.settled.Ivan, 0, '未找數唔入已找');
});

test('Gavin 例子：連續俾人食 10、20、30 → 未找 10、35、83（52.5 進位 53 + 30），第 3 拉問找唔找', () => {
  const noBase = withRules({ base: 0, dealer: { enabled: false }, water: { enabled: false }, rounds: 0 });
  const r = replay(SEATS, [eat('Gavin', 10, 'Ivan'), eat('Gavin', 20, 'Ivan'), eat('Gavin', 30, 'Ivan')], noBase);
  assert.deepEqual(r.steps.map((s) => chain(s.state, 'Gavin', 'Ivan')?.owed), [10, 35, 83]);
  assert.equal(r.steps[2].prompts.length, 1);
  assert.equal(r.steps[2].prompts[0].owed, 83);
  // 揀四捨五入都係 83；保留小數就係 82.5
  const half = replay(SEATS, [eat('Gavin', 10, 'Ivan'), eat('Gavin', 20, 'Ivan'), eat('Gavin', 30, 'Ivan')],
    withRules({ base: 0, dealer: { enabled: false }, water: { enabled: false }, rounds: 0, rounding: 'none' }));
  assert.equal(chain(half.state, 'Gavin', 'Ivan')?.owed, 82.5);
});

test('第 1 題：20 之後再食 30，今鋪俾 40（30 + 20 ÷ 2）', () => {
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), eat('Gavin', 25, 'Ivan')], PURE);
  assert.equal(r.steps[1].lines[0].amount, 40);
  assert.equal(chain(r.state, 'Gavin', 'Ivan')?.owed, 60);
});

test('劈：Ivan 未找 100，食返 Gavin 10，只找 50，然後反拉 Gavin 10', () => {
  // 兩鋪 40：40 → 40 × 1.5 + 40 = 100
  const r = replay(SEATS, [eat('Gavin', 35, 'Ivan'), eat('Gavin', 35, 'Ivan'), eat('Ivan', 5, 'Gavin')], PURE);
  const last = r.steps[2];
  assert.equal(r.steps[1].state.chains[0].owed, 100);
  assert.deepEqual(last.lines.filter((l) => l.kind === 'settle').map((l) => [l.from, l.to, l.amount]), [['Ivan', 'Gavin', 50]]);
  assert.equal(r.state.settled.Gavin, 50);
  assert.equal(r.state.settled.Ivan, -50);
  assert.equal(chain(r.state, 'Gavin', 'Ivan'), undefined);
  assert.deepEqual(chain(r.state, 'Ivan', 'Gavin'), { puller: 'Ivan', pulled: 'Gavin', owed: 10, count: 1 });
});

test('劈完反拉當普通拉：Ivan 再食 Gavin 就 新鋪 + 未找 ÷ 2', () => {
  const r = replay(SEATS, [eat('Gavin', 35, 'Ivan'), eat('Gavin', 35, 'Ivan'), eat('Ivan', 5, 'Gavin'), eat('Ivan', 5, 'Gavin')], PURE);
  assert.deepEqual(chain(r.state, 'Ivan', 'Gavin'), { puller: 'Ivan', pulled: 'Gavin', owed: 25, count: 2 });
});

test('Gavin 拉緊 Ivan 時食 Viola：唔斷，同時拉兩家', () => {
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), eat('Gavin', 15, 'Viola')], PURE);
  assert.deepEqual(chain(r.state, 'Gavin', 'Ivan'), { puller: 'Gavin', pulled: 'Ivan', owed: 20, count: 1 });
  assert.deepEqual(chain(r.state, 'Gavin', 'Viola'), { puller: 'Gavin', pulled: 'Viola', owed: 20, count: 1 });
  assert.equal(r.state.settled.Gavin, 0);
});

test('第三個人食：斷拉，Ivan 即刻找晒', () => {
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), eat('Athena', 15, 'Viola')], PURE);
  assert.equal(chain(r.state, 'Gavin', 'Ivan'), undefined);
  assert.equal(r.state.settled.Gavin, 20);
  assert.equal(r.state.settled.Ivan, -20);
  assert.equal(chain(r.state, 'Athena', 'Viola')?.owed, 20);
});

test('被拉嘅人食第三個：Gavin 唔係食家，都係斷拉', () => {
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), eat('Ivan', 15, 'Viola')], PURE);
  assert.equal(r.state.settled.Ivan, -20);
  assert.equal(chain(r.state, 'Ivan', 'Viola')?.owed, 20);
});

test('自摸拉三家；其中一家食返自摸嗰個：佢劈自己嗰條，其餘兩條斷拉找晒', () => {
  const r = replay(SEATS, [selfDraw('Gavin', 15), eat('Athena', 5, 'Gavin')], PURE);
  assert.equal(r.steps[0].state.chains.length, 3);
  const settles = r.steps[1].lines.filter((l) => l.kind === 'settle').map((l) => [l.from, l.to, l.amount, l.note]);
  assert.deepEqual(settles, [
    ['Athena', 'Gavin', 10, '劈：20 ÷ 2'],
    ['Ivan', 'Gavin', 20, '斷拉，全數找'],
    ['Viola', 'Gavin', 20, '斷拉，全數找'],
  ]);
  assert.deepEqual(r.state.chains, [{ puller: 'Athena', pulled: 'Gavin', owed: 10, count: 1 }]);
});

test('抽水喺真正收錢嗰陣計：自摸三家各 20，一齊找 60 抽 2', () => {
  const rules = withRules({ dealer: { enabled: false }, rounds: 0 });
  // Athena 食 Viola：Gavin 唔係食家，三條拉一齊斷
  const r = replay(SEATS, [selfDraw('Gavin', 15), eat('Athena', 15, 'Viola')], rules);
  assert.equal(r.steps[0].state.water, 0, '擺低籌碼未抽');
  const w = r.steps[1].lines.find((l) => l.kind === 'water');
  assert.deepEqual(w, { kind: 'water', from: 'Gavin', to: null, amount: 2, note: '60 抽 2' });
  assert.equal(r.state.settled.Gavin, 58);
  assert.equal(r.state.water, 2);
  assert.ok(isBalanced(r.state));
});

test('抽水揀食糊嗰陣計：自摸 3 × 20 即刻抽 2', () => {
  const rules = withRules({ dealer: { enabled: false }, water: { timing: 'win' }, rounds: 0 });
  const r = replay(SEATS, [selfDraw('Gavin', 15)], rules);
  assert.equal(r.state.water, 2);
  assert.equal(r.state.settled.Gavin, -2);
  assert.ok(isBalanced(r.state));
});

test('輸家喺第 3 拉找數，之後由第 1 拉重新計；第 2 拉唔准找', () => {
  const three = [eat('Gavin', 15, 'Ivan'), eat('Gavin', 15, 'Ivan'), eat('Gavin', 15, 'Ivan')];
  assert.throws(() => replay(SEATS, [...three.slice(0, 2), { type: 'settle', puller: 'Gavin', pulled: 'Ivan' }], PURE), /第 2 拉不能找數/);
  const r = replay(SEATS, [...three, { type: 'settle', puller: 'Gavin', pulled: 'Ivan' }, eat('Gavin', 15, 'Ivan')], PURE);
  assert.equal(r.steps[3].state.settled.Gavin, 95);
  assert.deepEqual(chain(r.state, 'Gavin', 'Ivan'), { puller: 'Gavin', pulled: 'Ivan', owed: 20, count: 1 });
});

test('唔找就等第 6 拉', () => {
  const six = Array.from({ length: 6 }, () => eat('Gavin', 15, 'Ivan'));
  const r = replay(SEATS, six, PURE);
  assert.deepEqual(r.steps.map((s) => s.prompts.length), [0, 0, 1, 0, 0, 1]);
});

test('莊：莊食出加 2n+1，冧莊；閒自摸淨係莊俾多', () => {
  const rules = withRules({ water: { enabled: false }, rounds: 0 });
  const r = replay(SEATS, [eat('Gavin', 10, 'Ivan'), eat('Gavin', 10, 'Ivan'), selfDraw('Athena', 10)], rules);
  assert.equal(r.steps[0].lines[0].amount, 16, '10 + 底 5 + 莊 1');
  assert.equal(r.steps[1].lines[0].amount, 26, '10 + 5 + 莊 3 + 拉 8');
  assert.equal(r.steps[1].state.streak, 2);
  const pend = r.steps[2].lines.filter((l) => l.kind === 'pending').map((l) => [l.from, l.amount]);
  assert.deepEqual(pend, [['Gavin', 20], ['Ivan', 15], ['Viola', 15]], 'Gavin 連 2 俾多 5');
  assert.equal(roundInfo(r.state).dealer, 'Athena', '閒家食就過莊');
  assert.equal(r.state.streak, 0);
  assert.equal(r.state.settled.Ivan, -42, 'Gavin 唔係食家，斷拉找晒 16 + 26');
});

test('閒食莊：莊要俾返莊番', () => {
  const rules = withRules({ water: { enabled: false }, rounds: 0 });
  const r = replay(SEATS, [eat('Ivan', 10, 'Gavin')], rules);
  assert.equal(r.steps[0].lines[0].amount, 16);
});

test('流局冧莊、連莊加 1，拉住嘅數留低；可以改做過莊', () => {
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), { type: 'draw' }], withRules({ water: { enabled: false }, rounds: 0 }));
  assert.equal(roundInfo(r.state).dealer, 'Gavin');
  assert.equal(r.state.streak, 2);
  assert.equal(r.state.chains.length, 1);
  const r2 = replay(SEATS, [{ type: 'draw' }], withRules({ dealer: { drawKeepsDealer: false }, rounds: 0 }));
  assert.equal(roundInfo(r2.state).dealer, 'Athena');
});

test('雙響每人加 5，兩家同時拉住出銃嗰個', () => {
  const r = replay(SEATS, [{ type: 'win', winners: [{ player: 'Gavin', fan: 10 }, { player: 'Athena', fan: 10 }], loser: 'Ivan' }], PURE);
  assert.deepEqual(r.state.chains.map((c) => [c.puller, c.pulled, c.owed]), [['Gavin', 'Ivan', 20], ['Athena', 'Ivan', 20]]);
});

test('反雙響：響完出銃嗰個自摸，有份食佢嘅加 10，冇份嘅唔使；同時劈兩條', () => {
  const double: TableEvent = { type: 'win', winners: [{ player: 'Gavin', fan: 10 }, { player: 'Athena', fan: 10 }], loser: 'Ivan' };
  const r = replay(SEATS, [double, selfDraw('Ivan', 10)], PURE);
  const pend = r.steps[1].lines.filter((l) => l.kind === 'pending').map((l) => [l.from, l.amount]);
  assert.deepEqual(pend, [['Gavin', 25], ['Athena', 25], ['Viola', 15]]);
  const settles = r.steps[1].lines.filter((l) => l.kind === 'settle').map((l) => [l.from, l.to, l.amount]);
  assert.deepEqual(settles, [['Ivan', 'Gavin', 10], ['Ivan', 'Athena', 10]]);

  const off = replay(SEATS, [double, selfDraw('Ivan', 10)], withRules({ dealer: { enabled: false }, water: { enabled: false }, reverse: { enabled: false }, rounds: 0 }));
  assert.equal(off.steps[1].lines.find((l) => l.kind === 'pending' && l.from === 'Gavin')?.amount, 15);
});

test('反三響加 20', () => {
  const triple: TableEvent = { type: 'win', winners: [{ player: 'Gavin', fan: 10 }, { player: 'Athena', fan: 10 }, { player: 'Viola', fan: 10 }], loser: 'Ivan' };
  const r = replay(SEATS, [triple, selfDraw('Ivan', 10)], PURE);
  assert.equal(r.steps[0].state.chains[0].owed, 25, '三響每人加 10');
  assert.ok(r.steps[1].lines.filter((l) => l.kind === 'pending').every((l) => l.amount === 35));
});

test('特別事項即時找，唔影響拉，唔抽水', () => {
  const rules = withRules({ dealer: { enabled: false }, rounds: 0 });
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), { type: 'special', player: 'Ivan', label: '暗槓', amount: 5, direction: 'collect' }], rules);
  assert.equal(r.state.settled.Ivan, 15);
  assert.equal(r.state.water, 0);
  assert.equal(chain(r.state, 'Gavin', 'Ivan')?.owed, 20);
});

test('詐糊俾每家 60', () => {
  const r = replay(SEATS, [{ type: 'falseWin', player: 'Athena' }], PURE);
  assert.equal(r.state.settled.Athena, -180);
  assert.equal(r.state.settled.Gavin, 60);
});

test('換位（預設）：淨係換位嗰個人有份嘅拉即時找數，其他人照拉', () => {
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), eat('Gavin', 15, 'Viola'), { type: 'swap', out: 'Viola', in: 'AF' }], PURE);
  assert.equal(r.state.settled.Viola, -20);
  assert.equal(r.state.settled.Gavin, 20);
  assert.deepEqual(r.state.chains, [{ puller: 'Gavin', pulled: 'Ivan', owed: 20, count: 1 }]);
  assert.deepEqual(r.state.seats, ['Gavin', 'Athena', 'Ivan', 'AF']);
  assert.equal(r.state.settled.AF, 0);
});

test('換位（成張枱找數）：所有拉即時找數', () => {
  const rules = withRules({ dealer: { enabled: false }, water: { enabled: false }, rounds: 0, swapSettle: 'table' });
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), { type: 'swap', out: 'Viola', in: 'AF' }], rules);
  assert.equal(r.state.settled.Ivan, -20);
  assert.equal(r.state.chains.length, 0);
});

test('撤回換位：拎走嗰項，籌碼同位置返晒嚟', () => {
  const before = [eat('Gavin', 15, 'Viola')];
  const withSwap = replay(SEATS, [...before, { type: 'swap', out: 'Viola', in: 'AF' }], PURE).state;
  assert.equal(withSwap.chains.length, 0);
  const undone = replay(SEATS, before, PURE).state;
  assert.deepEqual(undone.chains, [{ puller: 'Gavin', pulled: 'Viola', owed: 20, count: 1 }]);
  assert.deepEqual(undone.seats, SEATS);
  assert.equal(undone.settled.Viola, 0);
});

test('完場：所有拉找晒，之後唔可以再記', () => {
  const r = replay(SEATS, [selfDraw('Gavin', 15), { type: 'end' }], PURE);
  assert.equal(r.state.settled.Gavin, 60);
  assert.ok(r.state.ended);
  assert.throws(() => applyEvent(r.state, eat('Gavin', 1, 'Ivan'), PURE), /完場/);
});

test('打夠 4 圈自動完場', () => {
  const rules = withRules({ water: { enabled: false } });
  let s = createTable(SEATS);
  for (let i = 0; i < 16; i++) {
    const dealer = roundInfo(s).dealer;
    const winner = SEATS[(SEATS.indexOf(dealer) + 1) % 4];
    const loser = SEATS[(SEATS.indexOf(dealer) + 2) % 4];
    s = applyEvent(s, eat(winner, 5, loser), rules).state;
  }
  assert.ok(s.ended);
  assert.equal(s.chains.length, 0);
});

test('風位：莊係東，逆時針南西北', () => {
  const s = createTable(SEATS);
  assert.deepEqual(SEATS.map((p) => seatWind(s, p)), ['東', '南', '西', '北']);
  const s2 = applyEvent(s, eat('Athena', 5, 'Ivan'), PURE).state;
  assert.deepEqual(SEATS.map((p) => seatWind(s2, p)), ['北', '東', '南', '西']);
});

test('小數：未找 25 ÷ 2 → 進位 13、保留 12.5', () => {
  const ceil = replay(SEATS, [eat('Gavin', 20, 'Ivan'), eat('Gavin', 20, 'Ivan')], PURE);
  assert.equal(ceil.steps[1].lines[0].amount, 38);
  const none = replay(SEATS, [eat('Gavin', 20, 'Ivan'), eat('Gavin', 20, 'Ivan')], withRules({ dealer: { enabled: false }, water: { enabled: false }, rounding: 'none', rounds: 0 }));
  assert.equal(none.steps[1].lines[0].amount, 37.5);
});

test('熄咗拉：食糊即刻找數', () => {
  const r = replay(SEATS, [eat('Gavin', 15, 'Ivan'), eat('Gavin', 15, 'Ivan')], withRules({ la: { enabled: false }, dealer: { enabled: false }, water: { enabled: false }, rounds: 0 }));
  assert.equal(r.state.settled.Gavin, 40);
  assert.equal(r.state.chains.length, 0);
});

test('亂數 2000 鋪：已找 + 水 永遠 = 0；完場後冇未找數', () => {
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let game = 0; game < 40; game++) {
    let s = createTable(SEATS);
    const rules = withRules({ rounds: 0, water: { timing: game % 2 ? 'win' : 'settle' } });
    for (let i = 0; i < 50; i++) {
      const kind = rand(10);
      let ev: TableEvent;
      const a = SEATS[rand(4)];
      const others = SEATS.filter((p) => p !== a);
      if (kind < 5) ev = eat(a, rand(40), others[rand(3)]);
      else if (kind < 7) ev = selfDraw(a, rand(40));
      else if (kind === 7) ev = { type: 'win', winners: [{ player: others[0], fan: rand(30) }, { player: others[1], fan: rand(30) }], loser: a };
      else if (kind === 8) ev = { type: 'special', player: a, label: '花', amount: 5, direction: 'collect' };
      else ev = { type: 'draw' };
      const r = applyEvent(s, ev, rules);
      s = r.state;
      for (const p of r.prompts) {
        if (rand(2)) s = applyEvent(s, { type: 'settle', puller: p.puller, pulled: p.pulled }, rules).state;
      }
      assert.ok(isBalanced(s));
    }
    s = applyEvent(s, { type: 'end' }, rules).state;
    assert.ok(isBalanced(s));
    assert.ok(Object.values(pending(s)).every((v) => v === 0));
  }
});

test('籌碼：60 = 深藍 50 + 淺藍 10；95 = 50 + 25 + 10 + 10', () => {
  assert.deepEqual(chipsFor(60).map((c) => [c.value, c.count]), [[50, 1], [10, 1]]);
  assert.deepEqual(chipsFor(95).map((c) => [c.value, c.count]), [[50, 1], [25, 1], [10, 2]]);
  assert.equal(chipsFor(999).reduce((a, c) => a + c.count, 0), 5, '位置有限，最多 5 隻');
});

test('單數劈：未找 21，Ivan 食返 Gavin → 只俾 10，自己留 11；Gavin 再拉就 21 + 11 + 新鋪', () => {
  // 底 5 + 16 番 = 21
  const split = replay(SEATS, [eat('Gavin', 16, 'Ivan'), eat('Ivan', 5, 'Gavin')], PURE);
  assert.deepEqual(split.steps[1].lines.filter((l) => l.kind === 'settle').map((l) => [l.from, l.to, l.amount]), [['Ivan', 'Gavin', 10]]);
  const pull = replay(SEATS, [eat('Gavin', 16, 'Ivan'), eat('Gavin', 5, 'Ivan')], PURE);
  // 21 + 11（21 ÷ 2 向上）+ 新鋪 10
  assert.equal(chain(pull.state, 'Gavin', 'Ivan')?.owed, 42);
});

test('莊每鋪可以揀：當 1 番、不計', () => {
  const r = withRules({ water: { enabled: false }, rounds: 0, la: { enabled: false } });
  // Gavin 坐莊（第一位）；連莊兩次之後自動會係 5
  const base = replay(SEATS, [eat('Gavin', 10, 'Ivan'), eat('Gavin', 10, 'Ivan'), eat('Gavin', 10, 'Ivan')], r);
  assert.ok(base.steps[2].lines[0].note.includes('莊 5'));
  const one = replay(SEATS, [eat('Gavin', 10, 'Ivan'), eat('Gavin', 10, 'Ivan'), { type: 'win', winners: [{ player: 'Gavin', fan: 10 }], loser: 'Ivan', dealer: 'one' }], r);
  assert.ok(one.steps[2].lines[0].note.includes('莊 1'));
  assert.equal(one.steps[2].lines[0].amount, base.steps[2].lines[0].amount - 4);
  const none = replay(SEATS, [eat('Gavin', 10, 'Ivan'), { type: 'win', winners: [{ player: 'Gavin', fan: 10 }], loser: 'Ivan', dealer: 'none' }], r);
  assert.ok(!none.steps[1].lines[0].note.includes('莊'));
  // 不計莊都照樣連莊
  assert.equal(none.state.streak, 2);
});
