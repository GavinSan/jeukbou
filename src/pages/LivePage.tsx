// 電視直播：大字、即時更新；可以用 AirPlay／Chromecast 鏡像，或者電腦接電視全螢幕播。
// 旁邊有直播室（留言）同音樂（YouTube、YouTube Music、Spotify、Apple Music 嵌入播放）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FallingTiles, ScaleFit, TvFelt, setTvAnim, tvAnimOn } from '../components/TvFelt.tsx';
import type { CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import { sendChat, setChatBlock, setSessionMusic } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { useChat, useGroup, useProfile, useSession } from '../lib/live.ts';
import LiveNow from '../components/LiveHome.tsx';
import type { ChatMsg } from '../lib/live.ts';
import { roundLabel, useSessionLive } from '../lib/sessionData.ts';
import type { Computed } from '../lib/score.ts';
import { describe } from '../lib/score.ts';
import { Link } from '../lib/router.tsx';
import { Loading, fmt, message, useNow } from '../ui.tsx';
import { usePrefs } from '../lib/prefs.ts';
import GroupIcon from '../components/GroupIcon.tsx';

/** 將分享連結變成可以嵌入嘅播放器網址；唔認得就 null */
export function embedOf(raw: string): { src: string; kind: 'youtube' | 'spotify' | 'apple'; yt?: { id?: string; list?: string } } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  // YouTube：playsinline 等 iPhone 唔會彈全螢幕；rel=0 播完唔好跳去其他頻道
  const yt = (id: string, list: string | null) => `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0${list ? `&list=${list}` : ''}`;
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return id ? { src: yt(id, u.searchParams.get('list')), kind: 'youtube', yt: { id, list: u.searchParams.get('list') ?? undefined } } : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v') ?? /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname)?.[1];
    const list = u.searchParams.get('list');
    if (v && v !== 'videoseries') return { src: yt(v, list), kind: 'youtube', yt: { id: v, list: list ?? undefined } };
    if (list) return { src: `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1&playsinline=1`, kind: 'youtube', yt: { list } };
    return null;
  }
  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/.exec(u.pathname);
    return m ? { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: 'spotify' } : null;
  }
  if (host === 'music.apple.com') return { src: `https://embed.music.apple.com${u.pathname}${u.search}`, kind: 'apple' };
  return null;
}

// ---------- YouTube：用官方播放器 API ----------
// 先靜音自動播（瀏覽器唔俾有聲自動播），撳「開聲」先有聲；播唔到就講原因
interface YTPlayer { playVideo(): void; mute(): void; unMute(): void; setVolume(v: number): void; destroy(): void; getVideoData?(): { title?: string; author?: string } }
interface YTEvent { target: YTPlayer; data: number }
interface YTNamespace { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer }
let ytLoading: Promise<YTNamespace> | null = null;
function loadYT(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player && w.YT.loaded) return Promise.resolve(w.YT);
  if (!ytLoading) {
    ytLoading = new Promise((ok, bad) => {
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { prev?.(); if (w.YT) ok(w.YT); };
      const el = document.createElement('script');
      el.src = 'https://www.youtube.com/iframe_api';
      el.async = true;
      el.onerror = () => { ytLoading = null; bad(new Error('YouTube 載入唔到')); };
      document.head.appendChild(el);
      setTimeout(() => bad(new Error('YouTube 載入太耐')), 15000);
    });
  }
  return ytLoading;
}

const YT_ERRORS: Record<number, string> = {
  2: '條連結有問題（片 ID 唔啱）',
  5: '呢部機播唔到，試下第二個瀏覽器',
  100: '搵唔到呢條片（可能刪咗或者私人）',
  101: '版權方唔俾喺其他網站播：揀過另一條（例如 Lyric video、播放清單）',
  150: '版權方唔俾喺其他網站播：揀過另一條（例如 Lyric video、播放清單）',
  153: '播放器設定出錯，重新載入再試',
};

