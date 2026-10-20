import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { createSession, guestId } from '../lib/data.ts';
import type { NewTable } from '../lib/data.ts';
import { useGroup, useMembers } from '../lib/live.ts';
import { go } from '../lib/router.tsx';
import { shuffle } from '../components/SeatDraw.tsx';
import { Hint, Loading, TopBar, message, clampName, useConfirm } from '../ui.tsx';

const WINDS = ['東', '南', '西', '北'];
const GUEST = '__guest__';

interface SeatPick {
  /** 成員 uid，或者 GUEST */
  value: string;
  guestName: string;
}

const emptySeat = (): SeatPick => ({ value: '', guestName: '' });

function today(): string {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function NewSession({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const members = useMembers(groupId);
  const [name, setName] = useState(`${today()} · 屋企局`);
  const [tables, setTables] = useState<SeatPick[][]>(() => [[{ value: user.uid, guestName: '' }, emptySeat(), emptySeat(), emptySeat()]]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmUI, ask] = useConfirm();

  const used = useMemo(() => new Set(tables.flat().map((s) => s.value).filter((v) => v && v !== GUEST)), [tables]);

  function setSeat(ti: number, si: number, patch: Partial<SeatPick>) {
    setTables((prev) => prev.map((t, i) => (i !== ti ? t : t.map((s, j) => (j !== si ? s : { ...s, ...patch })))));
  }

  function addTable() {
    if (tables.length >= 6) return;
    setTables((prev) => [...prev, [emptySeat(), emptySeat(), emptySeat(), emptySeat()]]);
  }

  function shuffleTable(ti: number) {
    setTables((prev) => prev.map((t, i) => (i !== ti ? t : shuffle(t))));
  }

  function removeTable(ti: number) {
    setTables((prev) => prev.filter((_, i) => i !== ti));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const memberName = (uid: string) => members.data.find((m) => m.uid === uid)?.name ?? '玩家';
    const out: NewTable[] = [];
    for (let ti = 0; ti < tables.length; ti++) {
      const seats: string[] = [];
      const names: Record<string, string> = {};
      for (let si = 0; si < 4; si++) {
        const s = tables[ti][si];
        if (!s.value) { setError(`第 ${ti + 1} 枱${WINDS[si]}位未選人`); return; }
        if (s.value === GUEST) {
          if (!s.guestName.trim()) { setError(`第 ${ti + 1} 枱${WINDS[si]}位訪客未有名稱`); return; }
          const id = guestId();
          seats.push(id);
          names[id] = s.guestName.trim();
        } else {
          seats.push(s.value);
          names[s.value] = memberName(s.value);
        }
      }
      out.push({ name: `第 ${ti + 1} 枱`, seats, names });
    }
    setBusy(true);
    try {
      const id = await createSession(user, groupId, name.trim() || today(), out, group.data?.rules ?? {});
      go(`/g/${groupId}/s/${id}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  if (!group.data) return <main className="page"><TopBar back={`/g/${groupId}`} /><Loading /></main>;

  return (
    <main className="page">
      <TopBar back={`/g/${groupId}`} title="開大局" />
      <form className="stack" onSubmit={submit}>
        <section className="panel">
          <label className="field">
            <span>大局名</span>
            <input id="session-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>
        </section>

        {tables.map((t, ti) => (
          <section key={ti} className="panel">
            <div className="between">
              <h2>第 {ti + 1} 枱</h2>
              <span className="row" style={{ gap: 4 }}>
                <button type="button" className="textbtn" onClick={() => shuffleTable(ti)}>掉位</button>
                {tables.length > 1 && <button type="button" className="textbtn loss" onClick={() => ask({ title: `刪除第 ${ti + 1} 枱`, detail: '呢張枱揀咗嘅人會清走。', run: () => removeTable(ti) })}>刪除</button>}
              </span>
            </div>
            <div className="seat-grid">
              {t.map((s, si) => (
                <div key={si} className="field">
                  <label htmlFor={`seat-${ti}-${si}`}>{WINDS[si]}{si === 0 ? '（首莊）' : ''}</label>
                  <select id={`seat-${ti}-${si}`} value={s.value} onChange={(e) => setSeat(ti, si, { value: e.target.value })}>
                    <option value="">選擇</option>
                    {members.data.map((m) => (
                      <option key={m.uid} value={m.uid} disabled={used.has(m.uid) && s.value !== m.uid}>{m.name}</option>
                    ))}
                    <option value={GUEST}>訪客（無帳戶）</option>
                  </select>
                  {s.value === GUEST && (
                    <input
                      id={`guest-${ti}-${si}`}
                      value={s.guestName}
                      onChange={(e) => setSeat(ti, si, { guestName: clampName(e.target.value) })}
                      placeholder="訪客名"
                      aria-label={`第 ${ti + 1} 枱${WINDS[si]}位訪客名`}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}

        {tables.length < 6 && (
          <button type="button" className="btn plain" onClick={addTable}>＋ 加一張枱</button>
        )}
        <button type="submit" className="btn big" disabled={busy}>開始</button>
        {error && <p className="error" role="alert">{error}</p>}
        {members.data.length < 4 && (
          <Hint>牌友圈有 {members.data.length} 位成員；未加入的人可先用訪客位。</Hint>
        )}
      </form>
      {confirmUI}
    </main>
  );
}
