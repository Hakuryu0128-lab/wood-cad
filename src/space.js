import { boardBox } from './geometry.js'

// 「置き場所の枠」：生徒が写真で測った、製作品を置きたい場所の大きさ（幅・奥行き・高さ）。
// 画面の中央（原点）に、床(y=0)から高さ分の半透明の箱として表示し、
// はみ出した板と枠を赤くする。材料の残り（在庫）と合わせて、
// 「場所」と「材料」の二つの制約が画面で見えるようにするためのもの。
//
// 単位は mm。width = X方向, depth = Z方向, height = Y方向。

export const DEFAULT_SPACE = { enabled: false, width: 400, depth: 250, height: 300 }

const TOLERANCE = 0.5 // mm: 計算誤差でぴったりの板が赤くならないように

export function normalizeSpace(s) {
  if (!s || typeof s !== 'object') return { ...DEFAULT_SPACE }
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d)
  return {
    enabled: !!s.enabled,
    width: num(s.width, DEFAULT_SPACE.width),
    depth: num(s.depth, DEFAULT_SPACE.depth),
    height: num(s.height, DEFAULT_SPACE.height),
  }
}

export function spaceBounds(space) {
  return {
    minX: -space.width / 2,
    maxX: space.width / 2,
    minY: 0,
    maxY: space.height,
    minZ: -space.depth / 2,
    maxZ: space.depth / 2,
  }
}

// 置かれている板全体の外形（作品の大きさ）。板がなければ null
export function designBox(boards) {
  if (!boards.length) return null
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const b of boards) {
    const bb = boardBox(b.length, b.thickness, b.width, b.rotation, b.position)
    box.minX = Math.min(box.minX, bb.min.x)
    box.maxX = Math.max(box.maxX, bb.max.x)
    box.minY = Math.min(box.minY, bb.min.y)
    box.maxY = Math.max(box.maxY, bb.max.y)
    box.minZ = Math.min(box.minZ, bb.min.z)
    box.maxZ = Math.max(box.maxZ, bb.max.z)
  }
  return box
}

// 枠と板を比べる。
// 戻り値:
//   outsideIds … はみ出している板の id の Set
//   overflow   … 幅・奥行き・高さそれぞれ、いちばん大きくはみ出している量(mm)。0ならはみ出しなし
//   size       … 作品の大きさ { width, depth, height }（板がなければ null）
export function checkSpace(space, boards) {
  const box = designBox(boards)
  const size = box ? { width: box.maxX - box.minX, depth: box.maxZ - box.minZ, height: box.maxY - box.minY } : null
  const result = { outsideIds: new Set(), overflow: { width: 0, depth: 0, height: 0 }, size }
  if (!space.enabled) return result

  const f = spaceBounds(space)
  for (const b of boards) {
    const bb = boardBox(b.length, b.thickness, b.width, b.rotation, b.position)
    const ox = Math.max(0, f.minX - bb.min.x, bb.max.x - f.maxX)
    const oz = Math.max(0, f.minZ - bb.min.z, bb.max.z - f.maxZ)
    const oy = Math.max(0, f.minY - bb.min.y, bb.max.y - f.maxY)
    if (ox > TOLERANCE || oy > TOLERANCE || oz > TOLERANCE) {
      result.outsideIds.add(b.id)
      if (ox > TOLERANCE) result.overflow.width = Math.max(result.overflow.width, ox)
      if (oz > TOLERANCE) result.overflow.depth = Math.max(result.overflow.depth, oz)
      if (oy > TOLERANCE) result.overflow.height = Math.max(result.overflow.height, oy)
    }
  }
  return result
}

export const cm = (mm) => {
  const v = Math.round(mm) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
