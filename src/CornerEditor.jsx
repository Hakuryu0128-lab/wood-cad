import { useEffect, useState } from 'react'
import {
  CORNER_NAMES, R_DEFAULT, C_DEFAULT, ANGLE_DEFAULT, ANGLE_MIN, ANGLE_MAX,
  checkCorners, cornerLabel, cornerLegs, outlinePoints, cornersSummary,
} from './corners'

// 板の角の加工（R＝丸め／C＝面取り）を決める欄。選択中の板のパネルの中に置く。
// 板の面を「長さを横・幅を縦」にした絵の4つの角をタップして選び、加工と大きさを決める。
// 絵の上側が、「横に立てる」にしたときに上になる側。
export default function CornerEditor({ board, onChange }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [draft, setDraft] = useState({ size: '', angle: '' })
  const [error, setError] = useState('')
  const corners = Array.isArray(board.corners) ? board.corners : [null, null, null, null]
  const cur = corners[sel] || null
  const curKey = JSON.stringify(cur)

  // 板・角・中身が変わったら、入力欄を今の値に戻す
  useEffect(() => {
    const c = curKey === 'null' ? null : JSON.parse(curKey)
    setDraft({ size: c ? String(c.size) : '', angle: c && c.type === 'C' ? String(c.angle ?? ANGLE_DEFAULT) : String(ANGLE_DEFAULT) })
    setError('')
  }, [board.id, sel, curKey])

  const apply = (next) => {
    const err = checkCorners(next, board.length, board.width)
    if (err) { setError(err); return false }
    setError('')
    onChange(board.id, { corners: next.some(Boolean) ? next : null })
    return true
  }
  const setCorner = (c) => {
    const next = corners.slice()
    next[sel] = c
    return apply(next)
  }
  const setType = (type) => {
    if (type === 'none') return setCorner(null)
    if (type === 'R') return setCorner({ type: 'R', size: cur?.type === 'R' ? cur.size : R_DEFAULT })
    return setCorner({ type: 'C', size: cur?.type === 'C' ? cur.size : C_DEFAULT, angle: cur?.type === 'C' ? cur.angle : ANGLE_DEFAULT })
  }
  const onNumber = (field, text) => {
    const d = { ...draft, [field]: text }
    setDraft(d)
    const size = Number(d.size)
    const angle = Number(d.angle)
    if (d.size === '' || !(size > 0)) { setError(cur.type === 'R' ? 'Rの大きさを入力してください' : 'Cの大きさを入力してください'); return }
    if (cur.type === 'C' && (d.angle === '' || !Number.isFinite(angle))) { setError('角度を入力してください'); return }
    setCorner(cur.type === 'R' ? { type: 'R', size } : { type: 'C', size, angle })
  }
  const copyToAll = () => apply([cur, cur, cur, cur].map((c) => (c ? { ...c } : null)))

  // 絵：板の縦横比に合わせて、横 200 × 縦 最大 110 に収める
  const W = 200, H = 110, PAD = 22
  const scale = Math.min((W - PAD * 2) / board.length, (H - PAD * 2) / board.width)
  const w = board.length * scale, h = board.width * scale
  const ox = (W - w) / 2, oy = (H - h) / 2
  const pts = outlinePoints(board.length, board.width, corners, 10)
    .map(([x, y]) => `${(ox + (x + board.length / 2) * scale).toFixed(1)},${(oy + (board.width / 2 - y) * scale).toFixed(1)}`)
    .join(' ')
  const cornerPos = [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h]]
  const summary = cornersSummary(board.corners)
  const legs = cornerLegs(cur)

  return (
    <div className="field corner-editor">
      <button className="corner-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="field-label">角の加工</span>
        <span className="corner-summary">{summary || 'なし'}</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="corner-figure" style={{ aspectRatio: `${W} / ${H}` }}>
            <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
              <rect x={ox} y={oy} width={w} height={h} fill="none" stroke="#b3b3b3" strokeDasharray="3 3" />
              <polygon points={pts} fill="#e8c08a" stroke="#4d4d4d" strokeWidth="1.2" />
              <text x={W / 2} y={oy + h / 2 + 4} fontSize="10" textAnchor="middle" fill="#4d4d4d">長さ {board.length}mm</text>
            </svg>
            {cornerPos.map(([x, y], i) => (
              <button
                key={i}
                className={`corner-hit ${i === sel ? 'is-on' : ''}`}
                style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
                aria-label={`${CORNER_NAMES[i]}の角${corners[i] ? '（' + cornerLabel(corners[i]) + '）' : ''}`}
                aria-pressed={i === sel}
                onClick={() => setSel(i)}
              >
                {corners[i] ? cornerLabel(corners[i]).replace(/（.*）/, '') : '・'}
              </button>
            ))}
          </div>
          <p className="corner-note">絵の上側が、「横に立てる」にしたときに上になる側です。</p>

          <div className="corner-row">
            <span className="corner-which">{CORNER_NAMES[sel]}の角</span>
            <div className="segmented three" role="group" aria-label={`${CORNER_NAMES[sel]}の角の加工`}>
              {[['none', 'なし'], ['R', 'R 丸め'], ['C', 'C 面取り']].map(([t, label]) => {
                const on = (cur ? cur.type : 'none') === t
                return (
                  <button key={t} className={on ? 'is-on' : ''} aria-pressed={on} onClick={() => setType(t)}>{label}</button>
                )
              })}
            </div>
          </div>

          {cur && (
            <div className="corner-inputs">
              <label className="corner-input">
                <span>{cur.type === 'R' ? '半径（mm）' : '横の長さ（mm）'}</span>
                <input className="dads-input" type="number" inputMode="decimal" min="1" value={draft.size}
                  aria-invalid={error ? 'true' : 'false'} onChange={(e) => onNumber('size', e.target.value)} />
              </label>
              {cur.type === 'C' && (
                <label className="corner-input">
                  <span>角度（°）</span>
                  <input className="dads-input" type="number" inputMode="decimal" min={ANGLE_MIN} max={ANGLE_MAX} value={draft.angle}
                    aria-invalid={error ? 'true' : 'false'} onChange={(e) => onNumber('angle', e.target.value)} />
                </label>
              )}
            </div>
          )}
          {cur?.type === 'C' && !error && (
            <p className="corner-note">横 {Math.round(legs.lx * 10) / 10}mm・縦 {Math.round(legs.lz * 10) / 10}mm を斜めに切り落とします（角度は横の辺から測ります。45°で縦横が同じ）。</p>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          {cur && (
            <button className="dads-btn outline sm wide" onClick={copyToAll}>この加工を4つの角すべてにする</button>
          )}
        </>
      )}
    </div>
  )
}
