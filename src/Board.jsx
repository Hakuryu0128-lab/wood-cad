import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeFaceTextures, makeShapedTextures } from './woodTexture'
import { hasCorners } from './corners'
import { makeShapedBoardGeometry } from './boardGeometry'
import { cornerLocal } from './cornerView'

// 板の3Dメッシュ本体。
// 単位は mm。BoxGeometry(length, thickness, width) = (X, Y, Z)
// outside … 置き場所の枠からはみ出しているとき true（赤くする）
// cornerMode … 右のパネルで「角」を開いているとき true。4つの角に印を出し、選んだ角を黄色く光らせる
export default function Board({ board, selected, outside, onSelect, onDragStart, cornerMode, cornerSel, onPickCorner }) {
  const groupRef = useRef(null)
  const wasSelectedRef = useRef(false)
  const { thickness, width, length, position, rotation, grainAxis } = board
  // 角を加工した板だけ、輪郭を押し出した形にする（加工なしはこれまでどおりの直方体）
  const shaped = hasCorners(board)
  const cornersKey = shaped ? JSON.stringify(board.corners) : ''

  const shapedGeometry = useMemo(
    () => (shaped ? makeShapedBoardGeometry({ length, thickness, width, grainAxis, corners: JSON.parse(cornersKey) }) : null),
    [shaped, cornersKey, length, thickness, width, grainAxis],
  )
  useEffect(() => () => shapedGeometry?.dispose(), [shapedGeometry])

  const materials = useMemo(() => {
    const textures = shaped
      ? makeShapedTextures(grainAxis, length, thickness, width)
      : makeFaceTextures(grainAxis, length, thickness, width)
    return textures.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.85 }))
  }, [shaped, grainAxis, length, thickness, width])

  useEffect(() => {
    materials.forEach((m) => {
      m.emissive.set(outside ? '#ff2020' : '#000000')
      m.emissiveIntensity = outside ? 0.22 : 0
    })
  }, [materials, outside])

  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  const edges = useMemo(
    () => new THREE.EdgesGeometry(shapedGeometry || new THREE.BoxGeometry(length, thickness, width), 25),
    [shapedGeometry, length, thickness, width],
  )
  useEffect(() => () => edges.dispose(), [edges])

  return (
    <group ref={groupRef} position={position} quaternion={rotation || [0, 0, 0, 1]}>
      <mesh
        key={shapedGeometry ? 'shaped' : 'box'}
        castShadow
        receiveShadow
        material={materials}
        geometry={shapedGeometry || undefined}
        onPointerDown={(e) => {
          e.stopPropagation()
          wasSelectedRef.current = selected
          onSelect(board.id)
          onDragStart(board.id, e.clientX, e.clientY)
        }}
        onClick={(e) => {
          // ★選んである板の角のあたりをタップしたら、その角の加工を開く★
          // （動かしたときは開かない。はじめてタップしたときは板を選ぶだけ）
          if (!wasSelectedRef.current || board.locked || !onPickCorner || e.delta > 6 || !groupRef.current) return
          const p = groupRef.current.worldToLocal(e.point.clone())
          let best = -1, bestD = Infinity
          for (let i = 0; i < 4; i++) {
            const [cx, , cz] = cornerLocal(board, i)
            const d = Math.hypot(p.x - cx, p.z - cz)
            if (d < bestD) { bestD = d; best = i }
          }
          const reach = Math.min(60, Math.max(25, Math.min(length, width) * 0.35))
          if (bestD <= reach) { e.stopPropagation(); onPickCorner(board.id, best) }
        }}
      >
        {!shapedGeometry && <boxGeometry args={[length, thickness, width]} />}
      </mesh>
      {/* 板どうしの境目が分かるよう、ふだんも薄く輪郭を出す（v12から移植） */}
      <lineSegments geometry={edges} renderOrder={1}>
        <lineBasicMaterial
          color={selected ? '#2f6fed' : outside ? '#b00000' : '#5a3010'}
          transparent
          opacity={selected ? 1 : 0.35}
        />
      </lineSegments>
      {cornerMode && [0, 1, 2, 3].map((i) => (
        <CornerMarker
          key={i}
          position={cornerLocal(board, i)}
          active={i === cornerSel}
          onPick={() => onPickCorner && onPickCorner(board.id, i)}
        />
      ))}
    </group>
  )
}

// 角の印。選んだ角は黄色で、ゆっくり大きさが変わって光って見える。
// 板の裏にあっても見えるように、奥行きの判定をしない（いつも手前に描く）。
function CornerMarker({ position, active, onPick }) {
  const ref = useRef(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const s = active ? 1 + 0.25 * Math.sin(clock.elapsedTime * 5) : 1
    ref.current.scale.setScalar(s)
  })
  return (
    <group position={position}>
      <mesh
        ref={ref}
        renderOrder={10}
        onPointerDown={(e) => { e.stopPropagation() }}
        onClick={(e) => { e.stopPropagation(); onPick() }}
      >
        <sphereGeometry args={[active ? 9 : 6, 20, 14]} />
        <meshBasicMaterial toneMapped={false} color={active ? '#ffd43d' : '#ffffff'} depthTest={false} transparent opacity={active ? 1 : 0.9} />
      </mesh>
      <mesh renderOrder={9}>
        <sphereGeometry args={[active ? 12 : 8, 20, 14]} />
        <meshBasicMaterial toneMapped={false} color={active ? '#b36b00' : '#0017c1'} depthTest={false} transparent opacity={active ? 0.55 : 0.8} />
      </mesh>
    </group>
  )
}
