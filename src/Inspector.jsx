import { useEffect, useState } from 'react'
import { getOrientation } from './geometry'

// 選んでいる板の設定パネル（右上）。
// 向きは「寝かせる／横に立てる／縦に立てる」を絵で選び、「上から見て90°回す」で向きを変える。
// （以前の「向き(Y軸)」「立てる(X軸)」は、押すとどちらに動くか分かりにくかったため置き換えた）

// 等角図で直方体を描く（w=左右, h=高さ, d=奥行き）
function IsoBox({ w, h, d, highlight }) {
  const c = Math.cos(Math.PI / 6)
  const s = 0.5
  const P = (x, y, z) => [40 + (x - z) * c, 46 + (x + z) * s - y]
  const pts = (arr) => arr.map((p) => p.join(',')).join(' ')
  const top = [P(0, h, 0), P(w, h, 0), P(w, h, d), P(0, h, d)]
  const left = [P(0, 0, d), P(w, 0, d), P(w, h, d), P(0, h, d)]
  const right = [P(w, 0, 0), P(w, 0, d), P(w, h, d), P(w, h, 0)]
  const stroke = highlight ? '#0017c1' : '#4d4d4d'
  return (
    <svg viewBox="0 0 80 64" width="64" height="52" aria-hidden="true">
      <polygon points={pts(top)} fill="#e8c08a" stroke={stroke} strokeWidth="1.2" />
      <polygon points={pts(left)} fill="#c08a55" stroke={stroke} strokeWidth="1.2" />
      <polygon points={pts(right)} fill="#a8713f" stroke={stroke} strokeWidth="1.2" />
    </svg>
  )
}

const ORIENTATIONS = [
  { kind: 'flat', label: '寝かせる', box: { w: 44, h: 5, d: 20 } },
  { kind: 'side', label: '横に立てる', box: { w: 44, h: 20, d: 5 } },
  { kind: 'upright', label: '縦に立てる', box: { w: 5, h: 40, d: 20 } },
]

export default function Inspector({ board, onChange, onRotate, onOrientation, onToggleLock, onDelete, onDeselect, checkLength }) {
  // たたむと見出しだけの細い帯になり、3Dの作業領域が広がる
  const [collapsed, setCollapsed] = useState(false)
  // 長さは入力中の値を別に持ち、使える長さのときだけ板に反映する
  // （以前は入力したそばから反映していたため、生材より長い板や材料が足りない板ができてしまっていた）
  const [lengthDraft, setLengthDraft] = useState('')
  const [lengthError, setLengthError] = useState('')
  const boardId = board?.id
  const boardLength = board?.length
  useEffect(() => {
    setLengthDraft(boardLength == null ? '' : String(boardLength))
    setLengthError('')
  }, [boardId, boardLength])
  if (!board) return null

  const orientation = getOrientation(board.rotation)

  const changeLength = (e) => {
    const text = e.target.value
    setLengthDraft(text)
    const v = Number(text)
    if (text === '' || !Number.isFinite(v) || v <= 0) {
      setLengthError('長さを入力してください')
      return
    }
    const err = checkLength ? checkLength(board.id, v) : ''
    setLengthError(err)
    if (!err) onChange(board.id, { length: v })
  }

  // 入力欄から離れたとき、使えない値が残っていたら今の板の長さに戻す（理由の表示は残す）
  const blurLength = () => {
    if (String(board.length) !== lengthDraft) setLengthDraft(String(board.length))
  }

  return (
    <div className="inspector" role="region" aria-label="選択中の板">
      <div className="inspector-header">
        <span className="inspector-title">選択中の板</span>
        {!board.locked && !collapsed && (
          <button className="lock-btn" onClick={() => onToggleLock(board.id)} aria-label="この板を固定する">
            固定
          </button>
        )}
        <button
          className="icon-btn small"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'パネルを開く' : 'パネルをたたむ'}
        >
          {collapsed ? '▼' : '▲'}
        </button>
        <button className="icon-btn" onClick={onDeselect} aria-label="選択をやめる">
          ×
        </button>
      </div>

      <div className="inspector-body" hidden={collapsed}>
      <p className="profile-readout">
        厚さ {board.thickness}mm × 幅 {board.width}mm × 長さ {board.length}mm
      </p>

      {board.locked ? (
        <>
          <div className="lock-notice" role="status">
            この板は固定されています。動かしたり、向きや長さを変えたりするときは、固定を解除してください。
          </div>
          <button className="dads-btn outline md wide" onClick={() => onToggleLock(board.id)}>
            固定を解除する
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label className="field-label" htmlFor="insp-length">
              長さ（mm）
            </label>
            <input
              id="insp-length"
              className="dads-input"
              type="number"
              inputMode="numeric"
              min="1"
              value={lengthDraft}
              onChange={changeLength}
              onBlur={blurLength}
              aria-invalid={lengthError ? 'true' : 'false'}
              aria-describedby={lengthError ? 'insp-length-error' : undefined}
            />
            {lengthError && (
              <p id="insp-length-error" className="field-error" role="alert">
                {lengthError}
              </p>
            )}
          </div>

          <div className="field">
            <span className="field-label">木目の向き</span>
            <div className="segmented" role="group" aria-label="木目の向き">
              <button
                className={board.grainAxis === 'X' ? 'is-on' : ''}
                aria-pressed={board.grainAxis === 'X'}
                onClick={() => onChange(board.id, { grainAxis: 'X' })}
              >
                長さ方向
              </button>
              <button
                className={board.grainAxis === 'Z' ? 'is-on' : ''}
                aria-pressed={board.grainAxis === 'Z'}
                onClick={() => onChange(board.id, { grainAxis: 'Z' })}
              >
                幅方向
              </button>
            </div>
          </div>

          <div className="field">
            <span className="field-label">板の向き</span>
            <div className="orient-grid" role="group" aria-label="板の向き">
              {ORIENTATIONS.map((o) => (
                <button
                  key={o.kind}
                  className={`orient-btn ${orientation === o.kind ? 'is-on' : ''}`}
                  aria-pressed={orientation === o.kind}
                  onClick={() => onOrientation(board.id, o.kind)}
                >
                  <IsoBox {...o.box} highlight={orientation === o.kind} />
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
            <button className="dads-btn outline md wide" onClick={() => onRotate(board.id, 'y', 90)}>
              ↺ 上から見て90°回す
            </button>
          </div>

          <button className="dads-btn text-danger md wide" onClick={() => onDelete(board.id)}>
            この板を削除する
          </button>
        </>
      )}
      </div>
    </div>
  )
}
