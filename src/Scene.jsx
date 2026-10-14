import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Html } from '@react-three/drei'
import * as THREE from 'three'
import Board from './Board'
import { findFaceSnap } from './geometry'
import { cm } from './space'

const SNAP_THRESHOLD = 15 // mm: これより近づいたら面が吸い付く
const DISPLAY_RADIUS = 250 // mm: これより近ければ距離を表示する

// 置き場所の枠。床(y=0)から高さ分の半透明の箱。はみ出しがあれば赤くする。
// raycast を無効にして、枠の上からでも板をタップ・ドラッグできるようにしている。
const noRaycast = () => null
function SpaceFrame({ space, over }) {
  const { width, depth, height } = space
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)), [width, height, depth])
  const color = over ? '#e53935' : '#2f6fed'
  return (
    <group position={[0, height / 2, 0]}>
      <mesh raycast={noRaycast} renderOrder={2}>
        <boxGeometry args={[width, height, depth]} />
        <meshBasicMaterial color={color} transparent opacity={over ? 0.12 : 0.07} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edges} raycast={noRaycast}>
        <lineBasicMaterial color={color} transparent opacity={0.9} />
      </lineSegments>
      {/* 床の上の枠線（上から見たときにも分かるように少し浮かせる） */}
      <mesh raycast={noRaycast} position={[0, -height / 2 + 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} />
      </mesh>
      {/* ラベルは手前の床の位置に置く（奥の上だと画面上部のボタンと重なるため）。
          zIndexRange を低くして、ボタンやパネルより下に描く */}
      <Html position={[0, -height / 2, depth / 2 + 14]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`frame-label ${over ? 'over' : ''}`}>
          置き場所 {cm(width)}×{cm(depth)}×{cm(height)}cm{over ? '（はみ出し）' : ''}
        </div>
      </Html>
    </group>
  )
}

// セーブデータ一覧に出すサムネイルを撮る。描画直後でないとキャンバスが空になるので、
// その場で1回描画してから縮小コピーする（preserveDrawingBuffer を使わずに済む）
function makeCapture(gl, scene, camera) {
  return () => {
    try {
      gl.render(scene, camera)
      const src = gl.domElement
      const W = 320
      const H = Math.round((W * src.height) / src.width) || 200
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      c.getContext('2d').drawImage(src, 0, 0, W, H)
      return c.toDataURL('image/jpeg', 0.7)
    } catch {
      return null
    }
  }
}

