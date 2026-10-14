import * as THREE from 'three'

// 板は position + quaternion(ワールド回転) で管理する。
// quaternion は [x, y, z, w] の配列。単位回転は [0, 0, 0, 1]。
export const IDENTITY_QUATERNION = [0, 0, 0, 1]

// 板を回転させたときに、一番低い点がグリッド(y=0)にちょうど接するような
// position.y を計算する。板は原点中心のBoxとして扱う。
export function groundOffsetY(length, thickness, width, quaternion) {
  const box = boardBox(length, thickness, width, quaternion, [0, 0, 0])
  return -box.min.y
}

// 1cm(10mm)グリッドへスナップ
export function snapToGrid(value, step = 10) {
  return Math.round(value / step) * step
}

// 指定した寸法・回転(quaternion)・位置の板のワールド空間バウンディングボックスを計算する
export function boardBox(length, thickness, width, quaternion, position) {
  const geo = new THREE.BoxGeometry(length, thickness, width)
  const mesh = new THREE.Mesh(geo)
  mesh.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  mesh.position.set(position[0], position[1], position[2])
  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(mesh)
  geo.dispose()
  return box
}

// 90度刻みの「ワールド座標基準」の回転を現在のクォータニオンに合成する。
// 常に world の X/Y/Z 軸まわりに回すので、板を立てた後でも
// 「向きを変える(Y)」「立てる/寝かせる(X)」の効果が毎回同じになり、
// 組み合わせればどの向きにも到達できる。
export function rotateQuaternion(quaternion, axis, deg) {
  const axisVec =
    axis === 'x' ? new THREE.Vector3(1, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  const delta = new THREE.Quaternion().setFromAxisAngle(axisVec, THREE.MathUtils.degToRad(deg))
  const current = new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3])
  const next = new THREE.Quaternion().multiplyQuaternions(delta, current) // ワールド空間で回転（前から掛ける）
  return [next.x, next.y, next.z, next.w]
}

const MIN_OVERLAP = 5 // mm: これ以上のオーバーラップがないと「面がつながっている」とみなさない

// 面を合わせる軸(axis)と直交する「平行軸」方向で、もっとも近い角同士のペアを探す。
// 見つかればその軸方向にも動かす量(d)を返す。見つからなければ null（＝面の途中で接合）。
function findCornerAlong(aMin, aMax, bMin, bMax, threshold) {
  const pairs = [bMin - aMin, bMax - aMin, bMin - aMax, bMax - aMax]
  let bestD = null
  let bestDist = Infinity
  for (const d of pairs) {
    const dist = Math.abs(d)
    if (dist < threshold && dist < bestDist) {
      bestDist = dist
      bestD = d
    }
  }
  return bestD
}

