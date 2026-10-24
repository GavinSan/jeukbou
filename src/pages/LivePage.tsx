// 電視直播：大字、即時更新；可以用 AirPlay／Chromecast 鏡像，或者電腦接電視全螢幕播。
// 全場排名長期喺右邊（可以閂）；直播室長期喺底（留言 + 枱上發生嘅事，舊嘅慢慢淡）；Live 風格、聲效、背景動畫。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FallingTiles, ScaleFit, TvFelt, setTvAnim, tvAnimOn } from '../components/TvFelt.tsx';
import type { CSSProperties, FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { sendChat, setChatBlock } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { useChat, useGroup, useProfile, useSession } from '../lib/live.ts';
import LiveNow from '../components/LiveHome.tsx';
import type { ChatMsg } from '../lib/live.ts';
import { roundLabel, useSessionLive } from '../lib/sessionData.ts';
import type { Computed } from '../lib/score.ts';
import { describe } from '../lib/score.ts';
import { seatWind } from '../engine/table.ts';
import type { TableEvent } from '../engine/table.ts';
import { Link } from '../lib/router.tsx';
import { Loading, fmt, message, useNow } from '../ui.tsx';
import { SKINS, setSkinOverride, skinLock, usePrefs, useSkinAccess } from '../lib/prefs.ts';
import type { Skin } from '../lib/prefs.ts';
import GroupIcon from '../components/GroupIcon.tsx';
import Celebrate from '../components/Celebrate.tsx';
import { forceSound, primeVoice, sfx, unlock } from '../lib/sound.ts';

export interface TvTable {
  id: string;
  name: string;
  round: string;
  dealer: string | null;
  /** 連莊（冧莊）幾多次 */
  streak?: number;
  players: { id: string; name: string; v: number; wind: string }[];
  last: string;
  /** 電視枱面（同枱頁一樣）要用 */
  c?: Computed;
  names?: Record<string, string>;
}


export function tvTablesOf(tables: { id: string; name: string; names: Record<string, string> }[], computed: Record<string, Computed | null>): TvTable[] {
  return tables.flatMap((t) => {
    const c = computed[t.id];
    if (!c || c.state.ended) return [];
    const name = (id: string) => t.names[id] ?? '玩家';
    const last = c.steps[c.steps.length - 1];
    return [{
      id: t.id, name: t.name, round: roundLabel(c), dealer: c.info.dealer ?? null, streak: c.state.streak,
      // 跟座位排；wind = 而家嘅門風（莊 = 東）
      // v = 袋咗嘅數（唔計拉住未找）
      players: c.state.seats.map((id) => ({ id, name: name(id), v: c.state.settled[id] ?? 0, wind: seatWind(c.state, id) })),
      last: last ? describe(last.event, name) : '未開始',
      c, names: t.names,
    }];
  });
}

/** 枱上四家：跟座位排（tvTablesOf 已經係座位次序） */
export const bySeat = <T,>(ps: T[]) => [...ps];


/** 防洗版：30 秒內講咗 5 句就要停 30 秒（正常傾偈唔會撞到） */
function useCooldown() {
  const sent = useRef<number[]>([]);
  const [until, setUntil] = useState(0);
  return {
    until,
    note(): boolean {
      const now = Date.now();
      if (now < until) return false;
      sent.current = [...sent.current.filter((t) => now - t < 30000), now];
      if (sent.current.length >= 5) { setUntil(now + 30000); sent.current = []; }
      return true;
    },
  };
}

/** Live 自己嘅風格（只記喺呢部機）；空 = 跟 App */
const LIVE_SKIN_KEY = 'jeukbou-live-skin';
const readLiveSkin = (): Skin | '' => { try { const v = localStorage.getItem(LIVE_SKIN_KEY) ?? ''; return SKINS.some((k) => k.key === v) ? (v as Skin) : ''; } catch { return ''; } };

/** Live 聲效（食糊「食！」）：只記喺呢部機，預設開 */
const LIVE_SOUND_KEY = 'jeukbou-live-sound';
const readLiveSound = () => { try { return localStorage.getItem(LIVE_SOUND_KEY) !== '0'; } catch { return true; } };

/** 有人食糊：搵出啱啱多咗嘅「食糊」鋪（第一次載入、斷線補返嘅舊鋪唔計） */
function useWinBurst(tables: TvTable[]) {
  const last = useRef<Record<string, number>>({});
  const [burst, setBurst] = useState<{ key: number; fan: number; who: string } | null>(null);
  useEffect(() => {
    let hit: { fan: number; who: string } | null = null;
    for (const t of tables) {
      if (!t.c) continue;
      const steps = t.c.steps;
      const top = steps.length ? steps[steps.length - 1].seq : 0;
      const before = last.current[t.id];
      last.current[t.id] = top;
      if (before === undefined) continue;
      for (const st of steps) {
        if (st.seq <= before || st.event.type !== 'win') continue;
        if (st.at && Date.now() - st.at > 90000) continue;
        const w = [...st.event.winners].sort((a, b) => b.fan - a.fan)[0];
        if (!w) continue;
        const who = st.event.winners.map((x) => t.names?.[x.player] ?? '玩家').join('、');
        if (!hit || w.fan > hit.fan) hit = { fan: w.fan, who };
      }
    }
    if (hit) setBurst({ key: Date.now(), ...hit });
  }, [tables]);
  return [burst, () => setBurst(null)] as const;
}

/** 直播室一行：留言，或者枱上發生嘅事（食糊、自摸、花、追、即摸…） */
interface FeedItem { key: string; at: number; text: string; name?: string; msg?: ChatMsg; table?: string; icon?: string }

function feedText(ev: TableEvent, name: (id: string) => string): { text: string; icon: string } | null {
  switch (ev.type) {
    case 'win': return { text: describe(ev, name), icon: ev.loser === null ? '🀄' : '💥' };
    case 'special': {
      const m = ev.meta;
      const times = m?.repeat && m.repeat > 1 ? `（第 ${m.repeat} 次）` : '';
      return { text: `${name(ev.player)} ${ev.label}${times}，${ev.direction === 'collect' ? '收' : '俾'}每家 ${ev.amount}`, icon: m?.chase ? '🏃' : m?.instant ? '⚡' : m?.art === 'flower' ? '🌸' : '✨' };
    }
    case 'falseWin': return { text: describe(ev, name), icon: '🙈' };
    case 'draw': return { text: '流局', icon: '🌊' };
    case 'settle': return { text: describe(ev, name), icon: '💰' };
    case 'swap': return { text: describe(ev, name), icon: '🔄' };
    case 'extend': return { text: describe(ev, name), icon: '🔁' };
    case 'end': return { text: '完場', icon: '🏁' };
    default: return null;
  }
}

/** Live 嘅開關（只記喺呢部機） */
const flag = (k: string, d = true) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const saveFlag = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* 唔緊要 */ } };

