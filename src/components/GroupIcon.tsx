// 牌友圈 icon
/** 牌友圈 icon：emoji、細圖，或者冇就用個名頭一個字 */
export default function GroupIcon({ icon, name, size = 44 }: { icon?: string; name: string; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };
  if (icon && icon.startsWith('data:')) return <img className="group-icon img" src={icon} alt="" style={style} />;
  return <span className="group-icon" style={style} aria-hidden="true">{icon || Array.from(name)[0] || '雀'}</span>;
}

