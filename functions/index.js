// 雀簿推播：資料庫有變（約局、三缺一、夠腳、番數表更新、加入申請），就用 FCM 通知相關嘅人。
// 只送 data（title/body/url/tag），由 app 嘅 service worker 顯示；同一個 tag 會取代舊通知。
// 地區固定多倫多 northamerica-northeast2（同 Firestore 一樣；app 都係 call 呢度）。
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

initializeApp();
const REGION = 'northamerica-northeast2';
setGlobalOptions({ region: REGION, maxInstances: 5, memory: '256MiB' });

const db = getFirestore();
// app 直接 call 嘅 function：明確設定「任何人都 call 得」（入面自己檢查登入同權限），
// 唔靠第一次建立時自動設定，新加嘅 function 先唔會 call 唔到
const CALL = { invoker: 'public' };
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 約局時間，用約嗰個人部機嘅時區 */
function when(at, tz) {
  const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Toronto', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    const h = Number(parts.hour) % 24;
    return `${parts.month}月${parts.day}日（${WEEK[DAYS[parts.weekday] ?? 0]}）${h < 12 ? '上午' : '下午'}${h % 12 || 12}:${parts.minute}`;
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  }
}

async function members(g) {
  const snap = await db.collection(`groups/${g}/members`).get();
  return snap.docs.map((d) => ({ uid: d.id, perms: Array.isArray(d.get('perms')) ? d.get('perms') : [] }));
}

async function groupName(g) {
  const snap = await db.doc(`groups/${g}`).get();
  return { name: String(snap.get('name') ?? '牌友圈'), ownerId: String(snap.get('ownerId') ?? '') };
}

/** 發俾一班人；發唔到（token 過期）就清走。回覆成功送出幾多部機 */
async function send(uids, msg) {
  const ids = [...new Set(uids)].filter(Boolean);
  if (!ids.length) return 0;
  const lists = await Promise.all(ids.map((u) => db.collection(`users/${u}/pushTokens`).get()));
  const tokens = lists.flatMap((s) => s.docs.map((d) => ({ ref: d.ref, token: String(d.get('token') ?? '') }))).filter((t) => t.token);
  if (!tokens.length) return 0;
  let ok = 0;
  const data = { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag };
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await getMessaging().sendEachForMulticast({
      tokens: chunk.map((t) => t.token),
      data,
      webpush: { headers: { Urgency: 'high', TTL: '86400' } },
    });
    await Promise.all(res.responses.map((r, k) => (!r.success && DEAD.has(r.error?.code ?? '') ? chunk[k].ref.delete().catch(() => undefined) : null)));
    logger.info('push sent', { tag: msg.tag, ok: res.successCount, failed: res.failureCount });
    ok += res.successCount;
  }
  return ok;
}

/** 超級管理員：email 同部署時嘅 SUPER_ADMIN_EMAIL 一樣、又驗證咗 */
const isAdmin = (tok) => {
  const admin = process.env.SUPER_ADMIN_EMAIL || '';
  return !!admin && !!tok && tok.email === admin && tok.email_verified === true;
};

const list = (v) => (Array.isArray(v) ? v.map(String) : []);

// 有人約新局：通知全圈（約嗰個除外）
export const meetupCreated = onDocumentCreated('groups/{g}/meetups/{m}', async (event) => {
  const m = event.data?.data();
  if (!m) return;
  const { g, m: id } = event.params;
  const [{ name }, mem] = await Promise.all([groupName(g), members(g)]);
  const by = String(m.by ?? '');
  await send(mem.map((x) => x.uid).filter((u) => u !== by), {
    title: `「${name}」有人約局 🀄`,
    body: `${m.byName || '有人'} 約 ${when(Number(m.at), m.tz)}${m.place ? `・${m.place}` : ''}，一缺三，快啲應！`,
    url: `/g/${g}#meetups`,
    tag: `${g}:meetup:${id}`,
  });
});

