// 雀簿推播：資料庫有變（約局、三缺一、夠腳、番數表更新、加入申請），就用 FCM 通知相關嘅人。
// 只送 data（title/body/url/tag），由 app 嘅 service worker 顯示；同一個 tag 會取代舊通知。
// 地區由部署時嘅 functions/.env（PUSH_REGION）決定，要同 Firestore 資料庫一樣。
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

initializeApp();
setGlobalOptions({ region: process.env.PUSH_REGION || 'us-central1', maxInstances: 5, memory: '256MiB' });

const db = getFirestore();
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

/** 發俾一班人；發唔到（token 過期）就清走 */
async function send(uids, msg) {
  const ids = [...new Set(uids)].filter(Boolean);
  if (!ids.length) return;
  const lists = await Promise.all(ids.map((u) => db.collection(`users/${u}/pushTokens`).get()));
  const tokens = lists.flatMap((s) => s.docs.map((d) => ({ ref: d.ref, token: String(d.get('token') ?? '') }))).filter((t) => t.token);
  if (!tokens.length) return;
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
  }
}

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

export const scanHand = onCall({ timeoutSeconds: 60, memory: '512MiB', maxInstances: 2 }, async (req) => {
  const admin = process.env.SUPER_ADMIN_EMAIL || '';
  const tok = req.auth?.token;
  if (!admin || !tok || tok.email !== admin || tok.email_verified !== true) throw new HttpsError('permission-denied', '影相計番暫時淨係超級管理員用得');
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