function YouTubeMusic({ id, list, fallbackSrc, onTitle }: { id?: string; list?: string; fallbackSrc: string; onTitle?: (t: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [muted, setMuted] = useState(true);
  const [err, setErr] = useState('');
  const [plain, setPlain] = useState(false);
  useEffect(() => {
    let alive = true;
    setErr(''); setMuted(true); setPlain(false);
    loadYT().then((YT) => {
      if (!alive || !host.current) return;
      const el = document.createElement('div');
      host.current.replaceChildren(el);
      player.current = new YT.Player(el, {
        width: '100%', height: '100%',
        ...(id ? { videoId: id } : {}),
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, ...(list ? { list, listType: 'playlist' } : {}) },
        events: {
          onReady: (e: YTEvent) => { e.target.mute(); e.target.playVideo(); },
          onError: (e: YTEvent) => setErr(YT_ERRORS[e.data] ?? `播唔到（${e.data}）`),
          // 播緊就攞首歌個名（播放清單轉歌都會更新）
          onStateChange: (e: YTEvent) => { if (e.data === 1) { const d = e.target.getVideoData?.(); if (d?.title) onTitle?.(d.author ? `${d.title}・${d.author}` : d.title); } },
        },
      });
    }).catch(() => { if (alive) setPlain(true); });
    return () => { alive = false; try { player.current?.destroy(); } catch { /* 已經冇咗 */ } player.current = null; };
  }, [id, list]);
  if (plain) return <iframe title="音樂" src={fallbackSrc} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" />;
  return (
    <>
      <div className="yt-host" ref={host} />
      {err ? <p className="tv-music-err">⚠️ {err}</p> : muted && (
        <button type="button" className="tv-unmute" onClick={() => { const p = player.current; if (!p) return; p.unMute(); p.setVolume(100); p.playVideo(); setMuted(false); }}>🔊 開聲</button>
      )}
    </>
  );
}

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

const WINDS = ['東', '南', '西', '北'];

export function tvTablesOf(tables: { id: string; name: string; names: Record<string, string> }[], computed: Record<string, Computed | null>): TvTable[] {
  return tables.flatMap((t) => {
    const c = computed[t.id];
    if (!c || c.state.ended) return [];
    const name = (id: string) => t.names[id] ?? '玩家';
    const last = c.steps[c.steps.length - 1];
    return [{
      id: t.id, name: t.name, round: roundLabel(c), dealer: c.info.dealer ?? null, streak: c.state.streak,
      // 座位：東南西北（第一個位 = 東位）；「東圈南位」嘅莊就係坐南位嗰個
      players: c.state.seats.map((id, i) => ({ id, name: name(id), v: (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0), wind: WINDS[i] })),
      last: last ? describe(last.event, name) : '未開始',
      c, names: t.names,
    }];
  });
}

/** 枱上四家：跟座位東南西北排 */
export const bySeat = <T extends { wind: string }>(ps: T[]) => [...ps].sort((a, b) => WINDS.indexOf(a.wind) - WINDS.indexOf(b.wind));


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

/** 顯示部分（示範都用） */
export function LiveTv({ groupName, icon, sessionName, tables, ranking, chat, music, me, backHref, onSend, onMusic, channels = [], current, moderate, blockedUntil = 0 }: {
  groupName: string; icon?: string; sessionName: string; tables: TvTable[]; ranking: { id: string; name: string; v: number }[];
  chat: ChatMsg[]; music?: string; me: string; backHref: string;
  onSend?: (text: string) => Promise<void>; onMusic?: (url: string) => Promise<void>;
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
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicUrl, setMusicUrl] = useState(music ?? '');
  const [error, setError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  // 電視（AirPlay）模式：枱面佔晒畫面；音樂、排名、直播室收喺右邊，撳頂部掣先拉出嚟（音樂收埋都照播）
  const [panel, setPanel] = useState<null | 'music' | 'rank' | 'chat'>(null);
  const [modFor, setModFor] = useState<ChatMsg | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chatList = useRef<HTMLDivElement>(null);
  const { hints } = usePrefs();
  const cool = useCooldown();
  // 新留言喺最底，舊嘅自己向上推；淨係碌留言框，唔好成頁跳落去。
  // 如果你碌咗上去睇舊留言，就唔好扯你返落嚟
  const stick = useRef(true);
  const seen = useRef(chat.length);
  const unread = chatOpen ? 0 : Math.max(0, chat.length - seen.current);
  useEffect(() => { if (chatOpen) seen.current = chat.length; }, [chatOpen, chat.length]);
  useEffect(() => {
    const el = chatList.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.length, chatOpen]);
  const emb = music ? embedOf(music) : null;
  // 播緊咩歌：YouTube 由播放器攞；Spotify 用佢公開嘅 oEmbed；Apple Music 由連結個名估
  const [nowPlaying, setNowPlaying] = useState('');
  useEffect(() => {
    setNowPlaying('');
    if (!music || !emb) return;
    if (emb.kind === 'apple') {
      try {
        const seg = new URL(music).pathname.split('/').filter(Boolean);
        const slug = seg.length >= 3 ? decodeURIComponent(seg[seg.length - 2]) : '';
        setNowPlaying(slug ? slug.replace(/-/g, ' ') : 'Apple Music');
      } catch { setNowPlaying('Apple Music'); }
      return;
    }
    if (emb.kind === 'spotify') {
      let alive = true;
      fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(music)}`).then((r) => r.json()).then((j: { title?: string }) => { if (alive) setNowPlaying(j.title || 'Spotify'); }).catch(() => { if (alive) setNowPlaying('Spotify'); });
      return () => { alive = false; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music]);
  // 背景動畫（只記喺呢部機）
  const [anim, setAnim] = useState(tvAnimOn);
  const clock = new Date(now).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
  // 枱面格仔：按畫面闊高揀最大嘅排法（電視打橫、手機打直都塞得滿）
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? { w: 1280, h: 720 } : { w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVw({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const { cols, rows } = useMemo(() => {
    const n = Math.max(1, tables.length);
    const W = vw.w - 24;
    const H = vw.h - 84;
    let best = { cols: 1, rows: n, k: 0 };
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const k = Math.min(W / c / 340, H / r / 432);
      if (k > best.k) best = { cols: c, rows: r, k };
    }
    return best;
  }, [tables.length, vw]);
  const muted = blockedUntil > now;
  const coolLeft = Math.max(0, Math.ceil((cool.until - now) / 1000));
  // 最近播過嘅歌（只記喺呢部機），一撳再播
  const [recent, setRecent] = useState<{ url: string; label: string }[]>(() => { try { return JSON.parse(localStorage.getItem('jeukbou-music-recent') ?? '[]'); } catch { return []; } });
  async function play(url: string) {
    setError('');
    const u = url.trim();
    if (u && !embedOf(u)) { setError('認唔到呢條連結'); return; }
    try {
      await onMusic?.(u);
      if (!u) return;
      const e = embedOf(u);
      const label = e?.kind === 'youtube' ? `YouTube ${e.yt?.list ? '清單' : e.yt?.id ?? ''}` : e?.kind === 'spotify' ? 'Spotify' : 'Apple Music';
      const next = [{ url: u, label: `${label}・${new Date().toLocaleDateString('zh-HK', { month: 'numeric', day: 'numeric' })}` }, ...recent.filter((r) => r.url !== u)].slice(0, 6);
      setRecent(next);
      try { localStorage.setItem('jeukbou-music-recent', JSON.stringify(next)); } catch { /* 唔緊要 */ }
    } catch (err) { setError(message(err)); }
  }
  const chans = channels.length ? channels : current ? [{ key: current, label: `${groupName}・${sessionName}`, href: '' }] : [];

  async function full() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { /* 有啲瀏覽器唔俾 */ }
  }

  return (
    <div className="tv fit airplay" ref={root} style={{ '--cols': cols, '--rows': rows } as CSSProperties}>
      {anim && <FallingTiles />}
      {/* 直播室：透明疊喺左下角，淨係最新 3 句 */}
      {panel !== 'chat' && chat.length > 0 && (
        <div className="tv-chat-float" aria-live="polite">
          {chat.slice(-3).map((m) => <p key={m.id}><b>{m.name}</b>{m.text}</p>)}
        </div>
      )}
      {/* 播緊嘅歌：右下角 */}
      {emb && (
        <button type="button" className="tv-now" onClick={() => { setPanel('music'); setMusicOpen(true); }} aria-label="音樂">
          <span className="tv-now-eq" aria-hidden="true"><i /><i /><i /></span>
          <span className="tv-now-text">{nowPlaying || (emb.kind === 'youtube' ? 'YouTube' : emb.kind === 'spotify' ? 'Spotify' : 'Apple Music')}</span>
        </button>
      )}
      <header className="tv-head">
        <Link to={backHref} className="tv-back" ariaLabel="返回">‹</Link>
        <GroupIcon icon={icon} name={groupName} size={40} />
        <span className="grow tv-title"><b>{groupName}</b><small>{sessionName}</small></span>
        <span className="live-pill big"><i className="live-dot" aria-hidden="true" />LIVE</span>
        <span className="tv-clock num">{clock}</span>
        <button type="button" className={`tv-btn${panel === 'music' ? ' on' : ''}`} onClick={() => { setPanel((p) => (p === 'music' ? null : 'music')); setMusicOpen(true); }} aria-label="音樂">♫</button>
        <button type="button" className={`tv-btn${panel === 'rank' ? ' on' : ''}`} onClick={() => setPanel((p) => (p === 'rank' ? null : 'rank'))} aria-label="全場排名">🏆</button>
        <button type="button" className={`tv-btn${panel === 'chat' ? ' on' : ''}`} onClick={() => { setPanel((p) => (p === 'chat' ? null : 'chat')); setChatOpen(true); }} aria-label="直播室">💬{unread > 0 && <i className="tv-btn-dot">{unread}</i>}</button>
        <button type="button" className={`tv-btn${anim ? ' on' : ''}`} onClick={() => { setAnim(!anim); setTvAnim(!anim); }} aria-label="背景動畫">✨</button>
        <button type="button" className="tv-btn" onClick={full} aria-label="全螢幕">⛶</button>
      </header>

      {/* 轉台：長期顯示自己睇緊邊個 Live；有其他 Live 就撳得轉 */}
      {chans.length > 1 && (
        <nav className="tv-channels" aria-label="轉台">
          <span className="tv-channels-label">{chans.length > 1 ? '轉台' : '睇緊'}</span>
          {chans.map((c) => (c.key === current || !c.href
            ? <span key={c.key} className="tv-channel on" aria-current="true"><i className="live-dot" aria-hidden="true" />{c.label}</span>
            : <Link key={c.key} to={c.href} className="tv-channel" ariaLabel={`睇 ${c.label}`}><i className="live-dot" aria-hidden="true" />{c.label}</Link>))}
        </nav>
      )}

      <div className="tv-body">
        <main className="tv-tables felts">
          {tables.map((t) => (
            t.c && t.names ? (
              <section key={t.id} className="tv-felt-cell">
                <ScaleFit base={340}><TvFelt c={t.c} names={t.names} title={tables.length > 1 ? t.name : undefined} me={me} /></ScaleFit>
              </section>
            ) : null
          ))}
          {!tables.length && <p className="tv-empty">而家冇枱打緊。</p>}
        </main>

        <aside className={`tv-side drawer${panel ? ` open show-${panel}` : ''}`}>
          <button type="button" className="tv-side-close" onClick={() => setPanel(null)} aria-label="收埋">×</button>
          {musicOpen && (
            <section className="tv-panel tv-music-panel">
              <b>音樂</b>
              <div className="row">
                <input className="input grow" value={musicUrl} onChange={(e) => setMusicUrl(e.target.value)} placeholder="貼 YouTube／Spotify／Apple Music 連結" aria-label="音樂連結" />
                {onMusic && typeof navigator !== 'undefined' && navigator.clipboard?.readText && (
                  <button type="button" className="btn plain small-btn" onClick={async () => {
                    try { const t = (await navigator.clipboard.readText()).trim(); if (t) { setMusicUrl(t); await play(t); } } catch { setError('讀唔到剪貼簿，請長撳輸入格貼上'); }
                  }}>📋 貼上</button>
                )}
                {onMusic && <button type="button" className="btn small-btn" onClick={() => play(musicUrl)}>播</button>}
              </div>
              {recent.length > 0 && (
                <div className="tv-recent">
                  <small className="muted">最近播過</small>
                  {recent.map((r) => <button key={r.url} type="button" className="tv-channel" onClick={() => play(r.url)}>{r.label}</button>)}
                </div>
              )}
              <small className="muted">唔使喺電視打字：用手機開同一個 Live、撳 ♫ 貼連結，電視會自動跟住播。YouTube 最穩陣；Spotify／Apple Music 要嗰部機登入咗先播到全首。</small>
            </section>
          )}
          {emb && (
            <section className={`tv-music ${emb.kind}`}>
              {emb.kind === 'youtube'
                ? <YouTubeMusic key={emb.src} id={emb.yt?.id} list={emb.yt?.list} fallbackSrc={emb.src} onTitle={setNowPlaying} />
                : <iframe key={emb.src} title="音樂" src={emb.src} allow="autoplay; encrypted-media; fullscreen; clipboard-write; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" />}
              <small className="tv-music-foot">{emb.kind === 'youtube' ? '一開始靜音播（瀏覽器規矩），撳「開聲」先有聲' : '冇聲？撳一下播放器個 ▶︎'}・<a href={music} target="_blank" rel="noreferrer">喺{emb.kind === 'youtube' ? ' YouTube' : emb.kind === 'spotify' ? ' Spotify' : ' Apple Music'} 開</a>{onMusic && <> ・<button type="button" className="textbtn small" onClick={() => onMusic('').catch(() => undefined)}>停</button></>}</small>
            </section>
          )}

          <section className="tv-panel tv-rank">
            <b>全場排名</b>
            <ol>
              {ranking.map((r, i) => (
                <li key={r.id} className={r.id === me ? 'me' : ''}><span className="tv-rank-no">{i + 1}</span><span className="grow ellipsis">{r.name}</span><b className={`num ${r.v > 0 ? 'gain' : r.v < 0 ? 'loss' : ''}`}>{fmt(r.v)}</b></li>
              ))}
            </ol>
          </section>

          {/* 直播室：大螢幕喺右邊；手機變底部抽屜（撳頂部打開，有新留言會數住） */}
          <section className={`tv-panel tv-chat${chatOpen ? ' open' : ''}`}>
            <button type="button" className="tv-chat-head" aria-expanded={chatOpen} onClick={() => setChatOpen((v) => !v)}>
              <b>直播室</b>
              {unread > 0 && <span className="tv-unread">{unread}</span>}
              <span className="grow" />
              <span className="tv-chat-toggle" aria-hidden="true">{chatOpen ? '收埋' : '打開'}</span>
            </button>
            <div className="tv-chat-list" ref={chatList} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
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
            {onSend && (muted ? <p className="tv-chat-muted">你被禁言到 {new Date(blockedUntil).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' })}。</p> : (
              <form className="row tv-chat-form" onSubmit={async (e) => {
                e.preventDefault();
                const t = text.trim();
                if (!t) return;
                if (!cool.note()) return;
                setText('');
                stick.current = true;
                try { await onSend(t); } catch (err) { setError(/permission|denied|權限/i.test(message(err)) ? '講得太快，等兩秒再講' : message(err)); setText(t); }
              }}>
                <input className="input grow" value={text} disabled={coolLeft > 0} onChange={(e) => setText(e.target.value.slice(0, 200))} onFocus={() => setChatOpen(true)} placeholder={coolLeft > 0 ? `講得太快（${coolLeft}秒）` : '留言…'} aria-label="留言" />
                <button type="submit" className="btn small-btn" disabled={!text.trim() || coolLeft > 0}>送出</button>
              </form>
            ))}
          </section>
          {error && <p className="error">{error}</p>}
          {hints && <p className="tv-tip">用 AirPlay／Chromecast「螢幕鏡像」，或者電腦接 HDMI 撳 ⛶ 全螢幕。</p>}
        </aside>
      </div>
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
        r.v += (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0);
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
      music={session.data.music}
      me={user.uid}
      backHref={`/g/${groupId}/s/${sessionId}`}
      onSend={(t) => sendChat(groupId, sessionId, user, t)}
      onMusic={(u) => setSessionMusic(groupId, sessionId, u)}
      blockedUntil={session.data.chatBlock?.[user.uid] ?? 0}
      moderate={session.data.createdBy === user.uid || group.data.ownerId === user.uid || admin ? {
        blocked: session.data.chatBlock ?? {},
        onBlock: (uid, on) => setChatBlock(groupId, sessionId, uid, on ? Date.now() + 24 * 3600000 : 0),
      } : undefined}
    />
    </>
  );
}
