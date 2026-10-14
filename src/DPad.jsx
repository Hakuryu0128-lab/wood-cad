// 選んでいる板を1cm(10mm)ずつ動かすボタン（右下）。
// 前後左右は「いま画面に見えている向き」で動く（▲＝画面の奥へ、▶＝画面の右へ）。
// 視点を回しても、押した方向に動くようにするため。
const STEP = 10 // mm = 1cm

export default function DPad({ visible, onMove, onPlaceOnTop, onPlaceOnFloor }) {
  if (!visible) return null

  return (
    <div className="dpad" role="group" aria-label="板を1cmずつ動かす">
      <div className="dpad-label">1cmずつ動かす</div>
      <div className="dpad-grid">
        <div />
        <button className="dpad-btn" onClick={() => onMove(0, 0, STEP)} aria-label="奥へ動かす">▲</button>
        <div />
        <button className="dpad-btn" onClick={() => onMove(-STEP, 0, 0)} aria-label="左へ動かす">◀</button>
        <div className="dpad-center">前後<br />左右</div>
        <button className="dpad-btn" onClick={() => onMove(STEP, 0, 0)} aria-label="右へ動かす">▶</button>
        <div />
        <button className="dpad-btn" onClick={() => onMove(0, 0, -STEP)} aria-label="手前へ動かす">▼</button>
        <div />
      </div>
      <div className="dpad-row">
        <button className="dpad-btn wide" onClick={() => onMove(0, STEP, 0)}>上へ</button>
        <button className="dpad-btn wide" onClick={() => onMove(0, -STEP, 0)}>下へ</button>
      </div>
      <div className="dpad-row">
        <button className="dpad-btn wide small-text" onClick={onPlaceOnTop}>下の板の上に乗せる</button>
        <button className="dpad-btn wide small-text" onClick={onPlaceOnFloor}>床に下ろす</button>
      </div>
    </div>
  )
}
