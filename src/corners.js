// 板の角の加工（R＝丸め、C＝面取り）。
//
// 加工するのは「板の面（長さ × 幅）」の4つの角だけ。厚み側の縁は加工しない。
// 角の並びは、板の面を「長さを横・幅を縦」にして見た絵の
//   0: 左上  1: 右上  2: 右下  3: 左下
// 板の中での位置（BoxGeometry(length, thickness, width) = (X, Y, Z)）は
//   左 = -X / 右 = +X
//   上 = -Z / 下 = +Z
// 「横に立てる」（X軸まわりに90°）と -Z が上になるので、絵の上側の角が、立てたときの上の角になる。
//
// 1つの角の指定（無ければ null ＝加工しない）
//   { type: 'R', size }          … 半径 size mm の丸め
//   { type: 'C', size, angle }   … 横（長さ方向）に size mm、縦（幅方向）に size × tan(angle) mm を斜めに落とす
//                                  angle は横の辺から測った角度。45° なら縦横同じ（ふつうのC面取り）

export const CORNER_NAMES = ['左上', '右上', '右下', '左下']
export const R_DEFAULT = 20
export const C_DEFAULT = 10
export const ANGLE_DEFAULT = 45
export const ANGLE_MIN = 15
export const ANGLE_MAX = 75

export function hasCorners(board) {
  return Array.isArray(board?.corners) && board.corners.some((c) => c && (c.type === 'R' || c.type === 'C'))
}

// 角が削る量。lx＝横（長さ方向）、lz＝縦（幅方向）
export function cornerLegs(c) {
  if (!c) return { lx: 0, lz: 0 }
  if (c.type === 'R') return { lx: c.size, lz: c.size }
  if (c.type === 'C') {
    const a = ((c.angle ?? ANGLE_DEFAULT) * Math.PI) / 180
    return { lx: c.size, lz: c.size * Math.tan(a) }
  }
  return { lx: 0, lz: 0 }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

// 1つの角の指定が正しいか。問題なければ ''、あれば理由の文
export function checkCorner(c) {
  if (!c) return ''
  if (c.type !== 'R' && c.type !== 'C') return '加工の種類が違います'
  if (!Number.isFinite(c.size) || c.size <= 0) return c.type === 'R' ? 'Rの大きさを入力してください' : 'Cの大きさを入力してください'
  if (c.type === 'C') {
    if (!Number.isFinite(c.angle)) return '角度を入力してください'
    if (c.angle < ANGLE_MIN || c.angle > ANGLE_MAX) return `角度は${ANGLE_MIN}°〜${ANGLE_MAX}°にしてください`
  }
  return ''
}

// 板全体として成り立つか（同じ辺の両はしの加工が重ならないか）。問題なければ ''
export function checkCorners(corners, length, width) {
  if (!Array.isArray(corners)) return ''
  for (let i = 0; i < 4; i++) {
    const e = checkCorner(corners[i])
    if (e) return `${CORNER_NAMES[i]}：${e}`
  }
  const L = corners.map(cornerLegs)
  const EPS = 0.01
  // 上の辺（左上・右上）と下の辺（左下・右下）は長さ方向
  if (L[0].lx + L[1].lx > length + EPS) return `上の辺（長さ ${length}mm）に、左上と右上の加工が入りきりません`
  if (L[3].lx + L[2].lx > length + EPS) return `下の辺（長さ ${length}mm）に、左下と右下の加工が入りきりません`
  // 左の辺（左上・左下）と右の辺（右上・右下）は幅方向
  if (L[0].lz + L[3].lz > width + EPS) return `左の辺（幅 ${width}mm）に、左上と左下の加工が入りきりません`
  if (L[1].lz + L[2].lz > width + EPS) return `右の辺（幅 ${width}mm）に、右上と右下の加工が入りきりません`
  return ''
}

// 木取り表などに出す短い文。例「左上R20・右上R20」「左上C10（45°）」
export function cornerLabel(c) {
  if (!c) return ''
  if (c.type === 'R') return `R${round1(c.size)}`
  if (c.type === 'C') return (c.angle ?? ANGLE_DEFAULT) === 45 ? `C${round1(c.size)}` : `C${round1(c.size)}（${round1(c.angle)}°）`
  return ''
}
export function cornersSummary(corners) {
  if (!Array.isArray(corners)) return ''
  return corners
    .map((c, i) => (c ? CORNER_NAMES[i] + cornerLabel(c) : ''))
    .filter(Boolean)
    .join('・')
}

// 板の面の輪郭（2D）。x＝長さ方向（左が -length/2）、y＝幅方向で「上」を +y にとる（＝板の中の -Z）。
// 左上から時計回りに点を並べる。R は segments 個の折れ線で近似する。
export function outlinePoints(length, width, corners, segments = 10) {
  const hx = length / 2
  const hy = width / 2
  const pts = []
  // 各角：角の点、その角の「前の辺」側と「次の辺」側の向き
  const cornerDefs = [
    { x: -hx, y: hy, inX: 0, inY: -1, outX: 1, outY: 0 },   // 左上：左の辺から来て上の辺へ
    { x: hx, y: hy, inX: -1, inY: 0, outX: 0, outY: -1 },   // 右上：上の辺から来て右の辺へ
    { x: hx, y: -hy, inX: 0, inY: 1, outX: -1, outY: 0 },   // 右下：右の辺から来て下の辺へ
    { x: -hx, y: -hy, inX: 1, inY: 0, outX: 0, outY: 1 },   // 左下：下の辺から来て左の辺へ
  ]
  cornerDefs.forEach((d, i) => {
    const c = Array.isArray(corners) ? corners[i] : null
    const { lx, lz } = cornerLegs(c)
    if (!c || (lx <= 0 && lz <= 0)) {
      pts.push([d.x, d.y])
      return
    }
    // 来る辺と出る辺のどちらが横（x）か縦（y）かで、削る量を割り当てる
    const inLen = d.inX !== 0 ? lx : lz
    const outLen = d.outX !== 0 ? lx : lz
    const p1 = [d.x + d.inX * inLen, d.y + d.inY * inLen] // 来る辺の上の点（角から inLen 手前）
    const p2 = [d.x + d.outX * outLen, d.y + d.outY * outLen] // 出る辺の上の点
    if (c.type === 'C') {
      pts.push(p1, p2)
      return
    }
    // R：中心は角から内側に (r, r)
    const r = c.size
    const cx = d.x + d.inX * r + d.outX * r
    const cy = d.y + d.inY * r + d.outY * r
    const a1 = Math.atan2(p1[1] - cy, p1[0] - cx)
    let a2 = Math.atan2(p2[1] - cy, p2[0] - cx)
    // 時計回り（角度が減る向き）に回る
    while (a2 > a1) a2 -= Math.PI * 2
    for (let k = 0; k <= segments; k++) {
      const a = a1 + ((a2 - a1) * k) / segments
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  })
  return pts
}

// 輪郭の面積（mm²）。検査用
export function polygonArea(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}
