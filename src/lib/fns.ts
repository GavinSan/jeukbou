// Cloud Functions（callable）：測試通知、催找數。地區同伺服器一樣（us-central1）。
import { app } from '../firebase.ts';

export const FUNCTIONS_REGION = (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined)?.trim() || 'us-central1';

async function call<I, O>(name: string, data: I): Promise<O> {
  if (!app) throw new Error('未設定 Firebase');
  const f = await import('firebase/functions');
  try {
    return (await f.httpsCallable<I, O>(f.getFunctions(app, FUNCTIONS_REGION), name)(data)).data;
  } catch (err) {
    const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
    throw new Error(msg || '伺服器未能處理');
  }
}

/** 超級管理員：發一個測試通知俾自己所有開咗通知嘅機 */
export const sendTestPush = () => call<Record<string, never>, { ok: number }>('testPush', {});

/** 催找數：收錢嘅人（或者超級管理員）提未轉錢嘅人；每筆 6 個鐘最多一次 */
export const remindPay = (items: { g: string; s: string; key: string }[]) =>
  call<{ items: typeof items }, { people: number; sent: number; skipped: number }>('remindPay', { items });

/** 催找數結果寫成一句 */
export function remindResult(r: { people: number; sent: number; skipped: number }): string {
  if (!r.people) return r.skipped ? '啱啱催過，遲啲再催' : '冇嘢要催';
  return r.sent ? '✓ 已催' : '已記低（佢未開通知）';
}
