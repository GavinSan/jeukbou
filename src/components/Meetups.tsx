// 約局：約將來嘅日子同時間；大家應「去／唔去」，人數用鬼馬講法（三缺一、二缺二…）；可以發通知問有冇人打
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Meetup } from '../lib/data.ts';
import { meetupHost, meetupMood } from '../lib/data.ts';
import { Sheet, message, useConfirm } from '../ui.tsx';
import { Link } from '../lib/router.tsx';
import { useGroup, useMeetups } from '../lib/live.ts';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export const meetupWhen = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString('zh-HK', { hour: 'numeric', minute: '2-digit' });
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）${time}`;
};

export function MeetupCard({ m, me, onRsvp, onDelete, canDelete, onPing, onEdit, startHref }: {
  m: Meetup; me: string; canDelete: boolean;
  /** 開枱：用應咗「去」嘅人直接開大局（座位已經填好，可以再改） */
  startHref?: string;
  onRsvp: (status: 'going' | 'no') => Promise<void>; onDelete: () => Promise<void>;
  /** 開約局嗰個：改日子時間、地點、枱數、備註 */
  onEdit?: (patch: MeetupInput) => Promise<void>;
  /** 發通知問未應嘅人；回覆一句結果 */
  onPing?: () => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmUI, ask] = useConfirm();
  const mine = m.going.includes(me) ? 'going' : m.no.includes(me) ? 'no' : null;
  const n = m.going.length;
  const want = Math.max(1, m.tables ?? 1);
  // 位：最少顯示想開嘅枱數，人多過咗就加多枱（照樣可以加入）
  const slots = Math.max(want, Math.ceil((n + 1) / 4)) * 4;
  const soon = m.at - Date.now() < 86400000;
  const act = async (t: () => Promise<void>) => { setBusy(true); setError(''); setNote(''); try { await t(); } catch (err) { setError(message(err)); } finally { setBusy(false); } };
  const lack = n < want * 4 ? want * 4 - n : (4 - (n % 4)) % 4;
  const nm = (id: string) => (id === me ? '你' : m.names[id] ?? '玩家');
  const host = meetupHost(m);
  return (
    <div className={`meetup${n % 4 === 3 ? ' need-one' : n >= want * 4 ? ' full' : ''}`}>
      <div className="meetup-top">
        <span className="meetup-when"><b>{meetupWhen(m.at)}</b>{soon && <span className="tag new">就嚟</span>}{want > 1 && <span className="tag instant">想開 {want} 枱</span>}</span>
        <span className="meetup-acts">
          {onEdit && <button type="button" className="textbtn small" onClick={() => setEditing(true)}>改</button>}
        </span>
      </div>
      {(m.place || m.note) && <p className="meetup-note">{[m.place && `📍 ${m.place}`, m.note].filter(Boolean).join('　')}</p>}
      <div className="meetup-mood"><b className="num">{n}</b><span>{meetupMood(n, want)}</span></div>
      <div className="meetup-seats" aria-hidden="true">
        {Array.from({ length: slots }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}
      </div>
      {n > 0 && <p className="small muted">去：{m.going.map(nm).join('、')}{m.no.length ? `｜唔去：${m.no.map(nm).join('、')}` : ''}</p>}
      <div className="seg wide" role="radiogroup" aria-label="去唔去">
        {([['going', '去'], ['no', '唔去']] as const).map(([k, t]) => (
          <button key={k} type="button" role="radio" aria-checked={mine === k} aria-pressed={mine === k} disabled={busy} onClick={() => { if (mine !== k) act(() => onRsvp(k)); }}>{t}</button>
        ))}
      </div>
      {onPing && (
        <button type="button" className="btn plain meetup-ping" disabled={busy} onClick={() => act(async () => setNote(await onPing()))}>
          📣 問有冇人打{lack ? `（仲差 ${lack} 個）` : ''}
        </button>
      )}
      {note && <p className="small gain">{note}</p>}
      {startHref && (mine === 'going' || canDelete) && n > 0 && (
        <Link to={startHref} className="btn meetup-start" ariaLabel="用約局嘅人開枱">🀄 開枱{n >= 4 ? `（${Math.floor(n / 4)} 張）` : ''}<small>{n >= 4 ? '已經填好座位' : `得 ${n} 個，其他位可以揀人或者加訪客`}</small></Link>
      )}
      <div className="meetup-foot">
        <small className="muted grow"><span className="meetup-host">局主：{nm(host)}</span>{host !== m.by && `（${m.byName || '開局嗰個'} 唔去咗，由${host === me ? '你' : '佢'}接手）`}</small>
        {/* 取消約局：開局嗰個喺「改」入面；局主、管理員就喺呢度（遠離「改」，唔會撳錯；撳咗仲會問多次） */}
        {canDelete && !onEdit && <button type="button" className="textbtn loss small" onClick={() => ask({ title: '取消約局', detail: `${meetupWhen(m.at)} 嘅約局會刪除，所有人嘅應約都會冇咗。`, action: '取消約局', run: onDelete })}>取消約局</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {confirmUI}
      {editing && onEdit && <MeetupSheet initial={m} onSave={onEdit} onClose={() => setEditing(false)} onDelete={canDelete ? onDelete : undefined} />}
    </div>
  );
}

export type MeetupInput = { at: number; place: string; note: string; tables: number };
const MAX_TABLES = 10;

/** 約局表格：開新約局，或者（傳 initial）改返自己開嘅約局 */
export function MeetupSheet({ onSave, onClose, existing = [], initial, onDelete }: { onSave: (m: MeetupInput) => Promise<void>; onClose: () => void; existing?: Meetup[]; initial?: Meetup; onDelete?: () => Promise<void> }) {
  const [confirmUI, ask] = useConfirm();
  const pad = (x: number) => String(x).padStart(2, '0');
  const start = initial ? new Date(initial.at) : (() => { const d = new Date(Date.now() + 86400000); d.setHours(20, 0, 0, 0); return d; })();
  const [date, setDate] = useState(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
  const [time, setTime] = useState(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
  const [place, setPlace] = useState(initial?.place ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [tables, setTables] = useState(Math.max(1, initial?.tables ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const at = new Date(`${date}T${time}`).getTime();
  const ok = Number.isFinite(at) && at > Date.now() - 3600000;
  // 同一個時段已經有人約：建議直接加入嗰個（夠腳都可以加，會開多枱）
  const clash = ok && !initial ? existing.find((x) => Math.abs(x.at - at) < 2 * 3600000) : undefined;
  return (
    <Sheet onClose={onClose} label="約局">
      <h2>{initial ? '改約局' : '約局'}</h2>
      <div className="meet-when">
        <label className="field"><span>日子</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>時間</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      <label className="field"><span>地點</span><input className="input" value={place} onChange={(e) => setPlace(e.target.value.slice(0, 60))} placeholder="例如 Gavin 屋企" /></label>
      <div className="field">
        <span>想開幾多枱</span>
        <div className="meet-tables">
          <button type="button" className="btn plain" aria-label="少一枱" disabled={tables <= 1} onClick={() => setTables((t) => Math.max(1, t - 1))}>−</button>
          <b className="num" aria-live="polite">{tables} 枱</b>
          <button type="button" className="btn plain" aria-label="多一枱" disabled={tables >= MAX_TABLES} onClick={() => setTables((t) => Math.min(MAX_TABLES, t + 1))}>＋</button>
        </div>
        <small className="muted">人多過咗都照樣加入得，夠人就開多枱。</small>
      </div>
      {clash && <p className="banner calm small">{meetupWhen(clash.at)} 已經有 {clash.byName || '人'} 約咗（{clash.going.length} 人去）。可以返去直接撳「去」加入，人多會開多枱。</p>}
      <label className="field"><span>備註</span><input className="input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="例如 打 8 圈、食完飯先" /></label>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn big" disabled={busy || !ok} onClick={async () => {
        setBusy(true); setError('');
        try { await onSave({ at, place, note, tables }); onClose(); } catch (err) { setError(message(err)); setBusy(false); }
      }}>{!ok ? '揀返將來嘅時間' : initial ? `改做 ${meetupWhen(at)}` : `約 ${meetupWhen(at)}`}</button>
      {initial && onDelete && (
        <button type="button" className="textbtn loss center-text meet-del" onClick={() => ask({ title: '取消約局', detail: `${meetupWhen(initial.at)} 嘅約局會刪除，所有人嘅應約都會冇咗。`, action: '取消約局', run: async () => { await onDelete(); onClose(); } })}>取消呢個約局</button>
      )}
      {confirmUI}
    </Sheet>
  );
}

/** 牌友圈頁嘅約局區（純顯示，示範都用） */
export function MeetupsView({ list, me, ownerOrAdmin, onCreate, onRsvp, onDelete, onPing, onEdit, startHref }: {
  list: Meetup[]; me: string; ownerOrAdmin: boolean;
  startHref?: (m: Meetup) => string;
  onCreate: (m: MeetupInput) => Promise<void>;
  onRsvp: (id: string, status: 'going' | 'no') => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPing?: (id: string) => Promise<string>;
  onEdit?: (id: string, patch: MeetupInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // 由通知撳入嚟（#meetups）就捲去呢度
  useEffect(() => {
    if (window.location.hash === '#meetups') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [list.length]);
  return (
    <section className="stack" id="meetups" ref={ref}>
      <div className="section-head">
        <h2>約局</h2>
        <button type="button" className="textbtn" onClick={() => setOpen(true)}>＋ 約局</button>
      </div>
      {list.length ? list.map((m) => (
        <MeetupCard key={m.id} m={m} me={me} canDelete={ownerOrAdmin || meetupHost(m) === me} onRsvp={(s) => onRsvp(m.id, s)} onDelete={() => onDelete(m.id)} onPing={onPing && (() => onPing(m.id))} onEdit={onEdit && m.by === me ? (patch) => onEdit(m.id, patch) : undefined} startHref={startHref?.(m)} />
      )) : <button type="button" className="meetup-empty" onClick={() => setOpen(true)}>未有約局。約定日子時間，等大家揀「去」定「唔去」，夠腳就知；人多可以開幾張枱。</button>}
      {open && <MeetupSheet onSave={onCreate} onClose={() => setOpen(false)} existing={list} />}
    </section>
  );
}

/** 主頁：自己所有牌友圈將來嘅約局（最近嗰幾個），撳入去牌友圈應約 */
export interface HomeMeetup { g: string; gname: string; m: Meetup }

export function HomeMeetupsView({ items, me, hrefOf }: { items: HomeMeetup[]; me: string; hrefOf: (x: HomeMeetup) => string }) {
  if (!items.length) return null;
  return (
    <section className="stack home-meetups">
      <h2 className="section-head">約局</h2>
      <div className="list">
        {items.map((x) => {
          const n = x.m.going.length;
          const want = Math.max(1, x.m.tables ?? 1);
          const mine = x.m.going.includes(me) ? 'going' : x.m.no.includes(me) ? 'no' : null;
          return (
            <Link key={`${x.g}-${x.m.id}`} to={hrefOf(x)} className="listrow home-meetup">
              <span className="grow">
                <b>{meetupWhen(x.m.at)}</b>
                <small className="muted">{x.gname}{x.m.place ? `・📍 ${x.m.place}` : ''}</small>
                <small className={n % 4 === 3 ? 'hm-hot' : 'muted'}>{n} 人・{meetupMood(n, want)}</small>
              </span>
              <span className={`tag ${mine === 'going' ? 'new' : mine === 'no' ? 'instant' : 'stay'}`}>{mine === 'going' ? '你會去' : mine === 'no' ? '你唔去' : '未應'}</span>
              <span className="chev" aria-hidden="true">›</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function GroupMeetupFeed({ g, onData }: { g: string; onData: (g: string, items: HomeMeetup[]) => void }) {
  const group = useGroup(g);
  const meetups = useMeetups(g);
  const name = group.data?.name ?? '';
  useEffect(() => {
    const now = Date.now();
    onData(g, meetups.data.filter((m) => m.at > now - 3600000).map((m) => ({ g, gname: name, m })));
  }, [g, name, meetups.data, onData]);
  return null;
}

/** 主頁約局：聽晒自己牌友圈，排時間，顯示最近 3 個 */
export function HomeMeetups({ groupIds, me }: { groupIds: string[]; me: string }) {
  const [all, setAll] = useState<Record<string, HomeMeetup[]>>({});
  const onData = useCallback((g: string, items: HomeMeetup[]) => setAll((a) => (JSON.stringify(a[g]) === JSON.stringify(items) ? a : { ...a, [g]: items })), []);
  const items = groupIds.flatMap((g) => all[g] ?? []).sort((a, b) => a.m.at - b.m.at).slice(0, 3);
  return (
    <>
      {groupIds.map((g) => <GroupMeetupFeed key={g} g={g} onData={onData} />)}
      <HomeMeetupsView items={items} me={me} hrefOf={(x) => `/g/${x.g}#meetups`} />
    </>
  );
}