// ドラッグ中の板が、他の板と「面」で実際に重なり合う位置に来ているかを判定する。
// 角同士の距離だけで判定すると、斜め向かいのような物理的に接合できない位置でも
// 吸い付いてしまうため、エッジ（面）の重なり幅を必須条件にする。
// さらに、面が合う軸と垂直な「平行軸」方向でも近くの角同士がある場合はそちらに
// 揃えてぴったり角で接続させる（近い角がなければ、面の途中でもそのまま接合できる）。
//
// draggedSpec: { length, thickness, width, rotation(quaternion) }
// candidatePos: [x, y, z]（スナップ前の生の位置）
// others: [{ length, thickness, width, rotation(quaternion), position }, ...]
//
// 戻り値: { best, nearest }
//   best    … 実際にスナップしてよい候補（gapがしきい値未満）。{ axis, gap, corner } の形。なければ null
//   nearest … 表示用の、もっとも近い有効な面ペア。なければ null
export function findFaceSnap(draggedSpec, candidatePos, others, snapThreshold = 15) {
  const A = boardBox(draggedSpec.length, draggedSpec.thickness, draggedSpec.width, draggedSpec.rotation, candidatePos)

  let best = null
  let nearest = null

  for (const other of others) {
    const B = boardBox(other.length, other.thickness, other.width, other.rotation, other.position)
    // 側面どうしでくっつくのは、高さが実際に重なっている（横に並んでいる）板だけ。
    // 以前は上下に20mmの余裕を持たせていたため、壁の上に乗せた天板まで「横に並んでいる」と
    // みなされ、天板の端が壁の内側の面に吸い付いて横にずれていた（2026-10-15 修正）。
    const yOverlap = Math.min(A.max.y, B.max.y) - Math.max(A.min.y, B.min.y)
    if (yOverlap <= MIN_OVERLAP) continue

    const candidates = []

    // X方向の面を合わせる（Zがある程度重なっている場合のみ）。平行軸はZ。
    const zOverlap = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z)
    if (zOverlap > MIN_OVERLAP) {
      candidates.push({ axis: 'x', gap: B.min.x - A.max.x, corner: findCornerAlong(A.min.z, A.max.z, B.min.z, B.max.z, snapThreshold) })
      candidates.push({ axis: 'x', gap: B.max.x - A.min.x, corner: findCornerAlong(A.min.z, A.max.z, B.min.z, B.max.z, snapThreshold) })
    }

    // Z方向の面を合わせる（Xがある程度重なっている場合のみ）。平行軸はX。
    const xOverlap = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x)
    if (xOverlap > MIN_OVERLAP) {
      candidates.push({ axis: 'z', gap: B.min.z - A.max.z, corner: findCornerAlong(A.min.x, A.max.x, B.min.x, B.max.x, snapThreshold) })
      candidates.push({ axis: 'z', gap: B.max.z - A.min.z, corner: findCornerAlong(A.min.x, A.max.x, B.min.x, B.max.x, snapThreshold) })
    }

    for (const c of candidates) {
      const absGap = Math.abs(c.gap)
      const entry = { axis: c.axis, gap: c.gap, absGap, corner: c.corner }
      if (!nearest || absGap < nearest.absGap) nearest = entry
      if (absGap < snapThreshold && (!best || absGap < best.absGap)) best = entry
    }
  }

  return { best, nearest }
}

// 上下(Y軸)方向のスナップ：真上/真下にある板の上面・底面にぴったり乗せる。
// 十字キーは1cm(10mm)刻みでしか動かせないため、ぴったり乗る高さがちょうど10mmの
// 倍数でないと永遠にぴったり合わない問題が起きる。近づいたときはその板の面に
// 吸い付かせることで、1cm刻みでもきっちり面一に揃えられるようにする。
//
// fromY・direction を指定すると、「今動いている向きより手前（すでに離れた面）」には
// 吸い付かせないようにする。これがないと、いったん低い面（土台など）にスナップした後、
// さらに上へ動かそうとしても毎回その面に引き戻されてしまい、上の面（壁の上端など）へ
// 辿り着けなくなる。
//
// 戻り値: 動かすべき量(Yに加算する値)。近くに乗せられる面がなければ null。
export function findVerticalSnap(draggedSpec, candidatePos, others, snapThreshold = 15, fromY = null, direction = 0) {
  const A = boardBox(draggedSpec.length, draggedSpec.thickness, draggedSpec.width, draggedSpec.rotation, candidatePos)

  let best = null
  let bestAbs = Infinity

  for (const other of others) {
    const B = boardBox(other.length, other.thickness, other.width, other.rotation, other.position)

    // 真上/真下にあると言えるだけの、footprint(X・Z)の重なりが必要
    const xOverlap = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x)
    const zOverlap = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z)
    if (xOverlap <= MIN_OVERLAP || zOverlap <= MIN_OVERLAP) continue

    const candidates = [
      B.min.y - A.max.y, // Aの上面をBの底面に合わせる（Aの下にBが乗る）
      B.max.y - A.min.y, // Aの底面をBの上面に合わせる（Aの上に乗せる）
    ]
    for (const gap of candidates) {
      const absGap = Math.abs(gap)
      if (absGap >= snapThreshold) continue
      if (direction !== 0 && fromY != null) {
        const target = candidatePos[1] + gap
        // 進行方向にきちんと前進していない（＝今いる面や後ろの面）場合は吸い付かない。
        // これがないと、一度スナップした面からもう一度動かそうとしても同じ面に
        // 引き戻され続けてしまう。
        if ((target - fromY) * direction < 0.5) continue
      }
      if (absGap < bestAbs) {
        bestAbs = absGap
        best = gap
      }
    }
  }

  return best
}

