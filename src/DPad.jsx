// 選択中の板を1cm(10mm)刻みで動かす方向ボタン群。
// タッチでの微調整をしやすくするための操作系。
export default function DPad({ visible, onMove }) {
  if (!visible) return null

  const STEP = 10 // mm = 1cm

  return (
    <div className="dpad">
      <div className="dpad-label">移動（1cmずつ）</div>
      <div className="dpad-grid">
        <div />
        <button className="dpad-btn" onClick={() => onMove(0, 0, -STEP)} aria-label="奥へ">▲</button>
        <div />

        <button className="dpad-btn" onClick={() => onMove(-STEP, 0, 0)} aria-label="左へ">◀</button>
        <div className="dpad-center">XZ</div>
        <button className="dpad-btn" onClick={() => onMove(STEP, 0, 0)} aria-label="右へ">▶</button>

        <div />
        <button className="dpad-btn" onClick={() => onMove(0, 0, STEP)} aria-label="手前へ">▼</button>
        <div />
      </div>

      <div className="dpad-updown">
        <button className="dpad-btn" onClick={() => onMove(0, STEP, 0)} aria-label="上へ">上 ⤴</button>
        <button className="dpad-btn" onClick={() => onMove(0, -STEP, 0)} aria-label="下へ">下 ⤵</button>
      </div>
    </div>
  )
}
