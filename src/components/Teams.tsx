// 預設 Group：例如兩公婆、一家人，每次埋數自動一齊計，唔使每次再加。
// 今晚冇嚟嘅人會自動唔計；得返一個人就分開計。
import { useState } from 'react';
import { teamActive } from '../lib/data.ts';
import type { TeamDoc } from '../lib/data.ts';
import { Hint, Sheet, message, useConfirm } from '../ui.tsx';

export interface TeamPerson {
  id: string;
  name: string;
}

export default function TeamsEditor({ teams, people, me, canDeleteAny, onCreate, onAccept, onDelete }: {
  teams: TeamDoc[];
  people: TeamPerson[];
  me: string;
  canDeleteAny: boolean;
  onCreate: (members: string[]) => Promise<void>;
  onAccept: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmUI, ask] = useConfirm();
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '（已離開）';
  const taken = new Set(teams.flatMap((t) => t.members));

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await task(); return true; } catch (err) { setError(message(err)); return false; } finally { setBusy(false); }
  }

  return (
    <section className="stack">
      <div className="section-head">
        <h2>預設 Group</h2>
        <button type="button" className="iconbtn add-btn" aria-label="新增預設 Group" onClick={() => { setPicked([]); setError(''); setAdding(true); }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      {teams.length ? (
        <ul className="list exp-list">
          {teams.map((t) => {
            const waiting = t.members.filter((m) => !t.accepted.includes(m));
            const active = teamActive(t);
            return (
              <li key={t.id} className="exp-row">
                <span className="grow exp-text">
                  <span>{t.members.map(nameOf).join(' + ')}</span>
                  <small className={active ? 'gain' : 'muted'}>{active ? '每次埋數自動一齊計' : `等待 ${waiting.map(nameOf).join('、')} 同意`}</small>
                </span>
                {waiting.includes(me) && <button type="button" className="btn small-btn" disabled={busy} onClick={() => run(() => onAccept(t.id))}>同意</button>}
                {(canDeleteAny || t.members.includes(me)) && (
                  <button type="button" className="textbtn loss" disabled={busy} onClick={() => ask({ title: '取消預設 Group', detail: `${t.members.map(nameOf).join(' + ')} 之後唔會再自動一齊計。`, action: '取消 Group', run: () => run(() => onDelete(t.id)) })}>取消</button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Hint className="muted">例如兩公婆或一家人：設定一次，之後每次埋數自動合埋計。當晚冇嚟嘅人唔會計，只得一個人就分開計。</Hint>
      )}
      {error && !adding && <p className="error">{error}</p>}
      {adding && (
        <Sheet onClose={() => setAdding(false)} label="新增預設 Group">
          <h2>新增預設 Group</h2>
          <Hint>{canDeleteAny ? '選兩位或以上成員。局主新增會即刻生效。' : '選兩位或以上成員。每位成員要按「同意」才生效。'}</Hint>
          <div className="choices">
            {people.map((p) => {
              const on = picked.includes(p.id);
              const off = taken.has(p.id);
              return (
                <button key={p.id} type="button" className="choice" aria-pressed={on} disabled={off} onClick={() => setPicked((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]))}>
                  <span className="ellipsis">{p.name}</span>
                  {off && <small>已在 Group</small>}
                </button>
              );
            })}
          </div>
          {error && <p className="error">{error}</p>}
          <button
            type="button"
            className="btn big"
            disabled={busy || picked.length < 2}
            onClick={async () => { if (await run(() => onCreate(picked))) setAdding(false); }}
          >{picked.length >= 2 ? `新增 ${picked.map(nameOf).join(' + ')}` : '選兩位或以上'}</button>
        </Sheet>
      )}
      {confirmUI}
    </section>
  );
}
