// 資料庫規則測試（CI 用 Firestore 模擬器跑）：邊個可以入數、擲骰、換人、標記已轉
// 跑法：npx firebase-tools emulators:exec --only firestore "node --test scripts/rules.test.mjs"
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env;
const G = 'g1';
const S = 's1';
const T = 'groups/g1/sessions/s1/tables';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'jeukbou-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', G), { name: '測試圈', ownerId: 'owner', inviteCode: 'abc' });
    for (const u of ['owner', 'host', 'a', 'b', 'c', 'd', 'e', 'f']) await setDoc(doc(db, 'groups', G, 'members', u), { name: u });
    await setDoc(doc(db, 'groups', G, 'sessions', S), { name: '今晚', createdBy: 'host', closed: { at: 1 } });
    // 新枱：a b c d 坐緊
    await setDoc(doc(db, T, 't1'), { name: '第 1 枱', order: 0, seats: ['a', 'b', 'c', 'd'], names: { a: 'A', b: 'B', c: 'C', d: 'D' }, liveUsers: ['a', 'b', 'c', 'd'] });
    // 全部訪客嘅枱
    await setDoc(doc(db, T, 't2'), { name: '第 2 枱', order: 1, seats: ['guest-1', 'guest-2', 'guest-3', 'guest-4'], names: { 'guest-1': 'G1', 'guest-2': 'G2', 'guest-3': 'G3', 'guest-4': 'G4' }, liveUsers: [] });
    // 舊枱：冇 liveUsers
    await setDoc(doc(db, T, 't3'), { name: '第 3 枱', order: 2, seats: ['e', 'b', 'c', 'd'], names: { e: 'E', b: 'B', c: 'C', d: 'D' } });
    // 換人邀請：e 入 t1 換走 d
    await setDoc(doc(db, 'groups', G, 'sessions', S, 'requests', 'r1'), { tableId: 't1', out: 'd', in: 'e', inName: 'E', by: 'a', status: 'pending' });
  });
});

