/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase 網頁設定，成段 JSON（喺 .env.local 或者 GitHub 變數） */
  readonly VITE_FIREBASE_CONFIG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
