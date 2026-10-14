import * as THREE from 'three'

// 木目テクスチャを手続き的に生成する。
// 板は BoxGeometry(length, thickness, width) = (X, Y, Z) で、grainAxis は
//   'X' … 繊維が長さ方向に走る（ふつうの板）
//   'Z' … 繊維が幅方向に走る
// 繊維が走る面（板目の面・木端）には筋の木目、繊維を切った面（木口）には年輪を描く。
// v12（単体HTML版）の「木口が見て分かる」表現をReact版に移植したもの。

// 乱数を固定して、再描画のたびに模様が変わらないようにする
function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const MM_PER_TILE = 40 // テクスチャ1枚(128px)が何mm分か

function drawGrainCanvas() {
  const rand = seeded(7)
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#d8ac78'
  ctx.fillRect(0, 0, 128, 128)

  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(150, 105, 60, ${0.04 + rand() * 0.05})`
    const y = rand() * 128
    ctx.fillRect(0, y, 128, 6 + rand() * 10)
  }

  // 繊維の筋。すべて横方向（テクスチャのu方向）に流す
  ctx.strokeStyle = 'rgba(110, 70, 35, 0.45)'
  for (let i = 0; i < 16; i++) {
    const y = (i / 16) * 128 + (rand() * 4 - 2)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.bezierCurveTo(32, y + (rand() * 8 - 4), 96, y + (rand() * 8 - 4), 128, y)
    ctx.lineWidth = 0.6 + rand() * 1.6
    ctx.stroke()
  }
  return canvas
}

let baseTexture = null
function getBaseTexture() {
  if (!baseTexture) {
    baseTexture = new THREE.CanvasTexture(drawGrainCanvas())
    baseTexture.wrapS = THREE.RepeatWrapping
    baseTexture.wrapT = THREE.RepeatWrapping
    baseTexture.center.set(0.5, 0.5)
    baseTexture.colorSpace = THREE.SRGBColorSpace
  }
  return baseTexture
}

// 筋の木目。uMm/vMm は面のテクスチャu/v方向の実寸。
// rotate=true なら筋をv方向に流す。
function sideGrain(uMm, vMm, rotate) {
  const tex = getBaseTexture().clone()
  tex.needsUpdate = true
  const ru = Math.max(uMm / MM_PER_TILE, 0.1)
  const rv = Math.max(vMm / MM_PER_TILE, 0.1)
  tex.rotation = rotate ? Math.PI / 2 : 0
  // 回転するとテクスチャ座標の軸が入れ替わるので repeat も入れ替える
  tex.repeat.set(rotate ? rv : ru, rotate ? ru : rv)
  return tex
}

// 木口（年輪）。面の実寸（wMm × hMm）に合わせたキャンバスを作り、
// 板の下の方に中心がある年輪の一部が見える「板目材の木口」を描く。
const endCache = new Map()
function endGrain(wMm, hMm) {
  const key = `${Math.round(wMm)}x${Math.round(hMm)}`
  if (endCache.has(key)) return endCache.get(key)

  const PX_PER_MM = 4
  const w = Math.max(8, Math.min(1024, Math.round(wMm * PX_PER_MM)))
  const h = Math.max(8, Math.min(1024, Math.round(hMm * PX_PER_MM)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#c08a55'
  ctx.fillRect(0, 0, w, h)

  const rand = seeded(w * 31 + h)
  // 年輪の中心：板の下側の外（ふつうの板目材の木取り）
  const cx = w / 2
  const cy = h + Math.max(w, h) * 0.6
  const step = 3.2 * PX_PER_MM // 年輪の間隔 約3mm
  const maxR = Math.hypot(Math.max(cx, w - cx), cy) + step
  for (let r = step; r < maxR; r += step * (0.8 + rand() * 0.4)) {
    ctx.strokeStyle = `rgba(105, 60, 25, ${0.35 + rand() * 0.25})`
    ctx.lineWidth = 1 + rand() * 1.8
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  endCache.set(key, tex)
  return tex
}

// BoxGeometry の6面（px, nx, py, ny, pz, nz）それぞれに貼るテクスチャを返す。
// three.js の BoxGeometry では
//   px/nx 面: u = Z方向(width), v = Y方向(thickness)
//   py/ny 面: u = X方向(length), v = Z方向(width)
//   pz/nz 面: u = X方向(length), v = Y方向(thickness)
export function makeFaceTextures(grainAxis, length, thickness, width) {
  if (grainAxis === 'Z') {
    // 繊維が幅(Z)方向：Z面が木口
    const xFace = sideGrain(width, thickness, false) // u=Z なので筋はそのまま
    const yFace = sideGrain(length, width, true) // u=X なので90°回して Z 方向へ
    const zFace = endGrain(length, thickness)
    return [xFace, xFace, yFace, yFace, zFace, zFace]
  }
  // 繊維が長さ(X)方向：X面が木口
  const xFace = endGrain(width, thickness)
  const yFace = sideGrain(length, width, false)
  const zFace = sideGrain(length, thickness, false)
  return [xFace, xFace, yFace, yFace, zFace, zFace]
}
