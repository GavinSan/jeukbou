// 匯入舊紀錄（局主／超級管理員）：揀匯入檔 → 預覽 → 可以先刪晒現有大局 → 匯入
import { useState } from 'react';
import type { User } from 'firebase/auth';
import { importLegacy, parseLegacy } from '../lib/data.ts';
import type { LegacyFile } from '../lib/data.ts';
import { useSuperAdmin } from '../lib/admin.ts';
import { useGroup, useSessions } from '../lib/live.ts';
import { go } from '../lib/router.tsx';
import { Loading, TopBar, message } from '../ui.tsx';

export default function ImportPage({ user, groupId }: { user: User; groupId: string }) {
  const group = useGroup(groupId);
  const sessions = useSessions(groupId);
  const admin = useSuperAdmin(user.uid);
  const [file, setFile] = useState<LegacyFile | null>(null);
  const [wipe, setWipe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const back = `/g/${groupId}`;

  if (!group.data) return <main className="page"><TopBar back={back} /><Loading /></main>;
  const canImport = group.data.ownerId === user.uid || admin;
  const first = file?.sessions[0]?.date;
  const last = file?.sessions[file.sessions.length - 1]?.date;

  return (
    <main className="page">
      <TopBar back={back} title={<div className="stack tight"><h1>匯入舊紀錄</h1><span className="muted small">{group.data.name}</span></div>} />
      {!canImport ? <p className="muted">只有局主可以匯入。</p> : (
        <>
          <section className="panel">
            <h3>1. 揀匯入檔</h3>
            <p className="muted small">由 Google Sheet 轉出的 .json 檔。</p>
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                setError(''); setFile(null);
                const f = e.target.files?.[0];
                if (!f) return;
                try { setFile(parseLegacy(await f.text())); } catch (err) { setError(message(err)); }
              }}
            />
          </section>

          {file && (
            <section className="panel">
              <h3>2. 確認</h3>
              <div className="stat-grid">
                <div><small>來源</small><b>{file.source}</b></div>
                <div><small>場數</small><b className="num">{file.sessions.length}</b></div>
                <div><small>玩家</small><b className="num">{file.players.length}</b></div>
              </div>
              <p className="muted small">{first} 至 {last}</p>
              <label className="row">
                <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
                <span>先刪除此牌友圈現有 {sessions.data.length} 個大局（無法復原）</span>
              </label>
              <button
                type="button"
                className="btn big danger"
                disabled={busy}
                onClick={async () => {
                  if (wipe && sessions.data.length && !window.confirm(`會永久刪除 ${sessions.data.length} 個大局，然後匯入 ${file.sessions.length} 場。確定？`)) return;
                  setBusy(true); setError('');
                  try {
                    await importLegacy(groupId, user.uid, file, wipe, setProgress);
                    setProgress('完成！');
                    setTimeout(() => go(`/g/${groupId}/players`), 800);
                  } catch (err) {
                    setError(message(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? '處理中…' : wipe ? '刪除並匯入' : '匯入'}
              </button>
              {progress && <p className="ok" role="status">{progress}</p>}
            </section>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </main>
  );
}