// 應約人數變：三缺一 → 催未應嘅人；夠腳 → 話俾去嘅人知
export const meetupUpdated = onDocumentUpdated('groups/{g}/meetups/{m}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const { g, m: id } = event.params;
  const was = list(before.going);
  const now = list(after.going);
  if (now.length === was.length) return;
  if (Number(after.at) < Date.now()) return;
  const { name } = await groupName(g);
  const at = when(Number(after.at), after.tz);
  const tag = `${g}:meetup:${id}`;
  const url = `/g/${g}#meetups`;
  // 三缺一（第一枱或者之後嗰枱都係）：人數增加到 4 嘅倍數差一個
  if (now.length > was.length && now.length % 4 === 3) {
    const answered = new Set([...now, ...list(after.maybe), ...list(after.no)]);
    const mem = await members(g);
    await send(mem.map((x) => x.uid).filter((u) => !answered.has(u)), {
      title: `「${name}」${now.length > 4 ? `第 ${Math.ceil(now.length / 4)} 枱` : ''}三缺一！就差你 🔥`,
      body: `${at}${after.place ? `・${after.place}` : ''}：${now.map((u) => after.names?.[u] ?? '玩家').join('、')} 已經去，仲差一個。`,
      url, tag,
    });
  } else if (now.length % 4 === 0 && now.length > was.length) {
    const joined = new Set(now.filter((u) => !was.includes(u)));
    const tables = now.length / 4;
    await send(now.filter((u) => !joined.has(u)), {
      title: `「${name}」夠腳！${tables > 1 ? `夠 ${tables} 枱 ` : ''}開枱 🀄`,
      body: `${at}${after.place ? `・${after.place}` : ''}，${now.length} 個人去。`,
      url, tag,
    });
  }
});

// 番數表更新：通知全圈（改嗰個除外）
export const fanTableChanged = onDocumentUpdated('groups/{g}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const log = after?.fanTableLog;
  if (!log?.at || log.at === before?.fanTableLog?.at) return;
  const { g } = event.params;
  const changes = list(log.changes);
  const mem = await members(g);
  await send(mem.map((x) => x.uid).filter((u) => u !== log.by), {
    title: `「${after.name ?? '牌友圈'}」番數表已更新`,
    body: `${log.byName || '局主'}：${changes.slice(0, 3).join('、') || '有修改'}${changes.length > 3 ? ` 等 ${changes.length} 項` : ''}`,
    url: `/g/${g}/rules#fans`,
    tag: g,
  });
});

// 有人申請加入：通知局主同有「批准」權限嘅人
export const joinRequested = onDocumentCreated('groups/{g}/joinRequests/{u}', async (event) => {
  const r = event.data?.data();
  if (!r) return;
  const { g } = event.params;
  const [{ name, ownerId }, mem] = await Promise.all([groupName(g), members(g)]);
  await send([ownerId, ...mem.filter((x) => x.perms.includes('approve')).map((x) => x.uid)], {
    title: `「${name}」有人申請加入`,
    body: `${r.name || '有人'} 想加入，撳入去批准。`,
    url: `/g/${g}`,
    tag: `${g}:join`,
  });
});

// ---------- 影相認牌計番（試驗：淨係超級管理員） ----------
// app 傳一張縮細咗嘅相（JPEG base64）同番數表嘅牌型名，Claude 認牌再對番數表計番。
// API key 同超級管理員 email 由部署時寫入 functions/.env（來自 GitHub Secrets），唔會入 repo。
// 每日上限防止用爆 credit。

const SCAN_DAILY_LIMIT = Number(process.env.SCAN_DAILY_LIMIT || 40);

function scanPrompt(items) {
  const list = items.map((x) => `- ${x.name}：${x.value}`).join('\n');
  return `呢張相係港式台灣牌（16 張）嘅食糊手牌。請認出所有牌，再用下面呢份番數表計番。

番數表（牌型：番數；「明:5|暗:15」即係明槓 5、暗槓 15 嗰類選項）：
${list}

規則：
- 牌名用中文：一萬至九萬、一筒至九筒、一索至九索、東南西北、中發白；花牌寫「春夏秋冬」或者「梅蘭菊竹」。
- 淨係用番數表入面有嘅牌型名（一字不改），每個牌型寫用咗邊個選項同幾多番。
- 睇唔清就照講，confidence 寫 low。
- 只回覆一個 JSON，唔好有其他字：
{"tiles":["…"],"flowers":["…"],"exposed":[["…"]],"patterns":[{"name":"…","option":"","fan":0,"why":"…"}],"total":0,"confidence":"high|medium|low","notes":"…"}`;
}