function SceneContents({ boards, selectedId, onSelect, onMoveBoardXZ, onDragEnd, space, outsideIds, captureRef }) {
  const { camera, gl, scene } = useThree()
  useEffect(() => {
    if (captureRef) captureRef.current = makeCapture(gl, scene, camera)
  }, [captureRef, gl, scene, camera])
  const controlsRef = useRef()
  const raycasterRef = useRef(new THREE.Raycaster())
  const dragRef = useRef({ active: false, id: null, plane: new THREE.Plane(), startPoint: new THREE.Vector3(), startPos: [0, 0, 0], snapped: false })
  const boardsRef = useRef(boards)
  boardsRef.current = boards
  const [snapInfo, setSnapInfo] = useState(null) // { boardId, dist, snapped } | null
  const focusTargetRef = useRef(null) // 選択した板を視界の中心にするためのアニメーション目標

  const ndcFromClient = (clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
  }

  const intersectDragPlane = (clientX, clientY) => {
    const ndc = ndcFromClient(clientX, clientY)
    raycasterRef.current.setFromCamera(ndc, camera)
    const point = new THREE.Vector3()
    const hit = raycasterRef.current.ray.intersectPlane(dragRef.current.plane, point)
    return hit ? point : null
  }

  // 板を掴んだ瞬間：その板の高さで水平な「移動用の面」を作り、以後はその面との
  // 交点だけを見て移動量を計算する（板メッシュ自体へのレイキャストだと、板が薄い/
  // 回転していると判定が外れてカクつくため）。
  const handleDragStart = (id, clientX, clientY) => {
    const board = boardsRef.current.find((b) => b.id === id)
    if (!board) return
    dragRef.current.plane.set(new THREE.Vector3(0, 1, 0), -board.position[1])
    const point = intersectDragPlane(clientX, clientY)
    dragRef.current.active = true
    dragRef.current.id = id
    dragRef.current.startPoint = point || new THREE.Vector3(board.position[0], board.position[1], board.position[2])
    dragRef.current.startPos = [...board.position]
    dragRef.current.snapped = false
    if (controlsRef.current) controlsRef.current.enabled = false
  }

  useEffect(() => {
    const handleMove = (e) => {
      const drag = dragRef.current
      if (!drag.active) return
      const point = intersectDragPlane(e.clientX, e.clientY)
      if (!point) return

      const board = boardsRef.current.find((b) => b.id === drag.id)
      if (!board) return

      let x = drag.startPos[0] + (point.x - drag.startPoint.x)
      let z = drag.startPos[2] + (point.z - drag.startPoint.z)

      const others = boardsRef.current.filter((b) => b.id !== drag.id)
      const { best, nearest } = findFaceSnap(
        { length: board.length, thickness: board.thickness, width: board.width, rotation: board.rotation },
        [x, board.position[1], z],
        others,
        SNAP_THRESHOLD
      )

      if (best) {
        // 面同士がぴったり合うように、その軸方向を吸い付かせる
        // さらに、面と平行な方向にも近い角があれば、そちらにも揃えて角同士をぴったり合わせる
        // （近い角がなければ平行方向はそのまま＝面の途中で接合できる）
        if (best.axis === 'x') {
          x += best.gap
          if (best.corner != null) z += best.corner
        } else {
          z += best.gap
          if (best.corner != null) x += best.corner
        }
        drag.snapped = true
        setSnapInfo({ boardId: drag.id, dist: 0, snapped: true })
      } else {
        drag.snapped = false
        if (nearest && nearest.absGap < DISPLAY_RADIUS) {
          setSnapInfo({ boardId: drag.id, dist: nearest.absGap, snapped: false })
        } else {
          setSnapInfo(null)
        }
      }

      onMoveBoardXZ(drag.id, x, z)
    }
    const handleUp = () => {
      const drag = dragRef.current
      if (drag.active && drag.id != null && !drag.snapped) {
        onDragEnd(drag.id) // 面に吸い付いていなければ1cmグリッドへスナップして確定
      }
      dragRef.current.active = false
      dragRef.current.id = null
      setSnapInfo(null)
      if (controlsRef.current) controlsRef.current.enabled = true
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    // camera・gl はマウント後に変わらない前提
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl])

  // 板を選択したら、その板が視界の中心（OrbitControlsの注視点）になるように
  // アニメーションの目標を設定する。実際の移動はuseFrameで毎フレーム少しずつ近づける。
  useEffect(() => {
    if (selectedId == null) return
    const board = boardsRef.current.find((b) => b.id === selectedId)
    if (!board) return
    focusTargetRef.current = new THREE.Vector3(board.position[0], board.position[1], board.position[2])
  }, [selectedId])

  useFrame(() => {
    const target = focusTargetRef.current
    const controls = controlsRef.current
    if (!target || !controls) return
    const dist = controls.target.distanceTo(target)
    if (dist < 0.5) {
      controls.target.copy(target)
      focusTargetRef.current = null
    } else {
      controls.target.lerp(target, 0.15)
    }
    controls.update()
  })

  const snapBoard = snapInfo ? boards.find((b) => b.id === snapInfo.boardId) : null

  return (
    <>
      <color attach="background" args={['#eef2f6']} />
      <hemisphereLight args={['#ffffff', '#b0a89a', 0.9]} />
      <directionalLight
        position={[300, 500, 200]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {/* 1cm(10mm)刻み、10cm(100mm)ごとに太い線のグリッド */}
      <Grid
        position={[0, 0, 0]}
        args={[1200, 1200]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#c7cdd6"
        sectionSize={100}
        sectionThickness={1.2}
        sectionColor="#8b95a3"
        fadeDistance={1400}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {boards.map((b) => (
        <Board
          key={b.id}
          board={b}
          selected={b.id === selectedId}
          outside={outsideIds.has(b.id)}
          onSelect={onSelect}
          onDragStart={handleDragStart}
        />
      ))}

      {space.enabled && <SpaceFrame space={space} over={outsideIds.size > 0} />}

      {snapBoard && snapInfo && (
        <Html
          position={[snapBoard.position[0], snapBoard.position[1] + snapBoard.thickness / 2 + 20, snapBoard.position[2]]}
          center
          zIndexRange={[5, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              background: snapInfo.snapped ? '#2f6fed' : 'rgba(0,0,0,0.7)',
              color: '#fff',
              fontSize: 11,
              padding: '3px 7px',
              borderRadius: 6,
              whiteSpace: 'nowrap',
            }}
          >
            {snapInfo.snapped ? '面で接続' : `面まで ${(snapInfo.dist / 10).toFixed(1)}cm`}
          </div>
        </Html>
      )}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.15}
        minDistance={100}
        maxDistance={1600}
        maxPolarAngle={Math.PI / 2 - 0.02}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  )
}

// 単位は mm。作業台は400mm四方を想定。
export default function Scene({ boards, selectedId, onSelect, onDeselect, onMoveBoardXZ, onDragEnd, space, outsideIds, captureRef }) {
  return (
    <Canvas
      shadows
      camera={{ position: [420, 380, 420], fov: 40, near: 1, far: 5000 }}
      onPointerMissed={onDeselect}
    >
      <SceneContents
        boards={boards}
        selectedId={selectedId}
        onSelect={onSelect}
        onMoveBoardXZ={onMoveBoardXZ}
        onDragEnd={onDragEnd}
        space={space}
        outsideIds={outsideIds}
        captureRef={captureRef}
      />
    </Canvas>
  )
}
