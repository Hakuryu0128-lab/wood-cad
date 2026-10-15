import { cm } from './space'

// 左上の「置き場所」パネル。入っているか／どれだけはみ出しているか、作品の大きさを常に表示する。
export default function SpacePanel({ space, check, onOpen }) {
  const size = check.size
  const over = check.overflow
  const isOver = space.enabled && (over.width > 0 || over.depth > 0 || over.height > 0)
  const overText = [
    over.width > 0 && `幅 ${cm(over.width)}cm`,
    over.depth > 0 && `奥行き ${cm(over.depth)}cm`,
    over.height > 0 && `高さ ${cm(over.height)}cm`,
  ]
    .filter(Boolean)
    .join('・')

  return (
    <button className={`side-card space-panel ${isOver ? 'is-over' : ''}`} onClick={onOpen}>
      <div className="stock-panel-title">置き場所 ›</div>
      {space.enabled ? (
        <>
          <div className="space-row">
            枠 {cm(space.width)}×{cm(space.depth)}×{cm(space.height)}cm
          </div>
          <div className={`space-status ${isOver ? 'over' : 'ok'}`}>
            {!size ? '板を置いてください' : isOver ? `枠より大きいです：${overText}` : '枠に収まる大きさです'}
          </div>
        </>
      ) : (
        <div className="space-row muted">まだ設定されていません</div>
      )}
      {size && (
        <div className="space-row">
          作品 {cm(size.width)}×{cm(size.depth)}×{cm(size.height)}cm
        </div>
      )}
      <div className="space-legend">幅×奥行き×高さ</div>
    </button>
  )
}