// 上に乗せた板の端そろえ：ドラッグ中の板が別の板の上にちょうど乗っている（または真下にくっついている）とき、
// 上の板の端を下の板の外側の面にそろえる（天板の端を側板の外面と面一にする「橋渡し」用）。
// X方向・Z方向それぞれで、しきい値以内のいちばん近いそろえ位置を探す。
// 戻り値: { dx, dz }（そろえる量。そろえる所がなければ null）
export function findStackAlign(draggedSpec, candidatePos, others, snapThreshold = 15) {
  const A = boardBox(draggedSpec.length, draggedSpec.thickness, draggedSpec.width, draggedSpec.rotation, candidatePos)
  let dx = null
  let dz = null
  for (const other of others) {
    const B = boardBox(other.length, other.thickness, other.width, other.rotation, other.position)
    const touching = Math.abs(A.min.y - B.max.y) < 1 || Math.abs(A.max.y - B.min.y) < 1
    if (!touching) continue
    const xOverlap = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x)
    const zOverlap = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z)
    if (xOverlap <= MIN_OVERLAP || zOverlap <= MIN_OVERLAP) continue
    for (const d of [B.min.x - A.min.x, B.max.x - A.max.x]) {
      if (Math.abs(d) < snapThreshold && (dx == null || Math.abs(d) < Math.abs(dx))) dx = d
    }
    for (const d of [B.min.z - A.min.z, B.max.z - A.max.z]) {
      if (Math.abs(d) < snapThreshold && (dz == null || Math.abs(d) < Math.abs(dz))) dz = d
    }
  }
  return { dx, dz }
}

// 「上に乗せる」：真下（上から見て重なる位置）にある板のうち、いちばん高い上面の高さを返す。
// 重なる板がなければ 0（床）。
export function topSurfaceUnder(draggedSpec, candidatePos, others) {
  const A = boardBox(draggedSpec.length, draggedSpec.thickness, draggedSpec.width, draggedSpec.rotation, candidatePos)
  let top = 0
  for (const other of others) {
    const B = boardBox(other.length, other.thickness, other.width, other.rotation, other.position)
    const xOverlap = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x)
    const zOverlap = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z)
    if (xOverlap > MIN_OVERLAP && zOverlap > MIN_OVERLAP) top = Math.max(top, B.max.y)
  }
  return top
}

// ---- 板の向き（寝かせる／横に立てる／縦に立てる） ----
// 板は (長さ, 厚み, 幅) = ローカル (X, Y, Z)。
//   flat    寝かせる   … 厚みが上下（床に平らに置いた状態）
//   side    横に立てる … 幅が上下（長い辺が横の「壁」）
//   upright 縦に立てる … 長さが上下（長い辺が縦の「柱」）
// 向きの基本形に、上から見た向き（水平の回転 0/90/180/270°）を組み合わせて表す。
const BASE = {
  flat: [0, 0, 0, 1],
  side: null, // 下で計算
  upright: null,
}
BASE.side = rotateQuaternion(IDENTITY_QUATERNION, 'x', 90)
BASE.upright = rotateQuaternion(IDENTITY_QUATERNION, 'z', 90)

function localAxisWorld(quaternion, axis) {
  const v = axis === 'x' ? new THREE.Vector3(1, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  return v.applyQuaternion(new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]))
}

// 今の向きの種類
export function getOrientation(quaternion) {
  const q = quaternion || IDENTITY_QUATERNION
  if (Math.abs(localAxisWorld(q, 'y').y) > 0.9) return 'flat'
  if (Math.abs(localAxisWorld(q, 'z').y) > 0.9) return 'side'
  return 'upright'
}

// 上から見た向き（0/90/180/270°）。flat/side は長さの向き、upright は幅の向きで測る
function headingOf(quaternion, kind) {
  const v = kind === 'upright' ? localAxisWorld(quaternion, 'z') : localAxisWorld(quaternion, 'x')
  const deg = kind === 'upright' ? (Math.atan2(v.x, v.z) * 180) / Math.PI : (Math.atan2(-v.z, v.x) * 180) / Math.PI
  return (((Math.round(deg / 90) * 90) % 360) + 360) % 360
}

// 向きの種類を変える。上から見た向きはなるべく保つ
export function setOrientationQuaternion(quaternion, kind) {
  const current = getOrientation(quaternion)
  const heading = headingOf(quaternion || IDENTITY_QUATERNION, current)
  return rotateQuaternion(BASE[kind], 'y', heading)
}
