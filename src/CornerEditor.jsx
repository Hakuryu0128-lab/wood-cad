import { useEffect, useState } from 'react'
import {
  CORNER_NAMES, R_DEFAULT, C_DEFAULT, ANGLE_DEFAULT, ANGLE_MIN, ANGLE_MAX,
  checkCorners, cornerLabel, cornerLegs, outlinePoints,
} from './corners'
import { projectBoardFace, fitPoints } from './cornerView'

// 板の角の加工（R＝丸め／C＝面取り）を決める欄。選択中の板のパネルの中に置く。
//
// ★絵は「いま画面に見えている向き」で描く★（2026-10-28）
// 以前は板の形をいつも同じ向き（長さを横）で描いていたので、板を回したり立てたりすると
// 絵のどの角が3Dのどの角か分からなくなっていた。いまのカメラで板の面を写した形を描くので、
// 絵の右上の角は、画面で見て右上にある角になる。選んだ角は3Dの板の上でも光る。
// 板を真横から見ていて面が潰れるときだけ、板の形のまま（長さを横）で描く。
export default function CornerEditor({ board, onChange, embedded = false, sel: selProp, onSel, cameraRef }) {
  // タブの中に置くとき（embedded）は、たたまずに最初から開いておく
  const [open, setOpen] = useState(embedded)
  // 選んでいる角は、3Dの板を押して選ぶこともあるので外（App）に持つ。渡されなければ自分で持つ
  const [selLocal, setSelLocal] = useState(0)
  const sel = selProp ?? selLocal
  const setSel = onSel || setSelLocal
  // いまのカメラで写した板の形。カメラは毎フレーム動くので、少しずつ見に行く
  const [view, setView] = useState(null)
  const viewKey = JSON.stringify([board.length, board.width, board.rotation, board.position, board.corners])
  useEffect(() => {
    if (!open || !cameraRef) return undefined
    let last = ''
    const tick = () => {
      const cam = cameraRef.current
      const v = projectBoardFace(board, cam)
      const aspect = cam?.aspect || 1
      if (v.ok) {
        v.outline = v.outline.map(([x, y]) => [x * aspect, y])
        v.corners = v.corners.map(([x, y]) => [x * aspect, y])
      }
      const key = v.ok ? JSON.stringify([v.outline, v.corners].flat(2).map((n) => Math.round(n * 400))) : 'flat'
      if (key !== last) { last = key; setView(v.ok ? v : null) }
    }
    tick()
    const t = setInterval(tick, 150)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cameraRef, viewKey])
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

  // 絵：横 200 × 縦 110 の枠に収める
  const W = 200, H = 120, PAD = 22
  let outlinePts, cornerPos, flatBox = null
  if (view) {
    const [o, c] = fitPoints([view.outline, view.corners], W, H, PAD)
    outlinePts = o
    cornerPos = c
  } else {
    const scale = Math.min((W - PAD * 2) / board.length, (H - PAD * 2) / board.width)
    const w = board.length * scale, h = board.width * scale
    const ox = (W - w) / 2, oy = (H - h) / 2
    flatBox = { ox, oy, w, h }
    outlinePts = outlinePoints(board.length, board.width, corners, 10).map(([x, y]) => [ox + (x + board.length / 2) * scale, oy + (board.width / 2 - y) * scale])
    cornerPos = [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h]]
  }
  const pts = outlinePts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const doneCount = corners.filter(Boolean).length
  const legs = cornerLegs(cur)

  return (
    <div className="field corner-editor">
      {embedded ? (
        <p className="corner-head"><span className="field-label">角の加工</span><span className="corner-summary">{doneCount ? `${doneCount}か所` : 'なし'}</span></p>
      ) : (
        <button className="corner-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="field-label">角の加工</span>
          <span className="corner-summary">{doneCount ? `${doneCount}か所` : 'なし'}</span>
          <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button>
      )}
      {open && (
        <>
          <div className="corner-figure" style={{ aspectRatio: `${W} / ${H}` }}>
            <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
              {flatBox ? (
                <rect x={flatBox.ox} y={flatBox.oy} width={flatBox.w} height={flatBox.h} fill="none" stroke="#b3b3b3" strokeDasharray="3 3" />
              ) : (
                <polygon points={cornerPos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke="#b3b3b3" strokeDasharray="3 3" />
              )}
              <polygon points={pts} fill="#e8c08a" stroke="#4d4d4d" strokeWidth="1.2" />
              {flatBox && <text x={W / 2} y={flatBox.oy + flatBox.h / 2 + 4} fontSize="10" textAnchor="middle" fill="#4d4d4d">長さ {board.length}mm</text>}
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
          <p className="corner-note">
            {view
              ? '画面に見えている向きで描いています。角を押して選ぶと、3Dの板の上でも黄色く光ります。3Dの板の角を押して選ぶこともできます。'
              : '板を真横から見ているので、板の形のまま（長さを横）で描いています。角を押すと、3Dの板の上で黄色く光ります。'}
          </p>

          <div className="corner-row">
            <span className="corner-which"><span className="corner-dot" aria-hidden="true" />選んだ角（黄色く光っている角）</span>
            <div className="segmented three" role="group" aria-label="選んだ角の加工">
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
                <span>{cur.type === 'R' ? '半径（mm）' : '長さ方向（mm）'}</span>
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
            <p className="corner-note">板の長さ方向に {Math.round(legs.lx * 10) / 10}mm、幅方向に {Math.round(legs.lz * 10) / 10}mm を斜めに切り落とします（角度は長さ方向の辺から測ります。45°で両方が同じ）。</p>
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
