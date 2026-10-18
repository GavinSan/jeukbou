// 超級管理員：問一次 Firestore（規則讀得到就係），之後記住
import { useEffect, useState } from 'react';
import { checkSuperAdmin } from './data.ts';

let cached: Promise<boolean> | null = null;
let cachedUid = '';

export function useSuperAdmin(uid: string | null): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!uid) { setOk(false); return; }
    if (!cached || cachedUid !== uid) { cachedUid = uid; cached = checkSuperAdmin(); }
    let alive = true;
    cached.then((v) => { if (alive) setOk(v); });
    return () => { alive = false; };
  }, [uid]);
  return ok;
}
