// 影相認牌計番（試驗，淨係超級管理員）：縮細張相，交俾 Cloud Function 叫 Claude 認牌，再對番數表計番。
import { app } from '../firebase.ts';
import type { FanTable } from './fanTable.ts';

const REGION = (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined)?.trim() || 'northamerica-northeast2';

export interface ScanPattern { name: string; option?: string; fan: number; why?: string }
export interface ScanResult {
  tiles: string[];
  flowers?: string[];
  exposed?: string[][];
  patterns: ScanPattern[];
  total: number;
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
  used?: number;
  limit?: number;
}

/** 縮細到長邊 1280px，轉 JPEG（快啲、平啲） */
export async function shrinkImage(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('讀唔到張相'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('處理唔到張相');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '';
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanHand(file: File, table: FanTable): Promise<ScanResult> {
  if (!app) throw new Error('未設定 Firebase');
  const image = await shrinkImage(file);
  const items = table.sections.filter((s) => s.kind === 'pick').flatMap((s) => s.items.map((it) => ({ name: it.name, value: it.value })));
  const f = await import('firebase/functions');
  const call = f.httpsCallable<{ image: string; mediaType: string; items: { name: string; value: string }[] }, ScanResult>(f.getFunctions(app, REGION), 'scanHand', { timeout: 70000 });
  try {
    const r = await call({ image, mediaType: 'image/jpeg', items });
    const d = r.data;
    return { ...d, tiles: Array.isArray(d.tiles) ? d.tiles : [], patterns: Array.isArray(d.patterns) ? d.patterns.filter((p) => p && typeof p.name === 'string') : [], total: Number(d.total) || 0 };
  } catch (err) {
    const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
    throw new Error(msg || '影相計番失敗');
  }
}