/** 顯示部分（示範都用） */
export function LiveTv({ groupName, icon, sessionName, tables, ranking, chat, me, backHref, onSend, channels = [], current, moderate, blockedUntil = 0 }: {
  groupName: string; icon?: string; sessionName: string; tables: TvTable[]; ranking: { id: string; name: string; v: number }[];
  chat: ChatMsg[]; me: string; backHref: string;
  onSend?: (text: string) => Promise<void>;
  /** 自己有份嘅 Live（長期顯示，可以轉台） */
  channels?: { key: string; label: string; href: string }[];
  current?: string;
  /** 場主、局主、超級管理員：禁言 24 小時／解禁 */
  moderate?: { blocked: Record<string, number>; onBlock: (uid: string, on: boolean) => Promise<void> };
  /** 自己被禁言到幾時 */
  blockedUntil?: number;
}) {
  const now = useNow();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  // 右邊抽屜：風格、成個直播室紀錄（禁言用）
  const [panel, setPanel] = useState<null | 'chat' | 'theme'>(null);
  const [modFor, setModFor] = useState<ChatMsg | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chatList = useRef<HTMLDivElement>(null);
  const { hints } = usePrefs();
  const access = useSkinAccess();
  const cool = useCooldown();
  // 全場排名：長期顯示（可以閂）；直播室：長期喺底（可以閂）；枱上事件：一齊顯示（可以閂）
  const [rankOn, setRankOn] = useState(() => flag('jeukbou-live-rank'));
  const [feedOn, setFeedOn] = useState(() => flag('jeukbou-live-feed'));
  const [eventsOn, setEventsOn] = useState(() => flag('jeukbou-live-events'));
  const [compose, setCompose] = useState(false);
  const setFlag = (k: string, set: (v: boolean) => void) => (v: boolean) => { set(v); saveFlag(k, v); };
  const toggleRank = () => setFlag('jeukbou-live-rank', setRankOn)(!rankOn);
  // 未睇嘅留言：直播室閂咗先數
  const seen = useRef(chat.length);
  const unread = feedOn || compose ? 0 : Math.max(0, chat.length - seen.current);
  useEffect(() => { if (feedOn || compose) seen.current = chat.length; }, [feedOn, compose, chat.length]);
  useEffect(() => {
    const el = chatList.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, panel]);
  // 當日大數：成個大局（連完咗場、換咗枱）每人袋咗幾多（唔計拉住未找），長期顯示喺每隻牌底
  const day = useMemo(() => Object.fromEntries(ranking.map((r) => [r.id, r.v])), [ranking]);
  // 直播室：留言 + 枱上發生嘅事，按時間排
  const feed = useMemo(() => {
    const out: FeedItem[] = chat.map((m) => ({ key: `c${m.id}`, at: m.at ?? Date.now(), text: m.text, name: m.name, msg: m }));
    if (eventsOn) {
      for (const t of tables) {
        if (!t.c) continue;
        const nm = (id: string) => t.names?.[id] ?? '玩家';
        for (const st of t.c.steps) {
          const f = feedText(st.event, nm);
          if (!f || !st.at) continue;
          out.push({ key: `e${t.id}-${st.seq}`, at: st.at, text: f.text, icon: f.icon, table: tables.length > 1 ? t.name : undefined });
        }
      }
    }
    return out.sort((x, y) => x.at - y.at).slice(-24);
  }, [chat, tables, eventsOn]);
  // Live 風格：用 App 嘅風格（解鎖規矩一樣），只套喺 Live，出返去就變返
  const [liveSkin, setLiveSkin] = useState<Skin | ''>(readLiveSkin);
  useEffect(() => { setSkinOverride(liveSkin || null); return () => setSkinOverride(null); }, [liveSkin]);
  const pickSkin = (k: Skin | '') => { setLiveSkin(k); try { localStorage.setItem(LIVE_SKIN_KEY, k); } catch { /* 唔緊要 */ } };
  // 背景動畫（只記喺呢部機）
  const [anim, setAnim] = useState(tvAnimOn);
  // 聲效：開咗就唔理 App 嘅聲效設定；iPhone 要撳過畫面一下先出到聲
  const [sound, setSound] = useState(readLiveSound);
  useEffect(() => { forceSound(sound); return () => forceSound(false); }, [sound]);
  useEffect(() => {
    const wake = () => { unlock(); primeVoice(); };
    document.addEventListener('pointerdown', wake, { once: true });
    return () => document.removeEventListener('pointerdown', wake);
  }, []);
  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    try { localStorage.setItem(LIVE_SOUND_KEY, on ? '1' : '0'); } catch { /* 唔緊要 */ }
    if (on) { unlock(); primeVoice(); }
  };
  const [burst, clearBurst] = useWinBurst(tables);
  useEffect(() => { if (burst && sound) sfx.eat(burst.fan); }, [burst, sound]);
  const clock = new Date(now).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
  // 枱面格仔：量實際剩低嘅位（扣咗頂部、排名、直播室），揀最大嘅排法；每張枱再伸盡個格（字跟住大）
  const body = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1280, h: 600 });
  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    const on = () => setBox({ w: b.clientWidth, h: Math.max(100, b.clientHeight) });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);
  const { cols, rows } = useMemo(() => {
    const n = Math.max(1, tables.length);
    let best = { cols: 1, rows: n, k: 0 };
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const k = Math.min(box.w / c / FELT_MIN_W, box.h / r / FELT_MIN_H);
      if (k > best.k) best = { cols: c, rows: r, k };
    }
    return best;
  }, [tables.length, box]);
  const muted = blockedUntil > now;
  const coolLeft = Math.max(0, Math.ceil((cool.until - now) / 1000));
  const chans = channels.length ? channels : current ? [{ key: current, label: `${groupName}・${sessionName}`, href: '' }] : [];

  async function full() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { /* 有啲瀏覽器唔俾 */ }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || !onSend) return;
    if (!cool.note()) return;
    setText('');
    try { await onSend(t); } catch (err) { setError(/permission|denied|權限/i.test(message(err)) ? '講得太快，等兩秒再講' : message(err)); setText(t); }
  }

  return (
    <div className={`tv fit airplay${rankOn ? ' rank-on' : ''}${feedOn ? ' feed-on' : ''}`} ref={root} style={{ '--cols': cols, '--rows': rows } as CSSProperties}>
      {anim && <FallingTiles />}
      <header className="tv-head">
        <Link to={backHref} className="tv-back" ariaLabel="返回">‹</Link>
        <GroupIcon icon={icon} name={groupName} size={40} />
        <span className="grow tv-title"><b>{groupName}</b><small>{sessionName}</small></span>
        <span className="live-pill big"><i className="live-dot" aria-hidden="true" />LIVE</span>
        <span className="tv-clock num">{clock}</span>
        <button type="button" className={`tv-btn${rankOn ? ' on' : ''}`} onClick={toggleRank} aria-label={rankOn ? '收埋全場排名' : '顯示全場排名'} aria-pressed={rankOn}>🏆</button>
        <button type="button" className={`tv-btn${compose ? ' on' : ''}`} onClick={() => setCompose((v) => !v)} aria-label={compose ? '收埋留言' : '留言同直播室設定'} aria-expanded={compose}>💬{unread > 0 && <i className="tv-btn-dot">{unread}</i>}</button>
        <button type="button" className={`tv-btn${panel === 'theme' ? ' on' : ''}`} onClick={() => setPanel((x) => (x === 'theme' ? null : 'theme'))} aria-label="風格">🎨</button>
        <button type="button" className={`tv-btn${sound ? ' on' : ''}`} onClick={toggleSound} aria-label={sound ? '閂聲效' : '開聲效'} aria-pressed={sound}>{sound ? '🔊' : '🔇'}</button>
        <button type="button" className={`tv-btn${anim ? ' on' : ''}`} onClick={() => { setAnim(!anim); setTvAnim(!anim); }} aria-label="背景動畫">✨</button>
        <button type="button" className="tv-btn" onClick={full} aria-label="全螢幕">⛶</button>
      </header>

      {/* 轉台：有其他 Live 就撳得轉 */}
      {chans.length > 1 && (
        <nav className="tv-channels" aria-label="轉台">
          <span className="tv-channels-label">轉台</span>
          {chans.map((c) => (c.key === current || !c.href
            ? <span key={c.key} className="tv-channel on" aria-current="true"><i className="live-dot" aria-hidden="true" />{c.label}</span>
            : <Link key={c.key} to={c.href} className="tv-channel" ariaLabel={`睇 ${c.label}`}><i className="live-dot" aria-hidden="true" />{c.label}</Link>))}
        </nav>
      )}

      <div className="tv-stage">
        <div className="tv-body" ref={body}>
          <main className="tv-tables felts">
            {tables.map((t) => (
              t.c && t.names ? (
                <section key={t.id} className="tv-felt-cell">
                  <ScaleFit minW={FELT_MIN_W} minH={FELT_MIN_H}><TvFelt c={t.c} names={t.names} title={t.name} me={me} day={day} /></ScaleFit>
                </section>
              ) : null
            ))}
            {!tables.length && <p className="tv-empty">而家冇枱打緊。</p>}
          </main>
        </div>
        {/* 全場排名：長期顯示（撳 🏆 開／閂），唔會遮到枱 */}
        {rankOn && (
          <aside className="tv-rankdock" aria-label="全場排名">
            <b className="tv-rankdock-title">全場排名</b>
            <ol>
              {ranking.map((r, i) => (
                <li key={r.id} className={r.id === me ? 'me' : ''}><span className="tv-rank-no">{i + 1}</span><span className="grow ellipsis">{r.name}</span><b className={`num ${r.v > 0 ? 'gain' : r.v < 0 ? 'loss' : ''}`}>{fmt(r.v)}</b></li>
              ))}
              {!ranking.length && <li className="muted">未有數</li>}
            </ol>
          </aside>
        )}
      </div>

      {/* 直播室：長期喺底（留言 + 枱上發生嘅事），舊嘅慢慢淡；撳 💬 先出打字位同設定 */}
      {(feedOn || compose) && (
        <section className={`tv-feed${feedOn ? '' : ' only-compose'}`} aria-label="直播室">
          {feedOn && (
            <div className="tv-feed-lines" aria-live="polite">
              {feed.map((f) => (
                <p key={f.key} className={f.msg ? 'chat' : 'event'}>
                  {f.msg ? (
                    moderate && f.msg.by !== me
                      ? <button type="button" className="tv-feed-name" onClick={() => setModFor(f.msg!)}>{f.name}{(moderate.blocked[f.msg.by] ?? 0) > now ? ' 🔇' : ''}</button>
                      : <b className="tv-feed-name">{f.name}</b>
                  ) : <span className="tv-feed-icon" aria-hidden="true">{f.icon}</span>}
                  {f.table && <span className="tv-feed-table">{f.table}</span>}
                  <span className="tv-feed-text">{f.text}</span>
                </p>
              ))}
              {!feed.length && <p className="event muted">直播室：撳 💬 講兩句</p>}
            </div>
          )}
          {compose && (
            <div className="tv-compose">
              {onSend && (muted
                ? <p className="tv-chat-muted grow">你被禁言到 {new Date(blockedUntil).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' })}。</p>
                : (
                  <form className="row tv-chat-form grow" onSubmit={send}>
                    <input className="input grow" value={text} disabled={coolLeft > 0} onChange={(e) => setText(e.target.value.slice(0, 200))} placeholder={coolLeft > 0 ? `講得太快（${coolLeft}秒）` : '留言…'} aria-label="留言" autoFocus />
                    <button type="submit" className="btn small-btn" disabled={!text.trim() || coolLeft > 0}>送出</button>
                  </form>
                ))}
              <div className="tv-compose-opts">
                <label className="tv-check"><input type="checkbox" checked={feedOn} onChange={(e) => setFlag('jeukbou-live-feed', setFeedOn)(e.target.checked)} />顯示直播室</label>
                <label className="tv-check"><input type="checkbox" checked={eventsOn} onChange={(e) => setFlag('jeukbou-live-events', setEventsOn)(e.target.checked)} />顯示枱上事件</label>
                <button type="button" className="textbtn small" onClick={() => setPanel('chat')}>全部留言</button>
                <button type="button" className="textbtn small" onClick={() => setCompose(false)}>收埋</button>
              </div>
              {error && <p className="error">{error}</p>}
            </div>
          )}
        </section>
      )}

      <aside className={`tv-side drawer${panel ? ` open show-${panel}` : ''}`} aria-hidden={!panel}>
        <button type="button" className="tv-side-close" onClick={() => setPanel(null)} aria-label="收埋">×</button>
        {panel === 'theme' && (
          <section className="tv-panel tv-theme">
            <b>風格</b>
            <small className="muted">淨係改 Live（呢部機），唔會改你 App 嘅風格。</small>
            <div className="tv-skins">
              <button type="button" className={`tv-skin${liveSkin === '' ? ' on' : ''}`} aria-pressed={liveSkin === ''} onClick={() => pickSkin('')}>
                <span className="tv-skin-app" aria-hidden="true">App</span>
                <b>跟 App</b>
              </button>
              {SKINS.map((k) => {
                const lock = skinLock(k.key, access);
                return (
                  <button key={k.key} type="button" className={`tv-skin${liveSkin === k.key ? ' on' : ''}${lock ? ' locked' : ''}`} aria-pressed={liveSkin === k.key} disabled={!!lock} title={lock ?? k.note} onClick={() => pickSkin(k.key)}>
                    <span className="skin-sw" aria-hidden="true">{k.colors.map((c) => <i key={c} style={{ background: c }} />)}</span>
                    <b>{k.name}{lock && ' 🔒'}</b>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {panel === 'chat' && (
          <section className="tv-panel tv-chat open">
            <div className="tv-chat-top">
              <b className="grow">全部留言</b>
              <button type="button" className="textbtn small" onClick={() => setPanel(null)}>收埋</button>
            </div>
            <div className="tv-chat-list" ref={chatList}>
              {chat.map((m) => {
                const blocked = (moderate?.blocked[m.by] ?? 0) > now;
                return (
                  <p key={m.id} className={`selectable${m.by === me ? ' mine' : ''}`}>
                    {moderate && m.by !== me ? <button type="button" className="tv-chat-name" onClick={() => setModFor(m)}>{m.name}{blocked ? ' 🔇' : ''}</button> : <b>{m.name}</b>}
                    {m.text}
                  </p>
                );
              })}
              {!chat.length && <p className="muted">未有留言，講兩句啦。</p>}
            </div>
            {onSend && !muted && (
              <form className="row tv-chat-form" onSubmit={send}>
                <input className="input grow" value={text} disabled={coolLeft > 0} onChange={(e) => setText(e.target.value.slice(0, 200))} placeholder={coolLeft > 0 ? `講得太快（${coolLeft}秒）` : '留言…'} aria-label="留言（全部留言）" />
                <button type="submit" className="btn small-btn" disabled={!text.trim() || coolLeft > 0}>送出</button>
              </form>
            )}
          </section>
        )}
        {hints && <p className="tv-tip">用 AirPlay／Chromecast「螢幕鏡像」，或者電腦接 HDMI 撳 ⛶ 全螢幕。</p>}
      </aside>
      {burst && <Celebrate key={burst.key} fan={burst.fan} who={`${burst.who} 食！`} silent={!sound} long onDone={clearBurst} />}
      {modFor && moderate && (() => {
        const blocked = (moderate.blocked[modFor.by] ?? 0) > now;
        return (
          <div className="tv-mod" role="dialog" aria-label="管理留言">
            <b>{modFor.name}</b>
            <small>「{modFor.text}」</small>
            <div className="row">
              <button type="button" className={`btn small-btn${blocked ? '' : ' danger'}`} onClick={async () => { try { await moderate.onBlock(modFor.by, !blocked); } catch (err) { setError(message(err)); } setModFor(null); }}>{blocked ? '解除禁言' : '禁言 24 小時'}</button>
              <button type="button" className="btn plain small-btn" onClick={() => setModFor(null)}>取消</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** 電視枱面最細要幾大（ScaleFit 會放大塞滿個格）：闊 320；高 = 資料行 36 + 綠絨最少 350 */
const FELT_MIN_W = 320;
const FELT_MIN_H = 386;

export default function LivePage({ user, groupId, sessionId }: { user: User; groupId: string; sessionId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const profile = useProfile(user.uid);
  const admin = useSuperAdmin(user.uid);
  // 自己所有牌友圈入面打緊嘅大局：可以轉台
  const [chans, setChans] = useState<Record<string, string>>({});
  const onLive = useCallback((k: string, on: boolean, info?: { label: string }) => setChans((m) => {
    if (on && info) return m[k] === info.label ? m : { ...m, [k]: info.label };
    if (!(k in m)) return m;
    const n = { ...m };
    delete n[k];
    return n;
  }), []);
  const live = useSessionLive(groupId, sessionId, group.data, session.data);
  const chat = useChat(groupId, sessionId);
  // ?t=枱 → 淨係睇一張（由枱頁嘅 AirPlay 入嚟）
  const only = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('t') : null;
  const tables = useMemo(() => tvTablesOf(live.tables, live.computed).filter((t) => !only || t.id === only), [live.tables, live.computed, only]);
  const ranking = useMemo(() => {
    const acc = new Map<string, { id: string; name: string; v: number }>();
    for (const t of live.tables) {
      const c = live.computed[t.id];
      if (!c) continue;
      for (const id of Object.keys(c.state.settled)) {
        const r = acc.get(id) ?? { id, name: t.names[id] ?? '玩家', v: 0 };
        r.v += c.state.settled[id] ?? 0;
        acc.set(id, r);
      }
    }
    return [...acc.values()].sort((a, b) => b.v - a.v);
  }, [live.tables, live.computed]);
  // 電視唔好瞓
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    return () => { lock?.release().catch(() => undefined); };
  }, []);
  if (!group.data || !session.data) return <main className="page"><Loading /></main>;
  const here = `${groupId}/${sessionId}`;
  const channels = Object.entries({ [here]: `${group.data.name}・${session.data.name}`, ...chans })
    .map(([key, label]) => ({ key, label, href: `/live/${key}` }));
  return (
    <>
    <LiveNow groupIds={profile.data.groups} me={user.uid} onLive={onLive} hidden />
    <LiveTv
      key={here}
      channels={channels}
      current={here}
      groupName={group.data.name}
      icon={group.data.icon}
      sessionName={session.data.name}
      tables={tables}
      ranking={ranking}
      chat={chat.data}
      me={user.uid}
      backHref={`/g/${groupId}/s/${sessionId}`}
      onSend={(t) => sendChat(groupId, sessionId, user, t)}
      blockedUntil={session.data.chatBlock?.[user.uid] ?? 0}
      moderate={session.data.createdBy === user.uid || group.data.ownerId === user.uid || admin ? {
        blocked: session.data.chatBlock ?? {},
        onBlock: (uid, on) => setChatBlock(groupId, sessionId, uid, on ? Date.now() + 24 * 3600000 : 0),
      } : undefined}
    />
    </>
  );
}
