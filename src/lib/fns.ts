// Cloud Functions（callable）：測試通知、催找數。地區同伺服器一樣（多倫多 northamerica-northeast2）。
import { app } from '../firebase.ts';

export const FUNCTIONS_REGION = (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined)?.trim() || 'northamerica-northeast2';

async function call<I, O>(name: string, data: I): Promise<O> {
  if (!app) throw new Error('未設定 Firebase');
  const f = await import('firebase/functions');
  try {
    return (await f.httpsCallable<I, O>(f.getFunctions(app, FUNCTIONS_REGION), name)(data)).data;
  } catch (err) {
    const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code).replace('functions/', '') : '';
    // 伺服器自己寫嘅中文訊息照出；其他（英文）就講清楚係咩錯，方便報返嚟
    if (/[一-鿿]/.test(msg)) throw new Error(msg);
    const HINT: Record<string, string> = {
      internal: '伺服器出錯，或者呢個功能未開通',
      'not-found': '伺服器未有呢個功能（可能未部署好）',
      unavailable: '連唔到伺服器，請檢查網絡',
      'deadline-exceeded': '伺服器太耐冇回應',
      unauthenticated: '要重新登入',
      'permission-denied': '冇權限',
    };
    throw new Error(`${HINT[code] ?? '伺服器未能處理'}（${code || msg || name}）`);
  }
}

/** 超級管理員：發一個測試通知俾自己所有開咗通知嘅機 */
export const sendTestPush = () => call<Record<string, never>, { ok: number }>('testPush', {});

/** 超級管理員：打字發通知俾所有人（target = 'all'）或者一個牌友圈（target = 牌友圈 id） */
export const sendBroadcast = (m: { title: string; body: string; target: string }) =>
  call<typeof m, { people: number; ok: number }>('adminBroadcast', m);

/** 一齊執位輪住揀：通知輪到嗰個（伺服器自己睇輪到邊個，同一個人只通知一次） */
export const drawTurn = (m: { g: string; s: string }) => call<typeof m, { ok: number }>('drawTurn', m);

/** 有人夠拉：推播俾同枱／大局／牌友圈（跟大局設定） */
export const pullAlert = (m: { g: string; s: string; t: string; lines: string[] }) =>
  call<typeof m, { ok: number }>('pullAlert', m);

/** 約局：問未應嘅成員有冇人打（同一個約局 30 分鐘一次） */
export const pingMeetup = (g: string, m: string) =>
  call<{ g: string; m: string }, { people: number; ok: number }>('meetupPing', { g, m });

/** 催找數：收錢嘅人（或者超級管理員）提未轉錢嘅人；每筆 24 個鐘最多一次 */
export const remindPay = (items: { g: string; s: string; key: string }[]) =>
  call<{ items: typeof items }, { people: number; sent: number; skipped: number }>('remindPay', { items });

/** 催找數結果寫成一句 */
export function remindResult(r: { people: number; sent: number; skipped: number }): string {
  if (!r.people) return r.skipped ? '啱啱催過，遲啲再催' : '冇嘢要催';
  return r.sent ? '✓ 已催' : '已記低（佢未開通知）';
}
