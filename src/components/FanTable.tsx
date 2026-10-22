// 番數表：睇（可搜尋、撳開解說）、局主編輯、入番數時撳牌型加番
import type { ScanResult } from '../lib/scan.ts';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_FAN_TABLE, diffFanTable, glossaryOf, optionsOf } from '../lib/fanTable.ts';
import type { FanTableLog } from '../lib/data.ts';
import type { FanItem, FanSection, FanTable } from '../lib/fanTable.ts';
import { message, useConfirm } from '../ui.tsx';

/** 「明:5|暗:15」顯示成「明 5 · 暗 15」 */
export function valueText(value: string): string {
  const opts = optionsOf(value);
  if (!opts.length) return value;
  return opts.map((o) => (o.label ? `${o.label} ${o.fan}` : `${o.fan}`)).join(' · ');
}

const matches = (it: FanItem, q: string) => !q || it.name.includes(q) || (it.note ?? '').includes(q);

const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`ft-chev${open ? ' open' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
);

/** 番數：一粒粒似牌嘅數字；有幾款就並排（明 5｜暗 15） */
function Values({ value }: { value: string }) {
  const opts = optionsOf(value);
  if (!opts.length) return <span className="ft-text">{value}</span>;
  return (
    <span className="ft-vals">
      {opts.map((o, i) => (
        <span key={i} className="ft-val">
          {o.label && <small>{o.label}</small>}
          <b className="num">{o.fan}</b>
        </span>
      ))}
    </span>
  );
}

const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('zh-HK', { month: 'numeric', day: 'numeric' }) : '');

export function FanTableView({ table, canEdit, onSave, log }: {
  table: FanTable; canEdit: boolean; onSave?: (t: FanTable | null, changes: string[]) => Promise<void>; log?: FanTableLog | null;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // 最近（兩星期內）有人改過：有改嘅分類自動打開、改咗嗰項標「新」
  const recent = !!log?.at && Date.now() - log.at < 14 * 86400000 && log.changes.length > 0;
  const changed = useMemo(() => {
    const out = new Set<string>();
    if (!recent) return out;
    for (const sec of table.sections) for (const it of sec.items) {
      const n = it.name.trim();
      if (n && log!.changes.some((c) => c.startsWith(`新增 ${n} `) || c.startsWith(`${n} `))) out.add(n);
    }
    return out;
  }, [recent, log, table]);
  const [shut, setShut] = useState<Set<number>>(() => new Set([-1, ...table.sections.map((_, i) => i).filter((i) => !table.sections[i].items.some((it) => changed.has(it.name.trim())))]));
  const [editing, setEditing] = useState<FanTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (editing) {
    return (
      <FanTableEditor
        draft={editing}
        before={table}
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
            const cleaned: FanTable = {
              sections: editing.sections.map((sec) => ({ ...sec, items: sec.items.filter((it) => it.name.trim() || it.value.trim()) })),
              rules: editing.rules.map((r) => r.trim()).filter(Boolean),
            };
            await onSave(cleaned, diffFanTable(table, cleaned));
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
  const allOpen = shut.size === 0;
  const toggleSec = (i: number) => setShut((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className="stack ft">
      <div className="ft-tools">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋牌型，例如 清一色" aria-label="搜尋牌型" />
        {canEdit && onSave && <button type="button" className="btn plain" onClick={() => setEditing(structuredClone(table))}>編輯</button>}
      </div>
      <div className="between ft-meta">
        <span className="muted small">{log?.at ? `${log.byName || '局主'} 於 ${fmtDate(log.at)} 更新` : '撳牌型睇解說'}</span>
        {!query && (
          <button type="button" className="textbtn" onClick={() => setShut(allOpen ? new Set([-1, ...table.sections.map((_, i) => i)]) : new Set())}>
            {allOpen ? '全部收起' : '全部展開'}
          </button>
        )}
      </div>
      {recent && !query && (
        <div className="ft-news" role="status">
          <b>{log!.byName || '局主'} 最近改咗（{fmtDate(log!.at)}）</b>
          <ul>{log!.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      {table.sections.map((sec, si) => {
        const items = sec.items.filter((it) => matches(it, query));
        if (!items.length) return null;
        const expanded = !!query || !shut.has(si);
        return (
          <section key={si} className={`ft-sec${sec.kind === 'info' ? ' info' : ''}`}>
            <button type="button" className="ft-head" aria-expanded={expanded} onClick={() => !query && toggleSec(si)}>
              <span className="ft-title">{sec.title}</span>
              {sec.kind === 'info' && <span className="ft-tag">參考</span>}
              <span className="ft-count">{items.length} 項</span>
              {!query && <Chevron open={expanded} />}
            </button>
            {expanded && (
              <ul className="ft-items">
                {items.map((it, i) => {
                  const key = `${si}-${i}-${it.name}`;
                  const desc = glossaryOf(it.name);
                  const isOpen = open === key;
                  return (
                    <li key={key} className={changed.has(it.name.trim()) ? 'changed' : undefined}>
                      <button type="button" className="ft-item" aria-expanded={desc ? isOpen : undefined} disabled={!desc} onClick={() => setOpen(isOpen ? null : key)}>
                        <span className="ft-left">
                          <span className="ft-name">{it.name}{desc && <i className="ft-info" aria-hidden="true">i</i>}{changed.has(it.name.trim()) && <i className="ft-new-tag">新</i>}</span>
                          {it.note && <small className="ft-note">{it.note}</small>}
                        </span>
                        <Values value={it.value} />
                      </button>
                      {isOpen && desc && <p className="ft-desc">{desc}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {!query && table.rules.length > 0 && (
        <section className="ft-sec">
          <button type="button" className="ft-head" aria-expanded={!shut.has(-1)} onClick={() => toggleSec(-1)}>
            <span className="ft-title">牌例</span>
            <span className="ft-count">{table.rules.length} 條</span>
            <Chevron open={!shut.has(-1)} />
          </button>
          {!shut.has(-1) && <ol className="ft-rules">{table.rules.map((r, i) => <li key={i}>{r}</li>)}</ol>}
        </section>
      )}
    </div>
  );
}

function FanTableEditor({ draft, before, busy, error, onChange, onCancel, onReset, onSave }: {
  draft: FanTable; before: FanTable; busy: boolean; error: string; onChange: (t: FanTable) => void; onCancel: () => void; onReset: () => void; onSave: () => void;
}) {
  const [openSec, setOpenSec] = useState<number | null>(0);
  const [confirmUI, ask] = useConfirm();
  const changes = useMemo(() => diffFanTable(before, draft), [before, draft]);
  // 編輯期間收埋底部 tab，儲存列固定喺最底
  useEffect(() => {
    document.body.classList.add('editing-ft');
    return () => document.body.classList.remove('editing-ft');
  }, []);
  const setSection = (si: number, sec: FanSection) => onChange({ ...draft, sections: draft.sections.map((x, i) => (i === si ? sec : x)) });
  const setItem = (si: number, ii: number, it: FanItem | null) => {
    const sec = draft.sections[si];
    const items = it ? sec.items.map((x, i) => (i === ii ? it : x)) : sec.items.filter((_, i) => i !== ii);
    setSection(si, { ...sec, items });
  };
  const moveSection = (si: number, d: number) => {
    const j = si + d;
    if (j < 0 || j >= draft.sections.length) return;
    const list = [...draft.sections];
    [list[si], list[j]] = [list[j], list[si]];
    onChange({ ...draft, sections: list });
    setOpenSec(j);
  };
  return (
    <div className="stack ft ft-editing">
      <p className="muted small">番數寫「30」；有幾款就寫「明:30|暗:60」。撳分類展開修改。</p>
      {draft.sections.map((sec, si) => {
        const expanded = openSec === si;
        return (
          <section key={si} className="ft-sec">
            <div className="ft-head edit">
              <input className="input ft-title-input" value={sec.title} onChange={(e) => setSection(si, { ...sec, title: e.target.value })} aria-label="分類名稱" />
              <button type="button" className="ft-count-btn" aria-expanded={expanded} onClick={() => setOpenSec(expanded ? null : si)}>
                {sec.items.length} 項 <Chevron open={expanded} />
              </button>
            </div>
            {expanded && (
              <>
                <ul className="ft-items edit">
                  {sec.items.map((it, ii) => (
                    <li key={ii} className="ft-edit-row">
                      <input className="input" value={it.name} onChange={(e) => setItem(si, ii, { ...it, name: e.target.value })} aria-label="牌型" placeholder="牌型" />
                      <input className="input num" value={it.value} onChange={(e) => setItem(si, ii, { ...it, value: e.target.value })} aria-label="番數" placeholder="番" inputMode="text" />
                      <button type="button" className="iconbtn small" aria-label={`刪除 ${it.name || '此項'}`} onClick={() => ask({ title: '刪除牌型', detail: `「${it.name || '此項'}」會喺草稿刪除（未儲存之前可以撳取消還原）。`, run: () => setItem(si, ii, null) })}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                      <input className="input ft-note-input" value={it.note ?? ''} onChange={(e) => setItem(si, ii, { ...it, note: e.target.value || undefined })} aria-label="備註" placeholder="備註（可留空）" />
                    </li>
                  ))}
                </ul>
                <div className="row ft-sec-tools">
                  <button type="button" className="textbtn" onClick={() => setSection(si, { ...sec, items: [...sec.items, { name: '', value: '' }] })}>＋ 加一項</button>
                  <span className="grow" />
                  <button type="button" className="textbtn" disabled={si === 0} onClick={() => moveSection(si, -1)} aria-label="上移分類">上移</button>
                  <button type="button" className="textbtn" disabled={si === draft.sections.length - 1} onClick={() => moveSection(si, 1)} aria-label="下移分類">下移</button>
                  <button type="button" className="textbtn loss" onClick={() => ask({ title: '刪除分類', detail: `「${sec.title}」同入面 ${sec.items.length} 項牌型會喺草稿刪除。`, run: () => { onChange({ ...draft, sections: draft.sections.filter((_, i) => i !== si) }); setOpenSec(null); } })}>刪除分類</button>
                </div>
              </>
            )}
          </section>
        );
      })}
      <button type="button" className="btn plain" onClick={() => { onChange({ ...draft, sections: [...draft.sections, { title: '新分類', kind: 'pick', items: [{ name: '', value: '' }] }] }); setOpenSec(draft.sections.length); }}>＋ 加分類</button>
      <section className="ft-sec">
        <div className="ft-head"><span className="ft-title">牌例</span><span className="ft-count">每行一條</span></div>
        <textarea className="input ft-rules-input" rows={6} value={draft.rules.join('\n')} onChange={(e) => onChange({ ...draft, rules: e.target.value.split('\n') })} aria-label="牌例，每行一條" />
      </section>
      <button type="button" className="textbtn loss" onClick={onReset}>還原預設番數表</button>
      <div className="ft-savebar" role="region" aria-label="儲存番數表">
        <div className="ft-savebar-info">
          {error ? <span className="error">{error}</span> : <span className="muted small">{changes.length ? `${changes.length} 項修改，儲存後會通知同圈成員` : '未有修改'}</span>}
        </div>
        <div className="row">
          <button type="button" className="btn plain" onClick={onCancel}>取消</button>
          <button type="button" className="btn grow" disabled={busy || !changes.length} onClick={() => onSave()}>{busy ? '儲存中…' : '儲存'}</button>
        </div>
      </div>
      {confirmUI}
    </div>
  );
}

export interface Picked {
  key: string;
  name: string;
  fan: number;
}

/** 入番數時：撳牌型加埋，撳「用 N 番」 */
export function FanPicker({ table, onUse, onClose, scan }: {
  table: FanTable; onUse: (fan: number, picked: Picked[]) => void; onClose: () => void;
  /** 影相計番（試驗；淨係超級管理員有） */
  scan?: (file: File) => Promise<ScanResult>;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  async function onFile(f: File | undefined) {
    if (!f || !scan) return;
    setScanning(true); setScanErr(''); setResult(null);
    try { setResult(await scan(f)); } catch (err) { setScanErr(err instanceof Error ? err.message : '影相計番失敗'); } finally { setScanning(false); }
  }
  const scanPicked = (r: ScanResult): Picked[] => r.patterns.map((p, i) => ({ key: `scan-${i}`, name: `${p.name}${p.option ? `（${p.option}）` : ''}`, fan: Number(p.fan) || 0 }));
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
      {scan && (
        <div className="scan-box">
          <label className={`btn plain scan-btn${scanning ? ' busy' : ''}`}>
            {scanning ? '認緊牌…' : '📷 影相計番（試驗）'}
            <input type="file" accept="image/*" capture="environment" className="visually-hidden" disabled={scanning} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {scanErr && <p className="error small">{scanErr}</p>}
          {result && (
            <div className={`scan-result ${result.confidence ?? ''}`}>
              <div className="scan-tiles">{[...result.tiles, ...(result.flowers ?? [])].map((t, i) => <span key={i} className="scan-tile">{t}</span>)}</div>
              <ul className="scan-pats">
                {result.patterns.map((p, i) => <li key={i}><span className="grow">{p.name}{p.option ? `（${p.option}）` : ''}{p.why ? <small className="muted">　{p.why}</small> : null}</span><b className="num">{p.fan}</b></li>)}
              </ul>
              <div className="scan-foot">
                <span className="grow small muted">{result.confidence === 'low' ? '⚠️ 睇得唔係好清，請核對' : result.confidence === 'medium' ? '大致認到，請核對' : '認到'}{result.notes ? `・${result.notes}` : ''}{result.used ? `・今日 ${result.used}/${result.limit}` : ''}</span>
                <button type="button" className="btn plain small-btn" onClick={() => setPicked(scanPicked(result))}>照揀</button>
                <button type="button" className="btn small-btn" onClick={() => onUse(result.total, scanPicked(result))}>用 {result.total} 番</button>
              </div>
            </div>
          )}
        </div>
      )}
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋牌型" aria-label="搜尋牌型" />
      <div className="picker-scroll">
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
    </div>
  );
}
