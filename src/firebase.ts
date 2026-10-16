// Firebase 設定由環境變數讀入（本機 .env.local，或者 GitHub 嘅 FIREBASE_WEB_CONFIG 變數），唔寫死喺 code 入面。
// 注意：網頁設定最終會喺網站 JS 入面見到，佢唔係密碼；資料靠 firestore.rules 保護。
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

function readConfig(): { config: Record<string, string> | null; error: string | null } {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG;
  if (!raw) return { config: null, error: '未設定 Firebase：要加 VITE_FIREBASE_CONFIG' };
  try {
    return { config: JSON.parse(raw), error: null };
  } catch {
    return { config: null, error: 'VITE_FIREBASE_CONFIG 唔係正確嘅 JSON' };
  }
}

const { config, error } = readConfig();

export const configError: string | null = error;
export const app: FirebaseApp | null = config ? initializeApp(config) : null;
export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Firestore | null = app ? getFirestore(app) : null;
