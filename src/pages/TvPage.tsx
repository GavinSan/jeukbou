// 舊連結 /tv/牌友圈/大局/枱：而家電視模式同 Live 一樣，轉去 Live 淨睇呢張枱
import { useEffect } from 'react';
import type { User } from 'firebase/auth';
import { go } from '../lib/router.tsx';
import { Loading } from '../ui.tsx';

export default function TvPage({ groupId, sessionId, tableId }: { user: User; groupId: string; sessionId: string; tableId: string }) {
  useEffect(() => { go(`/live/${groupId}/${sessionId}?t=${tableId}`); }, [groupId, sessionId, tableId]);
  return <main className="page"><Loading /></main>;
}
