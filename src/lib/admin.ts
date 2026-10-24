// 超級管理員：問一次 Firestore（規則讀得到就係），之後記住。
// 「使用超級管理員身份」（設定入面）閂咗：useSuperAdmin 當普通用家（唔郁伺服器權限，淨係介面）；
// useIsSuperAdmin 唔理開關（顯示開關、管理頁入口用）
import { useEffect, useState } from 'react';
import { checkSuperAdmin } from './data.ts';
import { usePrefs } from './prefs.ts';

let cached: Promise<boolean> | null = null;
let cachedUid = '';

function useRaw(uid: string | null): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!uid) { setOk(false); return; }
    if (!cached || cachedUid !== uid) { cachedUid = uid; cached = checkSuperAdmin(); }
    let alive = true;
    cached.then((v) => { if (alive) setOk(v); });
    return () => { alive = false; };
  }, [uid]);
  return ok;
}

/** 真係超級管理員（唔理開關） */
export function useIsSuperAdmin(uid: string | null): boolean {
  return useRaw(uid) === true;
}

/** 而家用緊超級管理員身份（開關開咗） */
export function useSuperAdmin(uid: string | null): boolean {
  const { adminMode } = usePrefs();
  return useRaw(uid) === true && adminMode;
}

/** 同上，但分得出「仲未知」（null） */
export function useSuperAdminState(uid: string | null): boolean | null {
  const { adminMode } = usePrefs();
  const v = useRaw(uid);
  return v === null ? null : v && adminMode;
}
