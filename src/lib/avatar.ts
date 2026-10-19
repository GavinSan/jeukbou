// 頭像：喺手機度裁成正方形、縮細（192px JPEG，大約 10–20KB），直接存喺資料庫，唔使另外開檔案儲存
export async function toAvatar(file: File, size = 192): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('請選擇相片');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('讀不到這張相片，請試另一張'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('此瀏覽器不支援');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    let q = 0.86;
    let out = canvas.toDataURL('image/jpeg', q);
    while (out.length > 60000 && q > 0.4) {
      q -= 0.12;
      out = canvas.toDataURL('image/jpeg', q);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
