// 牌友圈 icon
import TileFace, { tileOfIcon } from './TileFace.tsx';

/** 牌友圈 icon：麻雀牌（SVG，唔會好似 emoji 咁跌低咗）、emoji、細圖，或者冇就用個名頭一個字 */
export default function GroupIcon({ icon, name, size = 44 }: { icon?: string; name: string; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };
  if (icon && icon.startsWith('data:')) return <img className="group-icon img" src={icon} alt="" style={style} />;
  const tile = tileOfIcon(icon);
  if (tile) return <span className="group-icon tile-icon" style={style} aria-hidden="true"><TileFace code={tile} size={Math.round(size * 0.6)} /></span>;
  return <span className="group-icon" style={style} aria-hidden="true">{icon || Array.from(name)[0] || '雀'}</span>;
}
