import { boardBox } from './geometry.js'

// 「置き場所の枠」：生徒が写真で測った、製作品を置きたい場所の大きさ（幅・奥行き・高さ）。
// 枠は「作品の真ん中」に合わせて動く（作品の外形の中心＝枠の中心、作品の底＝枠の底）。
// そのため、作品が画面のどこにあっても、判定は「作品の大きさが枠に収まるか」だけで決まる。
// （2026-10-15 変更：以前は画面中央に固定した枠からはみ出したかで判定していたため、
//   大きさは十分小さくても、作品全体が少しずれているだけで「はみ出し」になっていた）
// 大きさがオーバーした方向は、両端の板が枠から出るので、その板と枠を赤くする。
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

// 枠の位置（作品の外形に合わせる）。板がなければ原点・床
export function spaceBounds(space, box = null) {
  const cx = box ? (box.minX + box.maxX) / 2 : 0
  const cz = box ? (box.minZ + box.maxZ) / 2 : 0
  const bottom = box ? box.minY : 0
  return {
    minX: cx - space.width / 2,
    maxX: cx + space.width / 2,
    minY: bottom,
    maxY: bottom + space.height,
    minZ: cz - space.depth / 2,
    maxZ: cz + space.depth / 2,
    center: [cx, bottom + space.height / 2, cz],
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

// 枠と作品を比べる。
// 戻り値:
//   outsideIds … 枠から出ている板の id の Set（大きさがオーバーしたときだけ出る）
//   overflow   … 幅・奥行き・高さそれぞれ、作品が枠より何mm大きいか。0なら収まっている
//   size       … 作品の大きさ { width, depth, height }（板がなければ null）
//   frame      … 枠の位置（spaceBounds の戻り値）
export function checkSpace(space, boards) {
  const box = designBox(boards)
  const size = box ? { width: box.maxX - box.minX, depth: box.maxZ - box.minZ, height: box.maxY - box.minY } : null
  const frame = spaceBounds(space, box)
  const result = { outsideIds: new Set(), overflow: { width: 0, depth: 0, height: 0 }, size, frame }
  if (!space.enabled || !size) return result

  const over = (v) => (v > TOLERANCE ? v : 0)
  result.overflow = {
    width: over(size.width - space.width),
    depth: over(size.depth - space.depth),
    height: over(size.height - space.height),
  }
  for (const b of boards) {
    const bb = boardBox(b.length, b.thickness, b.width, b.rotation, b.position)
    const out =
      frame.minX - bb.min.x > TOLERANCE ||
      bb.max.x - frame.maxX > TOLERANCE ||
      frame.minZ - bb.min.z > TOLERANCE ||
      bb.max.z - frame.maxZ > TOLERANCE ||
      bb.max.y - frame.maxY > TOLERANCE
    if (out) result.outsideIds.add(b.id)
  }
  return result
}

export const cm = (mm) => {
  const v = Math.round(mm) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
