// 籌碼：黑 100、深藍 50、綠 25、淺藍 10、橙 5、粉紅 2、白 1

export interface ChipStack {
  value: number;
  count: number;
  color: string;
}

export const CHIPS: { value: number; color: string }[] = [
  { value: 100, color: '#1B1B1F' },
  { value: 50, color: '#1E3A8A' },
  { value: 25, color: '#15803D' },
  { value: 10, color: '#38BDF8' },
  { value: 5, color: '#F97316' },
  { value: 2, color: '#F472B6' },
  { value: 1, color: '#FFFFFF' },
];

/** 用最少籌碼表示一個數；位置有限，最多出 maxChips 隻，剩低嘅唔顯示（大概數就得） */
export function chipsFor(amount: number, maxChips = 5): ChipStack[] {
  const out: ChipStack[] = [];
  let left = Math.floor(Math.max(0, amount));
  let used = 0;
  for (const c of CHIPS) {
    if (used >= maxChips) break;
    const n = Math.min(Math.floor(left / c.value), maxChips - used);
    if (n > 0) {
      out.push({ value: c.value, count: n, color: c.color });
      left -= n * c.value;
      used += n;
    }
  }
  return out;
}
