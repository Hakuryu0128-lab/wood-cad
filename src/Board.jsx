import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { makeFaceTextures, makeShapedTextures } from './woodTexture'
import { hasCorners } from './corners'
import { makeShapedBoardGeometry } from './boardGeometry'

// 板の3Dメッシュ本体。
// 単位は mm。BoxGeometry(length, thickness, width) = (X, Y, Z)
// outside … 置き場所の枠からはみ出しているとき true（赤くする）
export default function Board({ board, selected, outside, onSelect, onDragStart }) {
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
    <group position={position} quaternion={rotation || [0, 0, 0, 1]}>
      <mesh
        key={shapedGeometry ? 'shaped' : 'box'}
        castShadow
        receiveShadow
        material={materials}
        geometry={shapedGeometry || undefined}
        onPointerDown={(e) => {
          e.stopPropagation()
          onSelect(board.id)
          onDragStart(board.id, e.clientX, e.clientY)
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
    </group>
  )
}
