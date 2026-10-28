import * as THREE from 'three'
import { outlinePoints } from './corners'

// 角の加工を「いま画面に見えている向き」で描くための計算。
// 板の中心の面（厚みの真ん中）の輪郭を、いまのカメラで画面に写した形を返す。
//
// corners.js の輪郭は x＝長さ方向、y＝幅方向（上が +）で、板の中では (x, 0, -y)。
// 4つの角（左上・右上・右下・左下）は板の中で
//   (-L/2, 0, -W/2) / (+L/2, 0, -W/2) / (+L/2, 0, +W/2) / (-L/2, 0, +W/2)

export function cornerLocal(board, i) {
  const hx = board.length / 2
  const hz = board.width / 2
  return [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]][i]
}

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()

function toScreen(board, local, camera) {
  _q.set(...(board.rotation || [0, 0, 0, 1]))
  _v.set(local[0], local[1], local[2]).applyQuaternion(_q)
  _v.x += board.position[0]; _v.y += board.position[1]; _v.z += board.position[2]
  _v.project(camera)
  // 画面の上が小さい y になるように
  return [_v.x, -_v.y]
}

// 戻り値: { ok, outline: [[x,y]...], corners: [[x,y] x4], facing }
//   ok=false … 板を真横から見ていて、面がほとんど見えない（絵が潰れる）
//   座標は画面の向きのまま（単位は正規化座標。比だけ使う）
export function projectBoardFace(board, camera) {
  if (!camera) return { ok: false }
  // 面の向き（板の中の +Y）と、カメラから板への向きの角度
  _q.set(...(board.rotation || [0, 0, 0, 1]))
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(_q)
  const toBoard = new THREE.Vector3(...board.position).sub(camera.position).normalize()
  const facing = Math.abs(normal.dot(toBoard))
  const outline = outlinePoints(board.length, board.width, board.corners, 8).map(([x, y]) => toScreen(board, [x, 0, -y], camera))
  const corners = [0, 1, 2, 3].map((i) => toScreen(board, cornerLocal(board, i), camera))
  return { ok: facing > 0.28, outline, corners, facing }
}

// 正規化座標の点の集まりを、幅W・高さHの枠に収まるように拡大して並べ直す。
// 縦横比はそのままにするが、細長く写ったとき（板を立てて斜めから見たときなど）は
// 角のボタンが重ならないよう、細いほうの向きだけ少し広げる（並びの順は変わらない）。
export function fitPoints(groups, W, H, pad, minW = 96, minH = 64) {
  const all = groups.flat()
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const dx = Math.max(maxX - minX, 1e-6), dy = Math.max(maxY - minY, 1e-6)
  // 画面の縦横比（正規化座標は縦横で長さが違う）を戻すため、呼び出し側で aspect をかけておく
  const fx = (W - pad * 2) / dx, fy = (H - pad * 2) / dy
  const s = Math.min(fx, fy)
  const sx = Math.max(s, Math.min(fx, minW / dx))
  const sy = Math.max(s, Math.min(fy, minH / dy))
  const ox = (W - dx * sx) / 2 - minX * sx
  const oy = (H - dy * sy) / 2 - minY * sy
  return groups.map((g) => g.map(([x, y]) => [ox + x * sx, oy + y * sy]))
}
