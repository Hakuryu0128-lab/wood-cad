import * as THREE from 'three'
import { outlinePoints } from './corners'
import { shapedEndFace } from './woodTexture'

// 角を加工した板の形を作る。中心が原点、BoxGeometry(length, thickness, width) と同じ向き。
// 面の材質を3つに分ける（woodTexture.js の makeShapedTextures と対）：
//   0: 上下の面（板の面） 1: X向きの側面（木口側／丸めや斜めの面も向きの近い方へ） 2: Z向きの側面
export function makeShapedBoardGeometry(board) {
  const { length, thickness, width, corners, grainAxis } = board
  const pts = outlinePoints(length, width, corners, 10)
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const ext = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 })
  // 輪郭の y（上が +）は板の中の -Z。押し出し方向を Y にする：(x, y, z) → (x, z, -y)
  ext.rotateX(-Math.PI / 2)
  ext.translate(0, -thickness / 2, 0)
  const src = ext.index ? ext.toNonIndexed() : ext
  ext.dispose()

  const pos = src.getAttribute('position')
  const end = shapedEndFace(grainAxis)
  const tris = [[], [], []]
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2)
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize()
    const g = Math.abs(n.y) > 0.9 ? 0 : Math.abs(n.x) >= Math.abs(n.z) ? 1 : 2
    tris[g].push(a.clone(), b.clone(), c.clone())
  }
  const positions = [], uvs = []
  const geom = new THREE.BufferGeometry()
  let start = 0
  tris.forEach((list, g) => {
    for (const v of list) {
      positions.push(v.x, v.y, v.z)
      if (g === 0) uvs.push(v.x, v.z)
      else if (g === end) {
        // 木口は面の実寸のキャンバスを1枚だけ貼るので 0〜1 に正規化する
        const u = g === 1 ? (v.z + width / 2) / width : (v.x + length / 2) / length
        uvs.push(u, (v.y + thickness / 2) / thickness)
      } else if (g === 1) uvs.push(v.z, v.y)
      else uvs.push(v.x, v.y)
    }
    geom.addGroup(start, list.length, g)
    start += list.length
  })
  src.dispose()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geom.computeVertexNormals()
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  return geom
}
