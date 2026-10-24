// 收費版示範（/demo/paid）：揀自己同個圈嘅方案，試吓撞上限會見到乜，撳升級唔會真係收錢。
import { useState } from 'react';
import { LIMITS, PLANS, limitsOf, showLimit } from '../lib/plans.ts';
import type { Limits, Plan } from '../lib/plans.ts';
import { Sheet, TopBar } from '../ui.tsx';

interface Trial {
  key: string;
  label: string;
  /** 示範情境要用到幾多 */
  need: (l: Limits) => boolean;
  /** 撞到上限時講乜 */
  blocked: (l: Limits) => string;
  /** 升咗邊個方案就得 */
  fix: Plan;
}

const TRIALS: Trial[] = [
  { key: 'table', label: '今晚開第 3 張枱', need: (l) => l.tablesPerDay >= 3, blocked: (l) => `免費圈每日最多 ${l.tablesPerDay} 張枱。今晚已經有 ${l.tablesPerDay} 張打緊。`, fix: 'circle' },
  { key: 'member', label: '加第 13 個牌友入圈', need: (l) => l.members >= 13, blocked: (l) => `免費圈最多 ${l.members} 個成員。`, fix: 'circle' },
  { key: 'live', label: '呢個月第 3 次開 Live', need: (l) => l.livePerMonth >= 3, blocked: (l) => `免費版每個月 ${l.livePerMonth} 次 Live，今個月用晒。`, fix: 'plus' },
  { key: 'live3', label: 'Live 同時睇 3 張枱', need: (l) => l.liveTables >= 3, blocked: (l) => `免費版 Live 一次睇 ${l.liveTables} 張枱。`, fix: 'plus' },
  { key: 'old', label: '睇 4 個月前嗰局', need: (l) => l.historyDays > 120, blocked: (l) => `免費版睇得最近 ${l.historyDays} 日。舊記錄冇刪，升級就見返。`, fix: 'plus' },
  { key: 'group', label: '開第 3 個牌友圈', need: (l) => l.ownGroups >= 3, blocked: (l) => `免費版自己開得 ${l.ownGroups} 個圈（加入人哋嘅圈冇限）。`, fix: 'plus' },
  { key: 'skin', label: '用節日風格', need: (l) => l.allSkins, blocked: () => '節日同未解鎖嘅風格要升段位，或者用雀簿＋。', fix: 'plus' },
  { key: 'stats', label: '睇對手對賽、年度回顧', need: (l) => l.deepStats, blocked: () => '詳細統計係收費功能；基本戰績永遠免費。', fix: 'plus' },
];

const ROWS: { label: string; v: (l: Limits) => string }[] = [
  { label: '自己開幾多個圈', v: (l) => showLimit(l.ownGroups, ' 個') },
  { label: '每個圈成員', v: (l) => showLimit(l.members, ' 人') },
  { label: '每日幾多張枱', v: (l) => showLimit(l.tablesPerDay, ' 張') },
  { label: '睇舊記錄', v: (l) => (l.historyDays === Infinity ? '全部' : `最近 ${l.historyDays} 日`) },
  { label: 'Live 每月', v: (l) => showLimit(l.livePerMonth, ' 次') },
  { label: 'Live 同時睇', v: (l) => showLimit(l.liveTables, ' 張枱') },
  { label: '改雀壇名', v: (l) => (l.renamesPerMonth ? `每月 ${l.renamesPerMonth} 張券` : '靠成就') },
  { label: '全部風格', v: (l) => (l.allSkins ? '✓' : '靠段位') },
  { label: '詳細統計', v: (l) => (l.deepStats ? '✓' : '基本') },
];

const FREE_FOREVER = ['計番、入數、撤回', '記錄同戰績', '埋數同找數、收款資料', '約局、執位、是日終結', '加入幾多個圈都得'];

