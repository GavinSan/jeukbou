import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 每次 build 一個版本號：app 會定時睇 /version.json，有新版本就提示或者自動更新
const BUILD_ID = new Date().toISOString();

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // Firebase 同 React 分開打包：改 app 時佢哋唔使重新下載
        manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'], react: ['react', 'react-dom'] },
      },
    },
  },
});
