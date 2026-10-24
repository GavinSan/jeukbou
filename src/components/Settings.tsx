// 設定：個人資料（頭像、名）＋ 呢部機嘅偏好（聲、震、通知）＋ 登出
import { useState } from 'react';
import type { ReactNode } from 'react';
import { SKINS, SKIN_TIER, resetSkinAccess, setPref, skinLock, usePrefs, useSkinAccess } from '../lib/prefs.ts';
import type { Prefs, SkinAccess } from '../lib/prefs.ts';
import { buzz } from '../lib/haptics.ts';
import { sfx, unlock } from '../lib/sound.ts';
import { Avatar, NameForm, Sheet, message, useConfirm } from '../ui.tsx';
import { askNotify, notifySupported } from '../lib/notify.ts';
import { pushConfigured, registerPush, unregisterPush } from '../lib/push.ts';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase.ts';
import { displayName, sendFeedback, setAvatar, setPayEmail, setProfileDetails, syncMemberName } from '../lib/data.ts';
import { shrinkImage } from '../lib/scan.ts';
import { clearSnapCache, useProfile } from '../lib/live.ts';
import { toAvatar } from '../lib/avatar.ts';

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);

const ROWS: { key: Exclude<keyof Prefs, 'skin'>; label: string; note: string }[] = [
  { key: 'hints', label: '提示文字', note: '預設閂（簡潔）；開咗就每頁都顯示說明' },
  { key: 'sound', label: '聲效', note: '食糊、找數、擲骰' },
  {
    key: 'vibe',
    label: '震動',
    note: canVibrate ? '同枱有人食糊或找數時震動' : isIOS ? 'iPhone 網頁版只有輕震；App 版會完整支援' : '此瀏覽器不支援震動',
  },
  {
    key: 'notify',
    label: '通知',
    note: notifySupported() ? (pushConfigured() ? '約局、三缺一、番數表更新、加入申請；app 閂咗都收到' : '牌友圈番數表有更新時通知你') : isIOS ? 'iPhone 要先在 Safari「加入主畫面」，再從主畫面開啟' : '此瀏覽器不支援通知',
  },
];

/** 頭像（撳就換相）＋名 */
export function ProfileHead({ name, email, photo, busy, onPick, right }: {
  name: string; email: string | null; photo: string | null; busy: boolean; onPick: (f: File | undefined) => void; right?: ReactNode;
}) {
  return (
    <div className="row">
      <label className={`avatar-edit${busy ? ' busy' : ''}`} title="更換頭像">
        <Avatar name={name} photo={photo} size="lg" />
        <span className="avatar-cam" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        </span>
        <input type="file" accept="image/*" className="visually-hidden" aria-label="更換頭像" disabled={busy} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <div className="grow">
        <h2>{name}</h2>
        {email && <p className="muted small">{email}</p>}
      </div>
      {right}
    </div>
  );
}

