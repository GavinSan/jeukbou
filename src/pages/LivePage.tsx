// 電視直播：大字、即時更新；可以用 AirPlay／Chromecast 鏡像，或者電腦接電視全螢幕播。
// 旁邊有直播室（留言）同音樂（YouTube、YouTube Music、Spotify、Apple Music 嵌入播放）。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import { sendChat, setSessionMusic } from '../lib/data.ts';
import { useChat, useGroup, useSession } from '../lib/live.ts';
import type { ChatMsg } from '../lib/live.ts';
import { roundLabel, useSessionLive } from '../lib/sessionData.ts';
import type { Computed } from '../lib/score.ts';
import { describe } from '../lib/score.ts';
import { Link } from '../lib/router.tsx';
import { Loading, fmt, message, useNow } from '../ui.tsx';
import GroupIcon from '../components/GroupIcon.tsx';

/** 將分享連結變成可以嵌入嘅播放器網址；唔認得就 null */
export function embedOf(raw: string): { src: string; kind: 'youtube' | 'spotify' | 'apple' } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return { src: `https://www.youtube.com/embed/${u.pathname.slice(1)}?autoplay=1`, kind: 'youtube' };
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v');
    const list = u.searchParams.get('list');
    if (v) return { src: `https://www.youtube.com/embed/${v}?autoplay=1${list ? `&list=${list}` : ''}`, kind: 'youtube' };
    if (list) return { src: `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1`, kind: 'youtube' };
    return null;
  }
  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/.exec(u.pathname);
    return m ? { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: 'spotify' } : null;
  }
  if (host === 'music.apple.com') return { src: `https://embed.music.apple.com${u.pathname}${u.search}`, kind: 'apple' };
  return null;
}

export interface TvTable {
  id: string;
  name: string;
  round: string;
  dealer: string | null;
  players: { id: string; name: string; v: number; wind: string }[];
  last: string;
}

const WINDS = ['東', '南', '西', '北'];

export function tvTablesOf(tables: { id: string; name: string; names: Record<string, string> }[], computed: Record<string, Computed | null>): TvTable[] {
  return tables.flatMap((t) => {
    const c = computed[t.id];
    if (!c || c.state.ended) return [];
    const name = (id: string) => t.names[id] ?? '玩家';
    const last = c.steps[c.steps.length - 1];
    return [{
      id: t.id, name: t.name, round: roundLabel(c), dealer: c.info.dealer ?? null,
      players: c.state.seats.map((id, i) => ({ id, name: name(id), v: (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0), wind: WINDS[(i - c.state.dealerSeat + 4) % 4] })),
      last: last ? describe(last.event, name) : '未開始',
    }];
  });
}

