// 家規頁：番數表／計分／埋數 三個分頁
import { useState } from 'react';
import type { ReactNode } from 'react';

type Tab = 'fans' | 'scoring' | 'settle';

export default function HouseRules({ fans, scoring, settle, initial = 'fans' }: { fans: ReactNode; scoring: ReactNode; settle: ReactNode; initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(() => {
    const h = typeof location !== 'undefined' ? location.hash.slice(1) : '';
    return h === 'scoring' || h === 'settle' || h === 'fans' ? h : initial;
  });
  const pick = (t: Tab) => {
    setTab(t);
    try { history.replaceState(history.state, '', `#${t}`); } catch { /* 唔緊要 */ }
  };
  return (
    <>
      <div className="seg wide sticky-seg" role="tablist" aria-label="家規分頁">
        <button type="button" role="tab" aria-selected={tab === 'fans'} aria-pressed={tab === 'fans'} onClick={() => pick('fans')}>番數表</button>
        <button type="button" role="tab" aria-selected={tab === 'scoring'} aria-pressed={tab === 'scoring'} onClick={() => pick('scoring')}>計分</button>
        <button type="button" role="tab" aria-selected={tab === 'settle'} aria-pressed={tab === 'settle'} onClick={() => pick('settle')}>埋數・水</button>
      </div>
      {tab === 'fans' ? fans : tab === 'scoring' ? scoring : settle}
    </>
  );
}
