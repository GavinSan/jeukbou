// 收款方法：唔同地方用唔同嘅轉賬方法。每個方法自己揀顯示定唔顯示俾同圈牌友。
// 香港：轉數快（FPS ID／電話／email＋QR）、PayMe、電話、銀行戶口
// 加拿大：Interac e-Transfer；美國：Zelle、Venmo、Cash App、PayPal、Apple Cash
// 英國：銀行（sort code＋戶口號碼）、Monzo、Revolut；澳洲：PayID、BSB＋戶口、Beem
// 日本：PayPay、銀行振込（LINE Pay 2025 年已經停）；其他：Wise、PayPal、自己寫

export type PayKind =
  | 'fps' | 'payme' | 'hk-phone' | 'hk-bank'
  | 'interac' | 'ws-cash'
  | 'zelle' | 'venmo' | 'cashapp' | 'applecash'
  | 'uk-bank' | 'monzo' | 'revolut'
  | 'payid' | 'au-bank' | 'beem'
  | 'paypay' | 'jp-bank'
  | 'paypal' | 'wise' | 'other';

export interface PayMethod {
  id: string;
  kind: PayKind;
  /** 主要資料：email、電話、ID、戶口號碼… */
  value: string;
  /** 第二欄：戶口名、sort code、BSB、銀行／分行… */
  extra?: string;
  /** QR code 相（data URL，縮細咗） */
  qr?: string;
  /** 顯示俾同圈牌友（唔顯示就淨係自己見到） */
  show: boolean;
}

export type Region = 'HK' | 'CA' | 'US' | 'UK' | 'AU' | 'JP' | 'OTHER';

export const REGIONS: { key: Region; name: string; flag: string; kinds: PayKind[] }[] = [
  { key: 'HK', name: '香港', flag: '🇭🇰', kinds: ['fps', 'payme', 'hk-phone', 'hk-bank'] },
  { key: 'CA', name: '加拿大', flag: '🇨🇦', kinds: ['interac', 'ws-cash', 'paypal'] },
  { key: 'US', name: '美國', flag: '🇺🇸', kinds: ['zelle', 'venmo', 'cashapp', 'applecash', 'paypal'] },
  { key: 'UK', name: '英國', flag: '🇬🇧', kinds: ['uk-bank', 'monzo', 'revolut', 'paypal'] },
  { key: 'AU', name: '澳洲', flag: '🇦🇺', kinds: ['payid', 'au-bank', 'beem', 'paypal'] },
  { key: 'JP', name: '日本', flag: '🇯🇵', kinds: ['paypay', 'jp-bank'] },
  { key: 'OTHER', name: '其他', flag: '🌏', kinds: ['wise', 'paypal', 'other'] },
];

interface KindInfo {
  name: string;
  region: Region;
  /** 主要欄 */
  label: string;
  placeholder: string;
  /** 第二欄（冇就唔顯示） */
  extra?: { label: string; placeholder: string };
  /** 可以上載 QR code */
  qr?: boolean;
  /** 有網址就可以撳去付款 */
  link?: (v: string) => string | null;
  /** 簡單檢查 */
  check?: (v: string) => string | null;
  note?: string;
}

const email = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const phone = (v: string) => /^\+?[\d\s()-]{6,20}$/.test(v.trim());
const handle = (v: string, sym: string) => v.trim().replace(new RegExp(`^\\${sym}`), '');