/** 顯示部分（示範都用） */
export function LiveTv({ groupName, icon, sessionName, tables, ranking, chat, music, me, backHref, onSend, onMusic }: {
  groupName: string; icon?: string; sessionName: string; tables: TvTable[]; ranking: { id: string; name: string; v: number }[];
  chat: ChatMsg[]; music?: string; me: string; backHref: string;
  onSend?: (text: string) => Promise<void>; onMusic?: (url: string) => Promise<void>;
}) {
  const now = useNow();
  const [text, setText] = useState('');
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicUrl, setMusicUrl] = useState(music ?? '');
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);
  const emb = music ? embedOf(music) : null;
  const clock = new Date(now).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });

  async function full() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { /* 有啲瀏覽器唔俾 */ }
  }

  return (
    <div className="tv" ref={root}>
      <header className="tv-head">
        <Link to={backHref} className="tv-back" ariaLabel="返回">‹</Link>
        <GroupIcon icon={icon} name={groupName} size={40} />
        <span className="grow tv-title"><b>{groupName}</b><small>{sessionName}</small></span>
        <span className="live-pill big"><i className="live-dot" aria-hidden="true" />LIVE</span>
        <span className="tv-clock num">{clock}</span>
        <button type="button" className="tv-btn" onClick={() => setMusicOpen((v) => !v)} aria-label="音樂">♫</button>
        <button type="button" className="tv-btn" onClick={full} aria-label="全螢幕">⛶</button>
      </header>

      <div className="tv-body">
        <main className="tv-tables" style={{ '--n': Math.max(1, tables.length) } as CSSProperties}>
          {tables.map((t) => (
            <section key={t.id} className="tv-table">
              <div className="tv-table-head"><b>{t.name}</b><span>{t.round}</span></div>
              <div className="tv-players">
                {[...t.players].sort((a, b) => b.v - a.v).map((p) => (
                  <div key={p.id} className={`tv-player${p.id === t.dealer ? ' dealer' : ''}`}>
                    <span className="tv-wind">{p.wind}</span>
                    <span className="grow ellipsis tv-name">{p.name}{p.id === t.dealer && <i className="tv-dealer">莊</i>}</span>
                    <b className={`num tv-score ${p.v > 0 ? 'gain' : p.v < 0 ? 'loss' : ''}`}>{fmt(p.v)}</b>
                  </div>
                ))}
              </div>
              <div className="tv-last">{t.last}</div>
            </section>
          ))}
          {!tables.length && <p className="tv-empty">而家冇枱打緊。</p>}
        </main>

        <aside className="tv-side">
          {musicOpen && (
            <section className="tv-panel">
              <b>音樂</b>
              <div className="row">
                <input className="input grow" value={musicUrl} onChange={(e) => setMusicUrl(e.target.value)} placeholder="貼 YouTube／YouTube Music／Spotify／Apple Music 連結" aria-label="音樂連結" />
                {onMusic && <button type="button" className="btn small-btn" onClick={async () => {
                  setError('');
                  if (musicUrl.trim() && !embedOf(musicUrl)) { setError('認唔到呢條連結'); return; }
                  try { await onMusic(musicUrl); } catch (err) { setError(message(err)); }
                }}>播</button>}
              </div>
              <small className="muted">Spotify 要部機登入咗 Premium 先播到全首；YouTube 唔使登入。</small>
            </section>
          )}
          {emb && (
            <section className={`tv-music ${emb.kind}`}>
              <iframe title="音樂" src={emb.src} allow="autoplay; encrypted-media; fullscreen; clipboard-write; picture-in-picture" loading="lazy" />
            </section>
          )}

          <section className="tv-panel tv-rank">
            <b>全場排名</b>
            <ol>
              {ranking.slice(0, 8).map((r, i) => (
                <li key={r.id} className={r.id === me ? 'me' : ''}><span className="tv-rank-no">{i + 1}</span><span className="grow ellipsis">{r.name}</span><b className={`num ${r.v > 0 ? 'gain' : r.v < 0 ? 'loss' : ''}`}>{fmt(r.v)}</b></li>
              ))}
            </ol>
          </section>

          <section className="tv-panel tv-chat">
            <b>直播室</b>
            <div className="tv-chat-list">
              {chat.map((m) => (
                <p key={m.id} className={m.by === me ? 'mine' : ''}><b>{m.name}</b>{m.text}</p>
              ))}
              {!chat.length && <p className="muted">未有留言，講兩句啦。</p>}
              <div ref={chatEnd} />
            </div>
            {onSend && (
              <form className="row" onSubmit={async (e) => {
                e.preventDefault();
                const t = text;
                setText('');
                try { await onSend(t); } catch (err) { setError(message(err)); setText(t); }
              }}>
                <input className="input grow" value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} placeholder="留言…" aria-label="留言" />
                <button type="submit" className="btn small-btn" disabled={!text.trim()}>送出</button>
              </form>
            )}
          </section>
          {error && <p className="error">{error}</p>}
          <p className="tv-tip">用 AirPlay／Chromecast「螢幕鏡像」，或者電腦接 HDMI 撳 ⛶ 全螢幕。</p>
        </aside>
      </div>
    </div>
  );
}

export default function LivePage({ user, groupId, sessionId }: { user: User; groupId: string; sessionId: string }) {
  const group = useGroup(groupId);
  const session = useSession(groupId, sessionId);
  const live = useSessionLive(groupId, sessionId, group.data, session.data);
  const chat = useChat(groupId, sessionId);
  const tables = useMemo(() => tvTablesOf(live.tables, live.computed), [live.tables, live.computed]);
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
  return (
    <LiveTv
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
    />
  );
}