/** 個人資料：換頭像、移除頭像、改名（會同步去所有牌友圈） */
export function ProfileEditor() {
  const user = auth?.currentUser ?? null;
  const profile = useProfile(user?.uid ?? null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);
  const [confirmUI, ask] = useConfirm();
  if (!user) return null;
  const groups = profile.data.groups;
  const photo = profile.data.avatar ?? user.photoURL;
  const name = displayName(user);

  async function task(t: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await t(); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }

  return (
    <div className="stack profile-edit">
      <ProfileHead
        name={name}
        email={user.email}
        photo={photo}
        busy={busy}
        onPick={(f) => { if (f) task(async () => setAvatar(user, await toAvatar(f), groups)); }}
        right={!editing && <button type="button" className="btn plain small-btn" onClick={() => setEditing(true)}>改雀壇名</button>}
      />
      {editing && (
        <NameForm
          user={user}
          initial={name}
          onDone={() => {
            setEditing(false);
            setTick((t) => t + 1);
            window.dispatchEvent(new Event('jeukbou-nav'));
            syncMemberName(user, groups, photo).catch(() => undefined);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {!editing && (
        <div className="row tight-row">
          <span className="muted small grow">撳頭像換相</span>
          {profile.data.avatar && <button type="button" className="textbtn" disabled={busy} onClick={() => ask({ title: '移除頭像', detail: '會改返用名嘅第一個字做頭像。', action: '移除', run: () => task(() => setAvatar(user, null, groups)) })}>移除頭像</button>}
        </div>
      )}
      <PayEmailField key={profile.data.payEmail} initial={profile.data.payEmail} onSave={(v) => task(() => setPayEmail(user, v, groups))} busy={busy} />
      <DetailsFields
        key={`${profile.data.firstName}|${profile.data.lastName}|${profile.data.birthday}`}
        first={profile.data.firstName}
        last={profile.data.lastName}
        birthday={profile.data.birthday}
        busy={busy}
        onSave={(d) => task(() => setProfileDetails(user, d, groups))}
      />
      {error && <p className="error" role="alert">{error}</p>}
      {confirmUI}
    </div>
  );
}

/** 資料（名、生日）：名淨係超級管理員見到；生日（唔使年份）同圈牌友見到 */
function DetailsFields({ first, last, birthday, busy, onSave }: {
  first: string; last: string; birthday: string; busy: boolean; onSave: (d: { firstName: string; lastName: string; birthday: string }) => void;
}) {
  const [f, setF] = useState(first);
  const [l, setL] = useState(last);
  const [m, setM] = useState(birthday ? Number(birthday.slice(0, 2)) : 0);
  const [d, setD] = useState(birthday ? Number(birthday.slice(3, 5)) : 0);
  const maxDay = m ? new Date(2024, m, 0).getDate() : 31;
  const bday = m && d ? `${String(m).padStart(2, '0')}-${String(Math.min(d, maxDay)).padStart(2, '0')}` : '';
  const changed = f.trim() !== first || l.trim() !== last || bday !== birthday;
  return (
    <div className="field details-fields">
      <span>資料<small className="muted">　名淨係超級管理員見到；生日（唔使年份）同圈牌友見到，會幫你慶祝</small></span>
      <div className="row">
        <input className="input grow" value={f} onChange={(e) => setF(e.target.value.slice(0, 30))} placeholder="名（First name）" aria-label="名" autoComplete="given-name" />
        <input className="input grow" value={l} onChange={(e) => setL(e.target.value.slice(0, 30))} placeholder="姓（Last name）" aria-label="姓" autoComplete="family-name" />
      </div>
      <div className="row">
        <select className="input grow" value={m} onChange={(e) => setM(Number(e.target.value))} aria-label="生日月份">
          <option value={0}>生日月份</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 月</option>)}
        </select>
        <select className="input grow" value={d} onChange={(e) => setD(Number(e.target.value))} aria-label="生日日子">
          <option value={0}>日子</option>
          {Array.from({ length: maxDay }, (_, i) => <option key={i} value={i + 1}>{i + 1} 日</option>)}
        </select>
      </div>
      {changed && <button type="button" className="btn small-btn" disabled={busy} onClick={() => onSave({ firstName: f, lastName: l, birthday: bday })}>儲存</button>}
    </div>
  );
}

/** 收錢 email：同圈嘅人找數時會見到 */
function PayEmailField({ initial, onSave, busy }: { initial: string; onSave: (v: string) => void; busy: boolean }) {
  const [v, setV] = useState(initial);
  const changed = v.trim() !== initial;
  const ok = !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  return (
    <label className="field">
      <span>收款 Interac e-Transfer email</span>
      <div className="row">
        <input className="input grow" type="email" inputMode="email" autoComplete="email" value={v} onChange={(e) => setV(e.target.value)} placeholder="例如 you@example.com" />
        {changed && <button type="button" className="btn small-btn" disabled={busy || !ok} onClick={() => onSave(v)}>儲存</button>}
      </div>
      <small className="muted">{ok ? '同牌友圈嘅人找數時會見到，方便轉賬。' : 'Email 格式唔啱'}</small>
    </label>
  );
}

/** 介面風格：十八款，每款自己定光暗。基本款跟段位解鎖；豪華款要超級管理員開通（未開通都睇得到，但用唔到） */
export function SkinPicker({ access: forced }: { access?: SkinAccess }) {
  const p = usePrefs();
  const live = useSkinAccess();
  const access = forced ?? live;
  const [note, setNote] = useState('');
  const [showLocked, setShowLocked] = useState(false);
  const tierName = access.tier >= 0 ? TIER_NAMES[access.tier] : '';
  const open = SKINS.filter((k) => !skinLock(k.key, access));
  const locked = SKINS.filter((k) => skinLock(k.key, access));
  const cur = SKINS.find((k) => k.key === p.skin);
  const card = (k: (typeof SKINS)[number]) => {
    const lock = skinLock(k.key, access);
    const on = p.skin === k.key && !lock;
    return (
      <button
        key={k.key}
        type="button"
        role="radio"
        aria-checked={on}
        aria-disabled={!!lock}
        className={`skin-card${on ? ' on' : ''}${lock ? ' locked' : ''}${k.premium ? ` premium skin-${k.key}` : ''}`}
        onClick={() => {
          if (lock) { setNote(`${k.name}：${lock}${tierName && SKIN_TIER[k.key] ? `（你而家係「${tierName}」）` : ''}`); buzz('tap'); return; }
          setNote(''); setPref('skin', k.key); sfx.tap();
        }}
      >
        {on && <span className="skin-on-badge" aria-hidden="true">✓ 用緊</span>}
        <span className="skin-sw" aria-hidden="true">{k.colors.map((c) => <i key={c} style={{ background: c }} />)}</span>
        <b>{k.name}{k.premium && <span className="skin-crown" title="豪華風格">👑</span>}{lock && <span className="skin-lock" aria-label="未解鎖">🔒</span>}</b>
        <small>{lock ?? k.note}</small>
      </button>
    );
  };
  return (
    <>
      {cur && <p className="skin-current">而家用緊：<b>{cur.name}</b><span className="muted">　{cur.note}</span></p>}
      <div className="skin-pick" role="radiogroup" aria-label="介面風格">{open.map(card)}</div>
      {locked.length > 0 && (
        <>
          <button type="button" className="skin-more" aria-expanded={showLocked} onClick={() => setShowLocked((v) => !v)}>
            <span className="grow">未解鎖 <b>{locked.length}</b> 款</span>
            <svg className={`chev-svg${showLocked ? ' up' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showLocked && <div className="skin-pick" role="group" aria-label="未解鎖風格">{locked.map(card)}</div>}
        </>
      )}
      {note && <p className="skin-note" role="status">{note}</p>}
    </>
  );
}

const TIER_NAMES = ['雀蛋', '雀仔', '雀友', '雀士', '雀豪', '雀霸', '雀王', '雀聖', '雀神', '雀仙'];

/** 呢部機嘅偏好 */
export function PrefsList() {
  const p = usePrefs();
  const [note, setNote] = useState('');
  return (
    <>
      <div className="list flat">
        {ROWS.map((r) => (
          <div key={r.key} className="rule-row">
            <span className="grow">{r.label}<small>{r.note}</small></span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={p[r.key]}
              aria-label={r.label}
              onClick={async () => {
                unlock();
                const on = !p[r.key];
                if (r.key === 'notify' && on) {
                  const res = await askNotify();
                  if (res !== 'granted') {
                    setNote(res === 'denied' ? '通知已被封鎖，請到手機或瀏覽器設定允許「雀簿」通知。' : '此裝置不支援通知。');
                    return;
                  }
                  setNote('');
                  const uid = auth?.currentUser?.uid;
                  if (uid) registerPush(uid, true).catch(() => setNote('推播登記唔到，app 開住時仍然會通知你。'));
                }
                if (r.key === 'notify' && !on) unregisterPush().catch(() => undefined);
                setPref(r.key, on);
                if (on && r.key === 'sound') setTimeout(() => sfx.tap(), 30);
                if (on && r.key === 'vibe') buzz('tap');
              }}
            />
          </div>
        ))}
      </div>
      {note && <p className="error small">{note}</p>}
      <p className="muted small">聲效、震動同通知只儲存在這部裝置。</p>
    </>
  );
}

/** 登出：放喺最底、細字，撳咗要再確認，免得唔小心撳到 */
export function SignOutButton({ onDone }: { onDone?: () => void }) {
  const [confirmUI, ask] = useConfirm();
  if (!auth?.currentUser) return null;
  const email = auth.currentUser.email ?? '';
  return (
    <div className="signout">
      <small className="muted">已登入：{email || '呢個帳戶'}</small>
      <button
        type="button"
        className="textbtn loss signout-btn"
        onClick={() => ask({
          title: '確定要登出？',
          detail: `登出之後，呢部機唔會再收到雀簿嘅通知，要用 ${email || '呢個帳戶'} 再登入先用得返。`,
          action: '確定登出',
          run: async () => { onDone?.(); await unregisterPush().catch(() => undefined); clearSnapCache(); resetSkinAccess(); if (auth) await signOut(auth); },
        })}
      >登出</button>
      {confirmUI}
    </div>
  );
}

export default function Settings({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} label="設定">
      <h2>設定</h2>
      <ProfileEditor />
      <h3>風格</h3>
      <SkinPicker />
      <PrefsList />
      <button type="button" className="btn big" onClick={onClose}>完成</button>
      <SignOutButton onDone={onClose} />
    </Sheet>
  );
}

/** 齒輪掣：撳開設定 */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="iconbtn" aria-label="設定" onClick={() => { unlock(); setOpen(true); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
      {open && <Settings onClose={() => setOpen(false)} />}
    </>
  );
}

/** 問題回報同建議：寫低邊度有問題，可以附一張截圖（縮細咗先送）；淨係超級管理員睇到 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="listrow list feedback-row" onClick={() => setOpen(true)}>
        <span className="feedback-icon" aria-hidden="true">🐞</span>
        <span className="grow">問題回報同建議<small className="muted" style={{ display: 'block' }}>撞到 bug、想要新功能，寫低再附張截圖</small></span>
        <span className="chev" aria-hidden="true">›</span>
      </button>
      {open && <FeedbackSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const user = auth?.currentUser ?? null;
  const [kind, setKind] = useState<'bug' | 'idea'>('bug');
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  if (!user) return null;
  async function pick(f: File | undefined) {
    if (!f) return;
    setError('');
    try { setImage(`data:image/jpeg;base64,${await shrinkImage(f, 960)}`); } catch (err) { setError(message(err)); }
  }
  async function send() {
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await sendFeedback(user, { text, image: image || undefined, kind, page: location.pathname });
      setDone(true);
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet onClose={onClose} label="問題回報同建議">
      <h2>問題回報同建議</h2>
      {done ? (
        <>
          <p>收到，多謝你！🙏 我哋會盡快睇。</p>
          <button type="button" className="btn" onClick={onClose}>好</button>
        </>
      ) : (
        <>
          <div className="seg wide" role="group" aria-label="類別">
            <button type="button" aria-pressed={kind === 'bug'} onClick={() => setKind('bug')}>🐞 有問題</button>
            <button type="button" aria-pressed={kind === 'idea'} onClick={() => setKind('idea')}>💡 建議</button>
          </div>
          <label className="field">
            <span>{kind === 'bug' ? '邊度有問題？做緊咩嘅時候出現？' : '想加咩、改咩？'}</span>
            <textarea className="input" rows={5} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={kind === 'bug' ? '例如：喺枱度撳「流局」之後，個數冇變' : '例如：想 Live 顯示埋…'} />
          </label>
          <div className="field">
            <span>截圖（可以唔附）</span>
            {image ? (
              <div className="feedback-shot">
                <img src={image} alt="附上嘅截圖" />
                <button type="button" className="textbtn" onClick={() => setImage('')}>移除</button>
              </div>
            ) : (
              <label className="btn plain small-btn feedback-pick">
                📷 揀相
                <input type="file" accept="image/*" className="visually-hidden" aria-label="揀截圖" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
              </label>
            )}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="button" className="btn" disabled={busy || !text.trim()} onClick={send}>{busy ? '送緊…' : '送出'}</button>
          <small className="muted">只有超級管理員會睇到；會一齊記低你用緊邊一頁同部機嘅型號，方便搵問題。</small>
        </>
      )}
    </Sheet>
  );
}