export default function PaidDemo() {
  const [mine, setMine] = useState<Plan>('free');
  const [circle, setCircle] = useState<Plan>('free');
  const [hit, setHit] = useState<Trial | null>(null);
  const [ok, setOk] = useState('');
  const [upgrade, setUpgrade] = useState<Plan | null>(null);
  const [yearly, setYearly] = useState(true);
  const l = limitsOf(mine, circle);

  const tryIt = (t: Trial) => {
    if (t.need(l)) { setOk(`✓ ${t.label}：得`); setTimeout(() => setOk(''), 1600); } else setHit(t);
  };
  const buy = (p: Plan) => {
    if (p === 'circle') setCircle('circle'); else setMine('plus');
    setUpgrade(null);
    setHit(null);
    setOk(`✓ 示範：已經升做 ${PLANS.find((x) => x.key === p)!.name}（冇收錢）`);
    setTimeout(() => setOk(''), 2200);
  };

  return (
    <main className="page paid-demo">
      <TopBar back="/demo/cases" title="收費版（示範）" />
      <p className="muted small">示範：唔會收錢，亦都唔會儲存。正式收費之前會再改。</p>

      <section className="panel stack">
        <h2>而家嘅方案</h2>
        <div className="field">
          <span>你自己</span>
          <div className="seg wide" role="group" aria-label="你自己嘅方案">
            {(['free', 'plus'] as Plan[]).map((p) => <button key={p} type="button" aria-pressed={mine === p} onClick={() => setMine(p)}>{PLANS.find((x) => x.key === p)!.name}</button>)}
          </div>
        </div>
        <div className="field">
          <span>呢個牌友圈</span>
          <div className="seg wide" role="group" aria-label="牌友圈嘅方案">
            {(['free', 'circle'] as Plan[]).map((p) => <button key={p} type="button" aria-pressed={circle === p} onClick={() => setCircle(p)}>{PLANS.find((x) => x.key === p)!.name}</button>)}
          </div>
        </div>
      </section>

      <section className="panel stack">
        <h2>試吓</h2>
        <div className="paid-trials">
          {TRIALS.map((t) => (
            <button key={t.key} type="button" className={`paid-trial${t.need(l) ? ' open' : ''}`} onClick={() => tryIt(t)}>
              <span aria-hidden="true">{t.need(l) ? '✓' : '🔒'}</span>{t.label}
            </button>
          ))}
        </div>
        {ok && <p className="ok" role="status">{ok}</p>}
      </section>

      <section className="panel stack">
        <h2>比較</h2>
        <div className="paid-table" role="table" aria-label="方案比較">
          <div className="paid-row head" role="row">
            <span role="columnheader" />
            {PLANS.map((p) => (
              <span key={p.key} role="columnheader" className={(p.key === 'free' && mine === 'free' && circle === 'free') || (p.key === 'plus' && mine === 'plus') || (p.key === 'circle' && circle === 'circle') ? 'on' : ''}>
                <b>{p.name}</b>
                <small>{p.monthly ? `HK$${p.monthly}／月` : '免費'}</small>
              </span>
            ))}
          </div>
          {ROWS.map((r) => (
            <div key={r.label} className="paid-row" role="row">
              <span role="rowheader">{r.label}</span>
              {PLANS.map((p) => <span key={p.key} role="cell">{r.v(LIMITS[p.key])}</span>)}
            </div>
          ))}
        </div>
        <small className="muted">牌友圈＋由圈主俾一份，圈入面全部人都受惠（人數、枱數、Live、舊記錄）；風格同改名券跟個人。</small>
        <div className="row">
          {mine !== 'plus' && <button type="button" className="btn" onClick={() => setUpgrade('plus')}>升級雀簿＋</button>}
          {circle !== 'circle' && <button type="button" className="btn plain" onClick={() => setUpgrade('circle')}>幫個圈升級</button>}
        </div>
      </section>

      <section className="panel stack">
        <h2>永遠免費</h2>
        <ul className="paid-free">{FREE_FOREVER.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>

      {hit && (
        <Sheet onClose={() => setHit(null)} label="撞到上限">
          <h2>🔒 {hit.label}</h2>
          <p>{hit.blocked(l)}</p>
          <button type="button" className="btn big" onClick={() => setUpgrade(hit.fix)}>
            升級{PLANS.find((x) => x.key === hit.fix)!.name}
          </button>
          <button type="button" className="textbtn center-text" onClick={() => setHit(null)}>遲啲先</button>
        </Sheet>
      )}

      {upgrade && (() => {
        const p = PLANS.find((x) => x.key === upgrade)!;
        return (
          <Sheet onClose={() => setUpgrade(null)} label={`升級${p.name}`}>
            <h2>升級{p.name}</h2>
            <p className="muted">{p.who}</p>
            <div className="seg wide" role="group" aria-label="收費周期">
              <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>每月 HK${p.monthly}</button>
              <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>每年 HK${p.yearly}</button>
            </div>
            {yearly && p.monthly && p.yearly && <small className="gain">平 {Math.round((1 - p.yearly / (p.monthly * 12)) * 100)}%</small>}
            <button type="button" className="btn big" onClick={() => buy(upgrade)}>示範：升級（唔會收錢）</button>
          </Sheet>
        );
      })()}
    </main>
  );
}
