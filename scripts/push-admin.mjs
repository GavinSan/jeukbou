// 部署完發一個測試通知俾超級管理員（GitHub Actions 手動跑 Deploy 揀 test_push 先會用）
// 用部署嗰個服務帳戶（GOOGLE_APPLICATION_CREDENTIALS），由 SUPER_ADMIN_EMAIL 搵返佢嘅推播 token
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('functions/package.json'));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const email = process.env.SUPER_ADMIN_EMAIL || '';
if (!email) { console.log('::warning title=test push::未設定 SUPER_ADMIN_EMAIL'); process.exit(0); }
initializeApp({ projectId: 'jeukbou-app' });
const user = await getAuth().getUserByEmail(email);
const snap = await getFirestore().collection(`users/${user.uid}/pushTokens`).get();
const tokens = snap.docs.map((d) => String(d.get('token') ?? '')).filter(Boolean);
if (!tokens.length) { console.log('::warning title=test push::超級管理員未有開咗通知嘅機（手機「設定 → 通知」開咗先）'); process.exit(0); }
const res = await getMessaging().sendEachForMulticast({
  tokens,
  data: { title: '測試通知 🀄', body: '新版本已經上線，收到即係手機推播用得！', url: '/settings', tag: 'test' },
  webpush: { headers: { Urgency: 'high', TTL: '3600' } },
});
console.log(`::notice title=test push::發咗俾 ${tokens.length} 部機，成功 ${res.successCount}，失敗 ${res.failureCount}`);
for (const r of res.responses) if (!r.success) console.log(`::warning title=test push::${r.error?.code ?? '失敗'}`);
