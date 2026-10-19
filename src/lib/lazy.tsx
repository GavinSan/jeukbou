// 分開載入嘅頁：app 開住期間有新版本上咗，舊版嘅檔案會冇咗，載入就會失敗。
// 失敗就自動重新載入一次（攞新版）；再唔得就顯示錯誤同「重新載入」掣，唔會變白畫面。
import { Component, lazy } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';

const KEY = 'jeukbou-reload-at';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err) => {
      let last = 0;
      try { last = Number(sessionStorage.getItem(KEY) ?? 0); } catch { /* 唔緊要 */ }
      if (Date.now() - last > 30000) {
        try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* 唔緊要 */ }
        window.location.reload();
        return new Promise<{ default: T }>(() => undefined);
      }
      throw err;
    }),
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page narrow">
        <section className="panel">
          <h2>頁面載入唔到</h2>
          <p className="muted">可能係 app 啱啱更新咗。撳下面重新載入；如果仲係唔得，影低呢句話俾我哋：</p>
          <p className="error small">{this.state.error.message || String(this.state.error)}</p>
          <button type="button" className="btn big" onClick={() => window.location.reload()}>重新載入</button>
          <a className="textbtn" href="/">返主頁</a>
        </section>
      </main>
    );
  }
}