export const scanHand = onCall({ ...CALL, timeoutSeconds: 60, memory: '512MiB', maxInstances: 2 }, async (req) => {
  if (!isAdmin(req.auth?.token)) throw new HttpsError('permission-denied', '影相計番暫時淨係超級管理員用得');
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) throw new HttpsError('failed-precondition', '未設定 ANTHROPIC_API_KEY');
  const image = String(req.data?.image ?? '');
  const media = String(req.data?.mediaType ?? 'image/jpeg');
  if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length > 6_000_000) throw new HttpsError('invalid-argument', '相唔啱');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(media)) throw new HttpsError('invalid-argument', '相格式唔啱');
  const items = Array.isArray(req.data?.items) ? req.data.items.slice(0, 200).map((x) => ({ name: String(x?.name ?? '').slice(0, 40), value: String(x?.value ?? '').slice(0, 60) })).filter((x) => x.name) : [];

  // 每日上限（多倫多日子）
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  const ref = db.doc('admin/scanUsage');
  const used = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = snap.exists && snap.get('day') === day ? Number(snap.get('count') ?? 0) : 0;
    if (n >= SCAN_DAILY_LIMIT) return -1;
    tx.set(ref, { day, count: n + 1, at: FieldValue.serverTimestamp() });
    return n + 1;
  });
  if (used < 0) throw new HttpsError('resource-exhausted', `今日已經用咗 ${SCAN_DAILY_LIMIT} 次，聽日再試`);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: media, data: image } },
        { type: 'text', text: scanPrompt(items) },
      ] }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    logger.error('claude api', { status: res.status, body: t.slice(0, 500) });
    throw new HttpsError('unavailable', `Claude 未能處理（${res.status}）`);
  }
  const out = await res.json();
  const text = (out.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  let parsed = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  if (!parsed) throw new HttpsError('internal', '認唔到，試下影清楚啲');
  logger.info('scan', { used, tokens: out.usage });
  return { ...parsed, used, limit: SCAN_DAILY_LIMIT };
});

// ---------- 測試通知（超級管理員）：發一個通知俾自己所有開咗通知嘅機 ----------
export const testPush = onCall(CALL, async (req) => {
  if (!isAdmin(req.auth?.token)) throw new HttpsError('permission-denied', '淨係超級管理員用得');
  const ok = await send([req.auth.uid], {
    title: '測試通知 🀄',
    body: '收到即係手機推播用得！撳我返 app。',
    url: '/settings',
    tag: 'test',
  });
  if (!ok) throw new HttpsError('failed-precondition', '呢個帳戶未有開咗通知嘅機：喺手機「設定 → 通知」開咗先');
  return { ok };
});

