export default function Inspector({ board, onChange, onRotate, onDelete, onDeselect }) {
  if (!board) return null

  const changeLength = (e) => {
    const v = Number(e.target.value)
    if (!Number.isNaN(v) && v > 0) onChange(board.id, { length: v })
  }

  const toggleGrain = () => {
    onChange(board.id, { grainAxis: board.grainAxis === 'X' ? 'Z' : 'X' })
  }

  return (
    <div className="inspector">
      <div className="inspector-header">
        <span>選択中の板</span>
        <button className="icon-btn" onClick={onDeselect} aria-label="閉じる">×</button>
      </div>

      <p className="profile-readout">
        厚み {board.thickness}mm ・ 幅 {board.width}mm（固定）
      </p>

      <div className="field-grid">
        <label>
          長さ (mm)
          <input type="number" min="1" value={board.length} onChange={changeLength} />
        </label>
      </div>

      <div className="grain-row">
        <span>木目方向</span>
        <button className="btn-secondary" onClick={toggleGrain}>
          {board.grainAxis === 'X' ? '長さ方向 ↔' : '幅方向 ↕'}（タップで切り替え）
        </button>
      </div>

      <div className="rotate-row">
        <span>回転（90°ずつ）</span>
        <div className="rotate-btns">
          <button className="btn-secondary" onClick={() => onRotate(board.id, 'y', 90)}>
            ↻ 向き (Y軸)
          </button>
          <button className="btn-secondary" onClick={() => onRotate(board.id, 'x', 90)}>
            ⤾ 立てる (X軸)
          </button>
        </div>
      </div>

      {/*
        今後の機能追加予定（2026-07-15 メモ）:
        側面の壁になる板の上側の角を「丸める」「斜めに切り落とす（面取り）」加工を
        ここに設定項目として追加する。ジオメトリ側は BoxGeometry を
        角の丸め・面取りに対応した形状生成に置き換える必要がある。
      */}

      <button className="btn-danger" onClick={() => onDelete(board.id)}>
        この板を削除
      </button>
    </div>
  )
}