export const KINDS: Record<PayKind, KindInfo> = {
  fps: {
    name: '轉數快 FPS', region: 'HK', label: 'FPS ID／電話／email', placeholder: '例如 1234567 或 9123 4567', qr: true,
    check: (v) => (/^\d{7}$|^\d{9}$/.test(v.replace(/\s/g, '')) || phone(v) || email(v) ? null : 'FPS ID 係 7 或 9 個數字，或者填電話／email'),
    note: '可以加埋 FPS QR code（喺銀行 app「收款」嗰度截圖）',
  },
  payme: {
    name: 'PayMe', region: 'HK', label: 'PayMe 連結（PayCode）', placeholder: '例如 https://payme.hsbc/yourname', qr: true,
    link: (v) => (/^https?:\/\//.test(v) ? v : /^payme\.hsbc\//.test(v) ? `https://${v}` : null),
    note: '喺 PayMe app → 收款 → 分享連結；或者上載 PayCode',
  },
  'hk-phone': { name: '電話號碼', region: 'HK', label: '電話', placeholder: '例如 9123 4567', check: (v) => (phone(v) ? null : '電話格式唔啱') },
  'hk-bank': { name: '銀行戶口', region: 'HK', label: '戶口號碼', placeholder: '例如 004-123-456789-001', extra: { label: '銀行同戶口名', placeholder: '例如 HSBC・CHAN TAI MAN' } },
  interac: {
    name: 'Interac e-Transfer', region: 'CA', label: 'Email 或者電話', placeholder: 'you@example.com',
    check: (v) => (email(v) || phone(v) ? null : '要填 email 或者電話'),
  },
  'ws-cash': { name: 'Wealthsimple Cash', region: 'CA', label: '$handle', placeholder: '$yourname' },
  zelle: { name: 'Zelle', region: 'US', label: 'Email 或者電話', placeholder: 'you@example.com', check: (v) => (email(v) || phone(v) ? null : '要填 email 或者電話') },
  venmo: { name: 'Venmo', region: 'US', label: '@username', placeholder: '@yourname', link: (v) => `https://venmo.com/u/${handle(v, '@')}` },
  cashapp: { name: 'Cash App', region: 'US', label: '$Cashtag', placeholder: '$yourname', link: (v) => `https://cash.app/$${handle(v, '$')}` },
  applecash: { name: 'Apple Cash', region: 'US', label: '電話或者 email', placeholder: '+1 555 123 4567' },
  'uk-bank': {
    name: 'Bank transfer', region: 'UK', label: 'Account number', placeholder: '12345678', extra: { label: 'Sort code・戶口名', placeholder: '12-34-56・TAI MAN CHAN' },
    check: (v) => (/^\d{8}$/.test(v.replace(/\s/g, '')) ? null : 'Account number 係 8 個數字'),
  },
  monzo: { name: 'Monzo', region: 'UK', label: 'monzo.me 名', placeholder: 'yourname', link: (v) => `https://monzo.me/${v.trim().replace(/^https?:\/\/monzo\.me\//, '')}` },
  revolut: { name: 'Revolut', region: 'UK', label: '@Revtag', placeholder: '@yourname', link: (v) => `https://revolut.me/${handle(v, '@')}` },
  payid: { name: 'PayID', region: 'AU', label: '電話／email／ABN', placeholder: '0412 345 678' },
  'au-bank': { name: 'BSB＋戶口', region: 'AU', label: 'Account number', placeholder: '12345678', extra: { label: 'BSB・戶口名', placeholder: '062-000・TAI MAN CHAN' } },
  beem: { name: 'Beem', region: 'AU', label: '@Beem tag', placeholder: '@yourname' },
  paypay: { name: 'PayPay', region: 'JP', label: 'PayPay ID 或者電話', placeholder: 'your_paypay_id', qr: true, note: '可以上載「マイコード」QR' },
  'jp-bank': { name: '銀行振込', region: 'JP', label: '口座番号（7 桁）', placeholder: '1234567', extra: { label: '銀行・支店・種別・名義（カナ）', placeholder: '三菱UFJ・新宿支店・普通・ヤマダ タロウ' } },
  paypal: { name: 'PayPal', region: 'OTHER', label: 'paypal.me 名 或者 email', placeholder: 'yourname', link: (v) => (email(v) ? null : `https://paypal.me/${v.trim().replace(/^https?:\/\/(www\.)?paypal\.me\//, '')}`) },
  wise: { name: 'Wise', region: 'OTHER', label: '@Wisetag 或者 email', placeholder: '@yourname' },
  other: { name: '其他', region: 'OTHER', label: '寫低點俾錢你', placeholder: '例如：現金、Alipay HK…' },
};

export const MAX_METHODS = 12;

/** 一個方法嘅一句（例如提示用） */
export const payLine = (m: PayMethod) => `${KINDS[m.kind]?.name ?? '收款'}：${m.value}`;

/** 舊資料：淨係有 Interac email */
export function methodsOf(list: PayMethod[] | undefined, legacyEmail?: string): PayMethod[] {
  if (list && list.length) return list;
  return legacyEmail ? [{ id: 'legacy', kind: 'interac', value: legacyEmail, show: true }] : [];
}

/** 由 Firestore 讀返嚟（唔信任格式） */
export function parsePayMethods(raw: unknown): PayMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const kind = String(o.kind ?? '') as PayKind;
    if (!(kind in KINDS)) return [];
    return [{
      id: String(o.id ?? Math.random().toString(36).slice(2, 8)), kind, value: String(o.value ?? '').slice(0, 200),
      extra: o.extra ? String(o.extra).slice(0, 200) : undefined, qr: typeof o.qr === 'string' && o.qr.startsWith('data:image/') ? o.qr : undefined,
      show: o.show !== false,
    }];
  }).slice(0, MAX_METHODS);
}

/** 由時區估地區（唔使問位置權限） */
export function regionOfTz(tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''): Region {
  if (/Hong_Kong|Macau/.test(tz)) return 'HK';
  if (/Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal/.test(tz)) return 'CA';
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise)|Honolulu/.test(tz)) return 'US';
  if (/London|Belfast/.test(tz)) return 'UK';
  if (/^Australia\//.test(tz)) return 'AU';
  if (/Tokyo/.test(tz)) return 'JP';
  return 'OTHER';
}

/** 地區 → 貨幣（開「顯示貨幣」時預設用） */
export const REGION_CURRENCY: Record<Region, string> = { HK: 'HKD', CA: 'CAD', US: 'USD', UK: 'GBP', AU: 'AUD', JP: 'JPY', OTHER: 'HKD' };
export const currencyOfRegion = (r?: string | null) => REGION_CURRENCY[(r as Region) in REGION_CURRENCY ? (r as Region) : regionOfTz()];