const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@test.dev`, email_verified: true }).firestore();
const admin = () => env.authenticatedContext('boss', { email: '__SUPER_ADMIN_EMAIL__', email_verified: true }).firestore();
const ev = (uid, seq, event, extra = {}) => ({ seq, by: uid, event, at: 1, ...extra });
const win = { type: 'win', loser: 'b', winners: [{ player: 'a', fan: 8 }] };

test('坐喺度嘅人入到數', async () => {
  await assertSucceeds(setDoc(doc(as('a'), T, 't1', 'events', '000001'), ev('a', 1, win)));
});

test('唔喺枱嘅成員、場主、局主都入唔到數', async () => {
  await assertFails(setDoc(doc(as('e'), T, 't1', 'events', '000001'), ev('e', 1, win)));
  await assertFails(setDoc(doc(as('host'), T, 't1', 'events', '000001'), ev('host', 1, win)));
  await assertFails(setDoc(doc(as('owner'), T, 't1', 'events', '000001'), ev('owner', 1, win)));
});

test('超級管理員入到數', async () => {
  await assertSucceeds(setDoc(doc(admin(), T, 't1', 'events', '000001'), ev('boss', 1, win)));
});

test('成枱訪客：場主、局主幫手入數；其他人唔得', async () => {
  const w = { type: 'win', loser: 'guest-2', winners: [{ player: 'guest-1', fan: 8 }] };
  await assertSucceeds(setDoc(doc(as('host'), T, 't2', 'events', '000001'), ev('host', 1, w)));
  await assertSucceeds(setDoc(doc(as('owner'), T, 't2', 'events', '000002'), ev('owner', 2, w)));
  await assertFails(setDoc(doc(as('a'), T, 't2', 'events', '000003'), ev('a', 3, w)));
});

test('完場：任何成員都得（埋數）', async () => {
  await assertSucceeds(setDoc(doc(as('e'), T, 't1', 'events', '000001'), ev('e', 1, { type: 'end' })));
});

test('擲骰：淨係坐喺度嘅人', async () => {
  await assertSucceeds(updateDoc(doc(as('a'), T, 't1'), { dice: { values: [1, 2, 3], by: 'a', at: 1, n: 1 } }));
  await assertFails(updateDoc(doc(as('e'), T, 't1'), { dice: { values: [1, 2, 3], by: 'e', at: 1, n: 1 } }));
  await assertFails(updateDoc(doc(as('host'), T, 't1'), { dice: { values: [1, 2, 3], by: 'host', at: 1, n: 1 } }));
});

test('唔喺枱嘅人唔可以自己加入 liveUsers', async () => {
  await assertFails(updateDoc(doc(as('e'), T, 't1'), { liveUsers: ['a', 'b', 'c', 'd', 'e'] }));
  await assertFails(updateDoc(doc(as('e'), T, 't1'), { 'names.e': 'E' }));
});

test('接受換人邀請：有請求先得', async () => {
  const swap = { type: 'swap', out: 'd', in: 'e' };
  await assertFails(setDoc(doc(as('e'), T, 't1', 'events', '000001'), ev('e', 1, swap)));
  await assertSucceeds(setDoc(doc(as('e'), T, 't1', 'events', '000001'), ev('e', 1, swap, { req: 'r1' })));
  await assertSucceeds(updateDoc(doc(as('e'), T, 't1'), { 'names.e': 'E', liveUsers: ['a', 'b', 'c', 'e'], lastReq: 'r1' }));
  // 請求唔係俾自己
  await assertFails(setDoc(doc(as('f'), T, 't1', 'events', '000002'), ev('f', 2, { type: 'swap', out: 'c', in: 'f' }, { req: 'r1' })));
});

test('由隔籬枱對調訪客：要坐喺隔籬枱', async () => {
  const swap = { type: 'swap', out: 'guest-1', in: 'a' };
  await assertSucceeds(setDoc(doc(as('a'), T, 't2', 'events', '000001'), ev('a', 1, swap, { pair: 't1' })));
  await assertSucceeds(updateDoc(doc(as('a'), T, 't2'), { 'names.a': 'A', liveUsers: ['a'], lastPair: 't1' }));
  await assertFails(setDoc(doc(as('e'), T, 't2', 'events', '000002'), ev('e', 2, { type: 'swap', out: 'guest-2', in: 'e' }, { pair: 't1' })));
});

test('舊枱（冇 liveUsers）：坐過嘅人入到數，可以補 liveUsers', async () => {
  await assertSucceeds(setDoc(doc(as('e'), T, 't3', 'events', '000001'), ev('e', 1, { type: 'draw' })));
  await assertFails(setDoc(doc(as('a'), T, 't3', 'events', '000002'), ev('a', 2, { type: 'draw' })));
  await assertFails(updateDoc(doc(as('a'), T, 't3'), { liveUsers: ['a', 'b', 'c', 'd'] }));
  await assertSucceeds(updateDoc(doc(as('e'), T, 't3'), { liveUsers: ['e', 'b', 'c', 'd'] }));
});

test('已轉：俾錢、收錢嘅人改到自己份；第三者唔得；場主、局主改得', async () => {
  const s = (uid) => doc(as(uid), 'groups', G, 'sessions', S);
  await assertSucceeds(updateDoc(s('a'), { 'paid.a>b': { by: 'a', at: 1 }, lastPaid: 'a>b' }));
  await assertSucceeds(updateDoc(s('b'), { 'paid.a>b': deleteField(), lastPaid: 'a>b' }));
  await assertSucceeds(updateDoc(s('c'), { 'paid.c + d>a': { by: 'c', at: 1 }, lastPaid: 'c + d>a' }));
  await assertFails(updateDoc(s('e'), { 'paid.a>b': { by: 'e', at: 1 }, lastPaid: 'a>b' }));
  await assertFails(updateDoc(s('e'), { 'paid.a>b': { by: 'e', at: 1 }, lastPaid: 'e>x' }));
  await assertFails(updateDoc(s('e'), { 'paid.a>b': { by: 'e', at: 1 } }));
  await assertSucceeds(updateDoc(s('host'), { 'paid.a>b': { by: 'host', at: 1 }, lastPaid: 'a>b' }));
  await assertSucceeds(updateDoc(s('owner'), { 'paid.c>d': { by: 'owner', at: 1 }, lastPaid: 'c>d' }));
});

test('取消約局：開局嗰個仲去就佢取消；佢唔去咗就由最早應「去」嗰個接手', async () => {
  const m = (uid, id) => doc(as(uid), 'groups', G, 'meetups', id);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', G, 'meetups', 'm1'), { by: 'a', going: ['a', 'b', 'c'], maybe: [], no: [] });
    await setDoc(doc(db, 'groups', G, 'meetups', 'm2'), { by: 'a', going: ['b', 'c'], maybe: [], no: ['a'] });
  });
  await assertFails(deleteDoc(m('b', 'm1')));
  await assertSucceeds(deleteDoc(m('a', 'm1')));
  await assertFails(deleteDoc(m('a', 'm2')));
  await assertFails(deleteDoc(m('c', 'm2')));
  await assertSucceeds(deleteDoc(m('b', 'm2')));
});

test('直播室：每 2 秒最多一句（要同時寫 chatLast）；場主、局主先禁言得；禁咗言講唔到', async () => {
  const say = (uid, text) => {
    const db = as(uid);
    const b = writeBatch(db);
    b.set(doc(collection(db, 'groups', G, 'sessions', S, 'chat')), { by: uid, name: uid, text, at: serverTimestamp() });
    b.set(doc(db, 'groups', G, 'sessions', S, 'chatLast', uid), { at: serverTimestamp() });
    return b.commit();
  };
  await assertSucceeds(say('a', '你好'));
  await assertFails(say('a', '洗版'));
  await assertFails(setDoc(doc(collection(as('c'), 'groups', G, 'sessions', S, 'chat')), { by: 'c', name: 'c', text: '冇 chatLast', at: serverTimestamp() }));
  const sess = (uid) => doc(as(uid), 'groups', G, 'sessions', S);
  await assertFails(updateDoc(sess('a'), { 'chatBlock.b': Date.now() + 86400000 }));
  await assertSucceeds(updateDoc(sess('host'), { 'chatBlock.b': Date.now() + 86400000 }));
  await assertFails(say('b', '我被禁言'));
  await assertSucceeds(updateDoc(sess('owner'), { 'chatBlock.b': deleteField() }));
  await assertSucceeds(say('b', '解禁啦'));
});

test('找數要確認：俾錢嘅人淨係標到「等確認」，收錢嘅人先確認到', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'groups', G), { settle: { confirmPay: true } });
  });
  const s = (uid) => doc(as(uid), 'groups', G, 'sessions', S);
  await assertFails(updateDoc(s('a'), { 'paid.a>b': { by: 'a', at: 1 }, lastPaid: 'a>b' }));
  await assertSucceeds(updateDoc(s('a'), { 'paid.a>b': { by: 'a', at: 1, ok: false }, lastPaid: 'a>b' }));
  await assertSucceeds(updateDoc(s('b'), { 'paid.a>b': { by: 'b', at: 2 }, lastPaid: 'a>b' }));
  await assertSucceeds(updateDoc(s('c'), { 'paid.d>c': { by: 'c', at: 3 }, lastPaid: 'd>c' }));
  await assertSucceeds(updateDoc(s('host'), { 'paid.a>d': { by: 'host', at: 4 }, lastPaid: 'a>d' }));
});

test('風格：人人讀到開放設定；淨係超級管理員改設定同開豪華風格；用家唔可以自己開', async () => {
  const { getDoc } = await import('firebase/firestore');
  await assertSucceeds(setDoc(doc(admin(), 'config', 'skins'), { modes: { neon: 'open' } }, { merge: true }));
  await assertSucceeds(getDoc(doc(as('a'), 'config', 'skins')));
  await assertFails(setDoc(doc(as('a'), 'config', 'skins'), { modes: { jade: 'open' } }, { merge: true }));
  await assertFails(setDoc(doc(as('a'), 'skinGrants', 'a'), { skins: ['jade'] }));
  await assertSucceeds(setDoc(doc(admin(), 'skinGrants', 'a'), { skins: ['jade'] }));
  await assertSucceeds(getDoc(doc(as('a'), 'skinGrants', 'a')));
  await assertFails(getDoc(doc(as('b'), 'skinGrants', 'a')));
  await assertFails(updateDoc(doc(as('a'), 'skinGrants', 'a'), { skins: ['jade', 'palace'] }));
});
