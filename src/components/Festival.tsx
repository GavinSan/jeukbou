// 節日風格：背景慢慢飄嘅節日嘢（喺卡片後面，唔會遮字）、主頁祝福；超級管理員節日前提你開
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { festivalOf, upcomingFestival } from '../lib/festival.ts';
import { setFestival } from '../lib/data.ts';
import { message } from '../ui.tsx';

/** 背景裝飾（全 app） */
export function FestivalLayer({ festKey }: { festKey: string | null }) {
  const f = festivalOf(festKey);
  useEffect(() => {
    const root = document.documentElement;
    if (f) root.dataset.festival = f.key; else delete root.dataset.festival;
    return () => { delete root.dataset.festival; };
  }, [f]);
  if (!f) return null;
  return (
    <div className="fest-layer" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} style={{ '--x': `${(i * 41) % 100}%`, '--d': `${22 + ((i * 7) % 14)}s`, '--delay': `${-((i * 4.3) % 22)}s`, '--s': `${0.8 + ((i * 13) % 6) / 10}` } as CSSProperties}>{f.deco[i % f.deco.length]}</span>
      ))}
    </div>
  );
}

const greetYear = (key: string) => { const n = new Date(); return key === 'newyear' && n.getMonth() >= 10 ? n.getFullYear() + 1 : key === 'lny' && n.getMonth() >= 10 ? n.getFullYear() + 1 : n.getFullYear(); };

/** 主頁祝福 */
export function FestivalGreeting({ festKey }: { festKey: string | null }) {
  const f = festivalOf(festKey);
  if (!f) return null;
  return <p className={`fest-greet fest-${f.key}`}>{f.greet(greetYear(f.key))}</p>;
}

/** 超級管理員：節日前一個月提你開節日風格 */
export function FestivalReminder({ current }: { current: string | null }) {
  const up = upcomingFestival();
  const key = up ? `jeukbou-fest-dismiss-${up.f.key}-${up.at.getFullYear()}` : '';
  const [hidden, setHidden] = useState(() => { try { return !!key && localStorage.getItem(key) === '1'; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!up || hidden || current === up.f.key || up.days > 31) return null;
  const when = `${up.at.getMonth() + 1}月${up.at.getDate()}日`;
  return (
    <section className="nudge fest-remind" role="status">
      <span className="nudge-icon" aria-hidden="true">{up.f.deco[0]}</span>
      <span className="grow">
        <b>{up.f.name}（{when}）{up.days <= 0 ? '就係今日' : `仲有 ${up.days} 日`}</b>
        <small>超級管理員：要唔要開節日風格？全部人會見到節日裝飾同祝福。</small>
        {error && <small className="loss">{error}</small>}
      </span>
      <span className="nudge-acts">
        <button type="button" className="btn small-btn" disabled={busy} onClick={async () => { setBusy(true); try { await setFestival(up.f.key); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>開</button>
        <button type="button" className="textbtn" onClick={() => { setHidden(true); try { localStorage.setItem(key, '1'); } catch { /* 唔緊要 */ } }}>唔使</button>
      </span>
    </section>
  );
}
