// 番數表：睇（可搜尋、撳開解說）、局主編輯、入番數時撳牌型加番
import { useMemo, useState } from 'react';
import { DEFAULT_FAN_TABLE, glossaryOf, optionsOf } from '../lib/fanTable.ts';
import type { FanItem, FanSection, FanTable } from '../lib/fanTable.ts';
import { message } from '../ui.tsx';

/** 「明:5|暗:15」顯示成「明 5 · 暗 15」 */
export function valueText(value: string): string {
  const opts = optionsOf(value);
  if (!opts.length) return value;
  return opts.map((o) => (o.label ? `${o.label} ${o.fan}` : `${o.fan}`)).join(' · ');
}

const matches = (it: FanItem, q: string) => !q || it.name.includes(q) || (it.note ?? '').includes(q);

export function FanTableView({ table, canEdit, onSave }: { table: FanTable; canEdit: boolean; onSave?: (t: FanTable | null) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<FanTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (editing) {
    return (
      <FanTableEditor
        draft={editing}
        busy={busy}
        error={error}
        onChange={setEditing}
        onCancel={() => { setEditing(null); setError(''); }}
        onReset={() => setEditing(structuredClone(DEFAULT_FAN_TABLE))}
        onSave={async () => {
          if (!onSave) return;
          setBusy(true);
          setError('');
          try {
            await onSave(editing);
            setEditing(null);
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  const query = q.trim();
  return (
    <div className="stack">
      <div className="fan-tools">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋牌型，例如 清一色" aria-label="搜尋牌型" />
        {canEdit && onSave && <button type="button" className="btn plain" onClick={() => setEditing(structuredClone(table))}>編輯</button>}
      </div>
      {table.sections.map((sec) => {
        const items = sec.items.filter((it) => matches(it, query));
        if (!items.length) return null;
        return (
          <section key={sec.title} className="fan-sec">
            <h3>{sec.title}{sec.kind === 'info' && <small className="muted">　參考</small>}</h3>
            <ul className="list fan-list">
              {items.map((it, i) => {
                const key = `${sec.title}-${i}-${it.name}`;
                const desc = glossaryOf(it.name);
                const expanded = open === key;
                return (
                  <li key={key}>
                    <button type="button" className="fan-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                      <span className="grow">
                        <span className="fan-name">{it.name}</span>
                        {it.note && <small className="muted">{it.note}</small>}
                      </span>
                      <b className="num fan-val">{valueText(it.value)}</b>
                    </button>
                    {expanded && desc && <p className="fan-desc">{desc}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!query && table.rules.length > 0 && (
        <section className="fan-sec">
          <h3>牌例</h3>
          <ol className="list fan-rules">
            {table.rules.map((r, i) => <li key={i}>{r}</li>)}
          </ol>
        </section>
      )}
    </div>
  );
}

function FanTableEditor({ draft, busy, error, onChange, onCancel, onReset, onSave }: {
  draft: FanTable; busy: boolean; error: string; onChange: (t: FanTable) => void; onCancel: () => void; onReset: () => void; onSave: () => void;
}) {
  const setSection = (si: number, sec: FanSection) => onChange({ ...draft, sections: draft.sections.map((x, i) => (i === si ? sec : x)) });
  const setItem = (si: number, ii: number, it: FanItem | null) => {
    const sec = draft.sections[si];
    const items = it ? sec.items.map((x, i) => (i === ii ? it : x)) : sec.items.filter((_, i) => i !== ii);
    setSection(si, { ...sec, items });
  };
  return (
    <div className="stack">
      <p className="muted small">番數可寫「30」，或者有幾款就寫「明:30|暗:60」。入番數時可直接撳嚟加。</p>
      {draft.sections.map((sec, si) => (
        <section key={si} className="fan-sec">
          <input className="input fan-title-input" value={sec.title} onChange={(e) => setSection(si, { ...sec, title: e.target.value })} aria-label="分類名稱" />
          <ul className="list fan-list edit">
            {sec.items.map((it, ii) => (
              <li key={ii} className="fan-edit-row">
                <input className="input" value={it.name} onChange={(e) => setItem(si, ii, { ...it, name: e.target.value })} aria-label="牌型" placeholder="牌型" />
                <input className="input num" value={it.value} onChange={(e) => setItem(si, ii, { ...it, value: e.target.value })} aria-label="番數" placeholder="番" />
                <button type="button" className="iconbtn small" aria-label={`刪除 ${it.name}`} onClick={() => setItem(si, ii, null)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
                <input className="input fan-note-input" value={it.note ?? ''} onChange={(e) => setItem(si, ii, { ...it, note: e.target.value || undefined })} aria-label="備註" placeholder="備註（可留空）" />
              </li>
            ))}
          </ul>
          <button type="button" className="textbtn" onClick={() => setSection(si, { ...sec, items: [...sec.items, { name: '', value: '' }] })}>＋ 加一項</button>
        </section>
      ))}
      <button type="button" className="btn plain" onClick={() => onChange({ ...draft, sections: [...draft.sections, { title: '新分類', kind: 'pick', items: [] }] })}>＋ 加分類</button>
      <section className="fan-sec">
        <h3>牌例</h3>
        <textarea className="input" rows={6} value={draft.rules.join('\n')} onChange={(e) => onChange({ ...draft, rules: e.target.value.split('\n') })} aria-label="牌例，每行一條" />
      </section>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn grow" disabled={busy} onClick={() => onSave()}>儲存番數表</button>
        <button type="button" className="btn plain" onClick={onCancel}>取消</button>
      </div>
      <button type="button" className="textbtn loss" onClick={onReset}>還原預設番數表</button>
    </div>
  );
}

export interface Picked {
  key: string;
  name: string;
  fan: number;
}

/** 入番數時：撳牌型加埋，撳「用 N 番」 */
export function FanPicker({ table, onUse, onClose }: { table: FanTable; onUse: (fan: number, picked: Picked[]) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const total = picked.reduce((a, p) => a + p.fan, 0);
  const sections = useMemo(() => table.sections.filter((s) => s.kind === 'pick'), [table]);
  const query = q.trim();

  function toggle(key: string, name: string, fan: number) {
    setPicked((list) => {
      const exist = list.find((p) => p.key.split('#')[0] === key.split('#')[0]);
      if (exist && exist.key === key) return list.filter((p) => p !== exist);
      const rest = exist ? list.filter((p) => p !== exist) : list;
      return [...rest, { key, name, fan }];
    });
  }

  return (
    <div className="picker">
      <div className="picker-head">
        <button type="button" className="textbtn" onClick={onClose}>返回</button>
        <span className="picker-total"><b className="num">{total}</b> 番</span>
        <button type="button" className="btn" disabled={!picked.length} onClick={() => onUse(total, picked)}>用 {total} 番</button>
      </div>
      {picked.length > 0 && (
        <div className="picker-chosen">
          {picked.map((p) => (
            <button key={p.key} type="button" className="pill on" onClick={() => setPicked((l) => l.filter((x) => x !== p))}>{p.name} {p.fan} ✕</button>
          ))}
        </div>
      )}
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋牌型" aria-label="搜尋牌型" />
      {sections.map((sec) => {
        const items = sec.items.filter((it) => matches(it, query));
        if (!items.length) return null;
        return (
          <section key={sec.title} className="picker-sec">
            <h4>{sec.title}</h4>
            <div className="picker-grid">
              {items.map((it, i) => {
                const opts = optionsOf(it.value);
                const base = `${sec.title}-${i}`;
                return opts.length === 1 ? (
                  <button
                    key={base}
                    type="button"
                    className="pick"
                    aria-pressed={picked.some((p) => p.key === base)}
                    onClick={() => toggle(base, it.name, opts[0].fan)}
                  >
                    <span>{it.name}</span><b className="num">{opts[0].fan}</b>
                  </button>
                ) : (
                  <div key={base} className="pick multi">
                    <span>{it.name}</span>
                    <span className="pick-opts">
                      {opts.map((o, oi) => {
                        const k = `${base}#${oi}`;
                        return (
                          <button key={k} type="button" aria-pressed={picked.some((p) => p.key === k)} onClick={() => toggle(k, `${it.name}${o.label ? `（${o.label}）` : ''}`, o.fan)}>
                            {o.label ? `${o.label} ` : ''}<b className="num">{o.fan}</b>
                          </button>
                        );
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