// ---------- 催找數：收錢嗰個（或者超級管理員）撳，通知未轉錢嘅人 ----------
// 每筆轉賬 24 個鐘最多催一次，免得煩
const REMIND_GAP = 24 * 3600000;
const cash = (n) => { const v = Math.round(Number(n) * 100) / 100; return `$${Number.isInteger(v) ? v : v.toFixed(2)}`; };
const isGuestId = (id) => id.startsWith('guest-') || id.startsWith('legacy:');
const NAG = ['仲唔找數？俾人催啦 😤', '找數啦大佬 💸', '有人等緊你啲錢 👀', '數還數，路還路 🀄'];
/** 日／月（多倫多時間） */
const dm = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}`;
};

export const remindPay = onCall(CALL, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '要登入');
  const admin = isAdmin(req.auth.token);
  const items = Array.isArray(req.data?.items) ? req.data.items.slice(0, 40) : [];
  if (!items.length) throw new HttpsError('invalid-argument', '冇揀邊筆');
  const now = Date.now();
  // 每個要俾錢嘅人：欠邊個、邊日、幾多
  const owe = new Map();
  let skipped = 0;
  const groups = new Map();
  for (const it of items) {
    const g = String(it?.g ?? ''); const s = String(it?.s ?? ''); const key = String(it?.key ?? '');
    if (!g || !s || !key || g.includes('/') || s.includes('/')) continue;
    const ref = db.doc(`groups/${g}/sessions/${s}`);
    const snap = await ref.get();
    const po = snap.get('payout');
    const t = (po?.transfers ?? []).find((x) => `${x.from}>${x.to}` === key);
    if (!t) continue;
    if (snap.get('paid')?.[key]) { skipped++; continue; }
    const to = String(t.to).split(' + ');
    if (!admin && !to.includes(uid)) throw new HttpsError('permission-denied', '淨係收錢嗰個先可以催');
    const last = Number(snap.get('reminded')?.[key] ?? 0);
    if (now - last < REMIND_GAP) { skipped++; continue; }
    if (!groups.has(g)) groups.set(g, await groupName(g));
    const names = po.names ?? {};
    const toName = to.map((x) => names[x] ?? '玩家').join(' + ');
    const created = snap.get('createdAt');
    const day = created && typeof created.toDate === 'function' ? dm(created.toDate().getTime()) : String(snap.get('name') ?? '');
    for (const payer of String(t.from).split(' + ').filter((x) => !isGuestId(x))) {
      const r = owe.get(payer) ?? { total: 0, by: new Map(), group: groups.get(g).name };
      r.total += Number(t.amount) || 0;
      const lines = r.by.get(toName) ?? [];
      lines.push(`${day} ${cash(t.amount)}`);
      r.by.set(toName, lines);
      owe.set(payer, r);
    }
    await ref.update({ [`reminded.${key}`]: now });
  }
  let sent = 0;
  for (const [payer, r] of owe) {
    const parts = [...r.by].map(([name, lines]) => `${name} 等緊你（${lines.join('、')}）`);
    sent += await send([payer], {
      title: NAG[Math.floor(Math.random() * NAG.length)],
      body: `「${r.group}」一共 ${cash(r.total)}：${parts.join('；')}`,
      url: '/pay',
      tag: `pay:${payer}`,
    });
  }
  return { people: owe.size, sent, skipped };
});

// ---------- 超級管理員發通知：打字，發俾所有人或者一個牌友圈 ----------
export const adminBroadcast = onCall(CALL, async (req) => {
  if (!isAdmin(req.auth?.token)) throw new HttpsError('permission-denied', '淨係超級管理員用得');
  const title = String(req.data?.title ?? '').trim().slice(0, 60);
  const body = String(req.data?.body ?? '').trim().slice(0, 200);
  const target = String(req.data?.target ?? 'all');
  if (!title) throw new HttpsError('invalid-argument', '要有標題');
  let uids = [];
  let url = '/';
  if (target === 'all') {
    uids = (await db.collection('users').listDocuments()).map((d) => d.id);
  } else {
    if (target.includes('/')) throw new HttpsError('invalid-argument', '牌友圈唔啱');
    uids = (await members(target)).map((m) => m.uid);
    url = `/g/${target}`;
  }
  // 標題前面寫明係管理員發嘅
  const ok = await send(uids, { title: `📢 管理員：${title}`, body, url, tag: `admin:${Date.now()}` });
  logger.info('broadcast', { target, people: uids.length, ok });
  return { people: uids.length, ok };
});

// ---------- 夠拉通知：有人被拉三、六…，跟大局設定通知同枱／成個大局／成個牌友圈 ----------
export const pullAlert = onCall(CALL, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '要登入');
  const g = String(req.data?.g ?? ''); const s = String(req.data?.s ?? ''); const t = String(req.data?.t ?? '');
  if (!g || !s || !t || [g, s, t].some((x) => x.includes('/'))) throw new HttpsError('invalid-argument', '資料唔啱');
  const lines = (Array.isArray(req.data?.lines) ? req.data.lines : []).slice(0, 6).map((x) => String(x).slice(0, 80)).filter(Boolean);
  if (!lines.length) return { ok: 0 };
  const [sess, table] = await Promise.all([db.doc(`groups/${g}/sessions/${s}`).get(), db.doc(`groups/${g}/sessions/${s}/tables/${t}`).get()]);
  if (!sess.exists || !table.exists) throw new HttpsError('not-found', '搵唔到');
  const live = list(table.get('liveUsers'));
  if (!live.includes(uid) && !isAdmin(req.auth.token)) throw new HttpsError('permission-denied', '要坐喺呢張枱');
  const mode = String(sess.get('pullPush') ?? 'off');
  let uids = [];
  if (mode === 'table') uids = live;
  else if (mode === 'session') uids = (await db.collection(`groups/${g}/sessions/${s}/tables`).get()).docs.flatMap((d) => list(d.get('liveUsers')));
  else if (mode === 'group') uids = (await members(g)).map((m) => m.uid);
  else return { ok: 0 };
  const ok = await send(uids.filter((u) => u !== uid), {
    title: `${String(table.get('name') ?? '枱')} 夠拉！找唔找？`,
    body: lines.join('；'),
    url: `/g/${g}/s/${s}/t/${t}`,
    tag: `${g}:${s}:${t}:pull`,
  });
  return { ok };
});

// ---------- 一齊執位：輪到你揀 ----------
export const drawTurn = onCall(CALL, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '要登入');
  const g = String(req.data?.g ?? ''); const s = String(req.data?.s ?? '');
  if (!g || !s || g.includes('/') || s.includes('/')) throw new HttpsError('invalid-argument', '資料唔啱');
  const mem = await db.doc(`groups/${g}/members/${uid}`).get();
  if (!mem.exists && !isAdmin(req.auth.token)) throw new HttpsError('permission-denied', '唔係成員');
  const ref = db.doc(`groups/${g}/sessions/${s}`);
  const next = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).get('draw');
    if (!d || !d.strict || d.status !== 'picking') return null;
    const done = new Set(Object.values(d.picks ?? {}));
    const n = list(d.order).find((id) => !done.has(id));
    if (!n || n.startsWith('guest-') || d.notified === n) return null;
    tx.update(ref, { 'draw.notified': n });
    return n;
  });
  if (!next) return { ok: 0 };
  const { name } = await groupName(g);
  const ok = await send([next], { title: '到你揀位 🀄', body: `「${name}」一齊執位，輪到你揀牌，快啲入嚟揀！`, url: `/g/${g}/s/${s}`, tag: `${g}:${s}:draw` });
  return { ok };
});

// ---------- 約局：問有冇人打（任何成員都撳得；同一個約局 30 分鐘一次） ----------
const PING_GAP = 30 * 60 * 1000;
export const meetupPing = onCall(CALL, async (req) => {
  try {
    return await pingOnce(req);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error('meetupPing failed', err);
    throw new HttpsError('internal', `發唔到通知：${err?.message ?? err}`);
  }
});

async function pingOnce(req) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '要登入');
  const g = String(req.data?.g ?? ''); const id = String(req.data?.m ?? '');
  if (!g || !id || g.includes('/') || id.includes('/')) throw new HttpsError('invalid-argument', '資料唔啱');
  const me = await db.doc(`groups/${g}/members/${uid}`).get();
  if (!me.exists && !isAdmin(req.auth.token)) throw new HttpsError('permission-denied', '唔係成員');
  const ref = db.doc(`groups/${g}/meetups/${id}`);
  const m = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', '約局已經取消咗');
    const d = snap.data();
    if (Number(d.at) < Date.now()) throw new HttpsError('failed-precondition', '約局時間已經過咗');
    const last = Number(d.pingAt ?? 0);
    if (Date.now() - last < PING_GAP) {
      throw new HttpsError('resource-exhausted', `啱啱先問過，${Math.ceil((PING_GAP - (Date.now() - last)) / 60000)} 分鐘後再問`);
    }
    tx.update(ref, { pingAt: Date.now() });
    return d;
  });
  const going = list(m.going);
  const answered = new Set([...going, ...list(m.no), uid]);
  const [{ name }, mem] = await Promise.all([groupName(g), members(g)]);
  const uids = mem.map((x) => x.uid).filter((u) => !answered.has(u));
  const n = going.length;
  const want = Math.max(1, Number(m.tables ?? 1)) * 4;
  const lack = n < want ? want - n : (4 - (n % 4)) % 4;
  const caller = String(m.names?.[uid] ?? req.auth.token.name ?? '有人');
  const ok = await send(uids, {
    title: `「${name}」有冇人打？${lack ? `仲差 ${lack} 個` : '夠腳，仲可以開多枱'} 🀄`,
    body: `${when(Number(m.at), m.tz)}${m.place ? `・${m.place}` : ''}：${n ? `${going.map((u) => m.names?.[u] ?? '玩家').join('、')} 已經去` : '未有人應'}。${caller} 問緊，撳入嚟應去唔去！`,
    url: `/g/${g}#meetups`,
    // 每次問都用新 tag：同一個約局之前嘅通知仲喺度，都會再彈出嚟（唔會靜靜雞取代咗）
    tag: `${g}:meetup:${id}:ping:${Date.now()}`,
  });
  logger.info('meetupPing', { g, id, people: uids.length, ok });
  return { people: uids.length, ok };
}
