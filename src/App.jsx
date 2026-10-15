import * as THREE from 'three'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Scene from './Scene'
import AddBoardPanel from './AddBoardPanel'
import Inspector from './Inspector'
import DPad from './DPad'
import CutList from './CutList'
import StockPanel from './StockPanel'
import StockModal from './StockModal'
import UserModal from './UserModal'
import SpaceSheet from './SpaceSheet'
import SpacePanel from './SpacePanel'
import PartsList from './PartsList'
import HelpPanel from './HelpPanel'
import SaveSelect from './SaveSelect'
import SubmitSheet from './SubmitSheet'
import { loadAppConfig, sendSubmission } from './submit'
import { DEFAULT_SPACE, normalizeSpace, checkSpace } from './space'
import {
  groundOffsetY,
  snapToGrid,
  rotateQuaternion,
  IDENTITY_QUATERNION,
  findVerticalSnap,
  setOrientationQuaternion,
  topSurfaceUnder,
} from './geometry'
import {
  saveToLocalStorage,
  loadFromLocalStorage,
  exportDesignToFile,
  importDesignFromFile,
  loadUser as loadLegacyUser,
  saveUser as saveLegacyUser,
  writePending,
  readPending,
  clearPending,
} from './save'
import * as db from './db'
import { loadStock, packBars, summarizeStockUsage } from './stock'
import './App.css'

let nextId = 1

const bumpNextId = (boards) => {
  nextId = boards.reduce((max, b) => Math.max(max, b.id), 0) + 1
}

// 7月版までの localStorage の自動保存を、最初の1回だけセーブデータに移す
const MIGRATED_KEY = 'wood-cad-migrated-to-idb'

const AUTOSAVE_DELAY = 500 // ms: 操作が止まってからこの時間後に自動保存

export default function App() {
  const [boards, setBoards] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [cutListOpen, setCutListOpen] = useState(false)
  const [stockModalOpen, setStockModalOpen] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveMsgType, setSaveMsgType] = useState('info')
  const [stock, setStock] = useState([])
  const [space, setSpace] = useState(DEFAULT_SPACE)
  const [spaceOpen, setSpaceOpen] = useState(false)

  // 画面の状態: loading → (user：番号・名前入力) → saves：セーブデータ選択 → edit：設計
  const [screen, setScreen] = useState('loading')
  const [dbOk, setDbOk] = useState(true)
  const [user, setUser] = useState(null) // いま使っている人
  const [slot, setSlot] = useState(null) // 開いているセーブデータ { id, title, num, name, createdAt }
  const [saves, setSaves] = useState([])
  const [showAll, setShowAll] = useState(false)
  const [appConfig, setAppConfig] = useState({ submitUrl: '' })
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitThumb, setSubmitThumb] = useState(null)
  const fileInputRef = useRef(null)
  const captureRef = useRef(null)
  const cameraRef = useRef(null) // DPad を画面の向きで動かすため
  const dirtyRef = useRef(false) // 開いてから変更があったか（開いただけで更新日時を変えないため）
  const timerRef = useRef(null)
  const latestRef = useRef({}) // 自動保存で使う最新の値
  latestRef.current = { boards, space, slot }

  const selectedBoard = boards.find((b) => b.id === selectedId) || null
  const spaceCheck = useMemo(() => checkSpace(space, boards), [space, boards])
  // 木取り表・書き出しに載せる名前は「そのデータの持ち主」（先生が生徒のファイルを開いた場合も正しく出る）
  const owner = slot && slot.num ? { num: slot.num, name: slot.name } : user

  const flashMsg = (msg, type = 'info') => {
    setSaveMsg(msg)
    setSaveMsgType(type)
    setTimeout(() => setSaveMsg(''), 2500)
  }

  // ---- 起動 ----
  useEffect(() => {
    loadStock().then(setStock)
    loadAppConfig().then(setAppConfig)
  }, [])

  const refreshSaves = useCallback(async (u, all) => {
    try {
      setSaves(await db.listSaves(all ? null : u))
    } catch {
      setSaves([])
    }
  }, [])

  // 名前が決まったあとの共通処理：旧データの移行 → セーブデータ一覧へ
  const enterWithUser = useCallback(
    async (u) => {
      try {
        const migrated = localStorage.getItem(MIGRATED_KEY)
        const legacy = loadFromLocalStorage()
        if (!migrated && legacy && legacy.boards.length) {
          await db.putSave({
            id: db.newSaveId(),
            num: u.num,
            name: u.name,
            title: '前回のつづき',
            boards: legacy.boards,
            space: legacy.space ? normalizeSpace(legacy.space) : { ...DEFAULT_SPACE },
            thumbnail: null,
          })
        }
        localStorage.setItem(MIGRATED_KEY, '1')
      } catch {
        // localStorage が使えない環境では移行しない
      }
      await refreshSaves(u, false)
      setShowAll(false)
      setScreen('saves')
    },
    [refreshSaves]
  )

  useEffect(() => {
    ;(async () => {
      const ok = await db.isAvailable()
      setDbOk(ok)
      if (!ok) {
        // IndexedDB が使えない：番号・名前を入れたら、メモリ＋localStorage だけで動かす
        setUser(loadLegacyUser())
        setScreen('user')
        return
      }
      let u = null
      try {
        u = await db.getUser()
        if (!u) {
          const legacyUser = loadLegacyUser()
          if (legacyUser) {
            u = legacyUser
            await db.setUser(u)
          }
        }
      } catch {
        u = null
      }
      // 前回、保存が終わる前に閉じられていたら、その控えをセーブデータに戻す
      const pending = readPending()
      if (pending && pending.id) {
        try {
          const rec = await db.getSave(pending.id)
          if (rec && pending.at > rec.updatedAt) {
            await db.putSave({ ...rec, boards: pending.boards, space: pending.space })
          }
        } catch {
          // 戻せなくても続行
        }
        clearPending()
      }
      setUser(u)
      if (u) await enterWithUser(u)
      else setScreen('user')
    })()
  }, [enterWithUser])

  // ---- 自動保存 ----
  const capture = () => (captureRef.current ? captureRef.current() : null)

  const flushSave = useCallback(async () => {
    clearTimeout(timerRef.current)
    const { boards: b, space: sp, slot: sl } = latestRef.current
    if (!dirtyRef.current) return
    dirtyRef.current = false
    if (!dbOk) {
      saveToLocalStorage({ boards: b, space: sp })
      return
    }
    if (!sl) return
    try {
      const rec = await db.putSave({
        id: sl.id,
        num: sl.num,
        name: sl.name,
        title: sl.title,
        boards: b,
        space: sp,
        thumbnail: b.length ? capture() : null,
        createdAt: sl.createdAt,
        submittedAt: sl.submittedAt || null,
      })
      setSlot((cur) => (cur && cur.id === rec.id ? { ...cur, createdAt: rec.createdAt } : cur))
      // 書き終わったので、閉じる直前の控えは不要（その後また変更があれば控えは残す）
      if (!dirtyRef.current) {
        const pend = readPending()
        if (pend && pend.id === rec.id) clearPending()
      }
    } catch {
      flashMsg('この端末に保存できませんでした。「書き出し」でファイルに保存してください', 'warn')
    }
  }, [dbOk])

  // 板・置き場所が変わったら、少し待ってから自動保存
  const firstRenderRef = useRef(true)
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    if (screen !== 'edit') return
    if (!dirtyRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flushSave, AUTOSAVE_DELAY)
  }, [boards, space, screen, flushSave])

  // タブを閉じる・別アプリに切り替えるときは、待たずにすぐ保存
  useEffect(() => {
    const saveNow = () => {
      const { boards: b, space: sp, slot: sl } = latestRef.current
      // IndexedDB の書き込みが間に合わない場合に備えて、同期的に控えを取る
      if (dirtyRef.current && sl) writePending({ id: sl.id, boards: b, space: sp, at: Date.now() })
      flushSave()
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveNow()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', saveNow)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', saveNow)
    }
  }, [flushSave])

  // 変更を伴う操作はすべてこれを通して「未保存」の印を付ける
  const markDirty = () => {
    dirtyRef.current = true
  }
  const setBoardsDirty = (updater) => {
    markDirty()
    setBoards(updater)
  }
  const setSpaceDirty = (sp) => {
    markDirty()
    setSpace(sp)
  }

  // ---- セーブデータの操作 ----
  const loadIntoEditor = (rec) => {
    clearTimeout(timerRef.current)
    dirtyRef.current = false
    const b = Array.isArray(rec.boards) ? rec.boards : []
    setBoards(b)
    bumpNextId(b)
    setSpace(rec.space ? normalizeSpace(rec.space) : { ...DEFAULT_SPACE })
    setSlot({ id: rec.id, title: rec.title, num: rec.num, name: rec.name, createdAt: rec.createdAt, submittedAt: rec.submittedAt || null })
    setSelectedId(null)
    setScreen('edit')
  }

  const openSaves = async () => {
    await flushSave()
    await refreshSaves(user, showAll)
    setScreen('saves')
  }

  const handleOpenSave = async (id) => {
    const rec = await db.getSave(id)
    if (rec) loadIntoEditor(rec)
    else flashMsg('データが見つかりませんでした', 'warn')
  }

  const handleNewSave = async () => {
    const mine = await db.listSaves(user)
    const rec = await db.putSave({
      id: db.newSaveId(),
      num: user.num,
      name: user.name,
      title: db.nextTitle(mine),
      boards: [],
      space: { ...DEFAULT_SPACE },
      thumbnail: null,
    })
    loadIntoEditor(rec)
  }

  const handleDuplicate = async (id) => {
    const src = await db.getSave(id)
    if (!src) return
    await db.duplicateSave(id, `${src.title}のコピー`)
    await refreshSaves(user, showAll)
  }

  const handleRename = async (id, title) => {
    const rec = await db.getSave(id)
    if (!rec) return
    // 名前の変更だけでは並び順（更新日時）を変えない
    await db.putSave({ ...rec, title }, { keepTime: true }).catch(() => {})
    if (slot && slot.id === id) setSlot({ ...slot, title })
    await refreshSaves(user, showAll)
  }

  const handleDelete = async (id) => {
    await db.deleteSave(id)
    if (slot && slot.id === id) {
      setSlot(null)
      setBoards([])
    }
    await refreshSaves(user, showAll)
  }

  // セーブデータ一覧から、そのデータをファイルに書き出す
  const handleExportSave = async (id) => {
    const rec = await db.getSave(id)
    if (!rec) return
    exportDesignToFile({ boards: rec.boards, space: rec.space, user: { num: rec.num, name: rec.name } })
  }

  const handleToggleShowAll = async (all) => {
    setShowAll(all)
    await refreshSaves(user, all)
  }

  // ---- 番号・名前 ----
  const [userOpen, setUserOpen] = useState(false)

  const handleUserSubmit = async (u) => {
    setUser(u)
    saveLegacyUser(u)
    setUserOpen(false)
    if (!dbOk) {
      // IndexedDB なし：前回の自動保存（localStorage）があれば続きから
      const legacy = loadFromLocalStorage()
      if (legacy) {
        setBoards(legacy.boards)
        bumpNextId(legacy.boards)
        if (legacy.space) setSpace(normalizeSpace(legacy.space))
      }
      setScreen('edit')
      return
    }
    await flushSave()
    try {
      await db.setUser(u)
    } catch {
      // 保存できなくても続行
    }
    setSlot(null)
    await enterWithUser(u)
  }

  // ---- ファイル ----
  const handleExport = async () => {
    await flushSave()
    exportDesignToFile({ boards, space, user: owner })
    flashMsg('書き出しました')
  }

  // ---- 先生に送る ----
  const openSubmit = async () => {
    await flushSave()
    setSelectedId(null)
    setSubmitThumb(capture())
    setSubmitOpen(true)
  }

  const handleSend = async () => {
    const stockUsage = summarizeStockUsage(stock, boards)
    const summary = {
      boardCount: boards.length,
      size: spaceCheck.size,
      fitsSpace: space.enabled ? spaceCheck.outsideIds.size === 0 : null,
      stockOk: stockUsage.length ? stockUsage.every((u) => u.fits) : null,
    }
    const r = await sendSubmission(appConfig.submitUrl, {
      num: owner?.num || '',
      name: owner?.name || '',
      title: slot?.title || '',
      boards,
      space,
      thumbnail: submitThumb,
      summary,
    })
    if (r.ok && slot && dbOk) {
      // 送った日時をセーブデータに記録（並び順は変えない）
      const at = r.receivedAt || new Date().toISOString()
      setSlot((cur) => (cur ? { ...cur, submittedAt: at } : cur))
      try {
        const rec = await db.getSave(slot.id)
        if (rec) await db.putSave({ ...rec, submittedAt: at }, { keepTime: true })
      } catch {
        // 記録できなくても送信自体は成功している
      }
    }
    return r
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  // ファイルから読み込んだデータは、新しいセーブデータとして追加して開く
  const handleImportChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const loaded = await importDesignFromFile(file)
      const metaOk = loaded.meta && loaded.meta.num && loaded.meta.name
      const rec = {
        id: db.newSaveId(),
        num: metaOk ? String(loaded.meta.num) : user?.num || '',
        name: metaOk ? String(loaded.meta.name) : user?.name || '',
        title: file.name.replace(/\.json$/i, '').slice(0, 30) || '読み込んだデータ',
        boards: loaded.boards,
        space: loaded.space ? normalizeSpace(loaded.space) : { ...DEFAULT_SPACE },
        thumbnail: null,
      }
      if (dbOk) {
        const saved = await db.putSave(rec)
        loadIntoEditor(saved)
        // サムネイルを作るため、開いた直後に一度保存する
        dirtyRef.current = true
      } else {
        loadIntoEditor({ ...rec, createdAt: Date.now() })
        dirtyRef.current = true
      }
      flashMsg('読み込みました')
    } catch {
      flashMsg('読み込みに失敗しました', 'warn')
    }
  }

  // 在庫チェック（足りるかどうか）はAddBoardPanel側で追加前に済ませているので、
  // ここでは受け取った内容をそのまま追加する
  const addBoard = ({ thickness, width, length }) => {
    const id = nextId++
    const offsetIndex = boards.length
    const rotation = IDENTITY_QUATERNION
    const board = {
      id,
      thickness,
      width,
      length,
      grainAxis: 'X',
      rotation,
      // 追加した板が重ならないよう、少しずつずらして並べる
      position: [
        (offsetIndex % 4) * 60 - 90,
        groundOffsetY(length, thickness, width, rotation),
        Math.floor(offsetIndex / 4) * 60 - 60,
      ],
    }
    setBoardsDirty((prev) => [...prev, board])
    setSelectedId(id)
  }

  const updateBoard = (id, patch) => {
    setBoardsDirty((prev) => {
      const next = prev.map((b) => {
        if (b.id !== id || b.locked) return b
        const merged = { ...b, ...patch }
        // 寸法を変えた場合は板が地面に埋まらないようYを補正
        if (patch.thickness !== undefined || patch.width !== undefined || patch.length !== undefined) {
          const y = groundOffsetY(merged.length, merged.thickness, merged.width, merged.rotation)
          merged.position = [merged.position[0], y, merged.position[2]]
        }
        return merged
      })
      // 長さを変えた場合、そのプロファイル（厚み・幅）の在庫に収まっているか確認して警告する
      // （編集自体はブロックしない。タイピング中に毎回止まるのを避けるため）
      if (patch.length !== undefined) {
        const b = next.find((x) => x.id === id)
        const entry = stock.find((s) => s.thickness === b.thickness && s.width === b.width)
        if (entry && entry.quantity != null) {
          const pieces = next
            .filter((x) => x.thickness === b.thickness && x.width === b.width)
            .map((x) => ({ id: x.id, length: x.length }))
          if (!packBars(pieces, entry.stockLength, entry.quantity).fits) {
            flashMsg('材料が足りません。長さを見直してください', 'warn')
          }
        }
      }
      return next
    })
  }

  // 常にワールド座標のX/Y軸まわりに90度ずつ回す（板を立てた後でも効果が変わらないように）。
  // 回転後も「今乗っている高さ」（地面 or 他の板の上）をそのまま保つ。以前は回転のたびに
  // 強制的に地面(y=0)へ戻していたため、他の板の上に乗せた板を回転させると地面まで
  // 落ちてしまう不具合があった。
  const applyRotation = (id, makeRotation) => {
    setBoardsDirty((prev) =>
      prev.map((b) => {
        if (b.id !== id || b.locked) return b
        const prevOffset = groundOffsetY(b.length, b.thickness, b.width, b.rotation)
        const bottom = Math.max(0, b.position[1] - prevOffset) // 回転前の底面の高さ
        const rotation = makeRotation(b.rotation)
        const newOffset = groundOffsetY(b.length, b.thickness, b.width, rotation)
        const y = bottom + newOffset
        return { ...b, rotation, position: [b.position[0], y, b.position[2]] }
      })
    )
  }

  const rotateBoard = (id, axis, deg) => applyRotation(id, (q) => rotateQuaternion(q, axis, deg))

  // 向きの種類（寝かせる／横に立てる／縦に立てる）を選ぶ。上から見た向きはなるべく保つ
  const setOrientation = (id, kind) => applyRotation(id, (q) => setOrientationQuaternion(q, kind))

  // 固定する／固定を解除する
  const toggleLock = (id) => {
    setBoardsDirty((prev) => prev.map((b) => (b.id === id ? { ...b, locked: !b.locked } : b)))
  }

  // 選んでいる板を、真下にある板のいちばん上に乗せる（なければ床へ）
  const placeOnTop = () => {
    if (!selectedId) return
    setBoardsDirty((prev) =>
      prev.map((b) => {
        if (b.id !== selectedId || b.locked) return b
        const offset = groundOffsetY(b.length, b.thickness, b.width, b.rotation)
        const others = prev.filter((o) => o.id !== b.id)
        const top = topSurfaceUnder({ length: b.length, thickness: b.thickness, width: b.width, rotation: b.rotation }, b.position, others)
        return { ...b, position: [b.position[0], top + offset, b.position[2]] }
      })
    )
  }

  // 選んでいる板を床に下ろす
  const placeOnFloor = () => {
    if (!selectedId) return
    setBoardsDirty((prev) =>
      prev.map((b) => {
        if (b.id !== selectedId || b.locked) return b
        const offset = groundOffsetY(b.length, b.thickness, b.width, b.rotation)
        return { ...b, position: [b.position[0], offset, b.position[2]] }
      })
    )
  }

  const deleteBoard = (id) => {
    setBoardsDirty((prev) => prev.filter((b) => b.id !== id || b.locked))
    if (selectedId === id) setSelectedId(null)
  }

  // 十字キーでの1cmずつの移動。上下移動のときは、近くの板の上面・底面にぴったり乗る
  // 高さがあればそちらへスナップする（1cm刻みだけではぴったり合わせられない高さもあるため）
  // DPad から：right=画面の右へ, up=上へ, forward=画面の奥へ（mm）。
  // 視点の向きに合わせて、いちばん近い X/Z 軸の方向へ変換する
  const moveSelected = (right, dy, forward) => {
    if (!selectedId) return
    let fx = 0
    let fz = -1
    const cam = cameraRef.current
    if (cam) {
      const dir = new THREE.Vector3()
      cam.getWorldDirection(dir)
      if (Math.abs(dir.x) > Math.abs(dir.z)) {
        fx = Math.sign(dir.x)
        fz = 0
      } else {
        fx = 0
        fz = Math.sign(dir.z) || -1
      }
    }
    // 右方向 = 奥方向 × 上方向
    const rx = -fz
    const rz = fx
    const dx = right * rx + forward * fx
    const dz = right * rz + forward * fz
    setBoardsDirty((prev) =>
      prev.map((b) => {
        if (b.id !== selectedId || b.locked) return b
        const [x, y, z] = b.position
        const minY = groundOffsetY(b.length, b.thickness, b.width, b.rotation)
        let newY = Math.max(minY, y + dy)
        if (dy !== 0) {
          const others = prev.filter((o) => o.id !== b.id)
          const verticalGap = findVerticalSnap(
            { length: b.length, thickness: b.thickness, width: b.width, rotation: b.rotation },
            [x + dx, newY, z + dz],
            others,
            15,
            y, // 動く前の高さ（この手前の面へは吸い付かせない）
            dy > 0 ? 1 : -1
          )
          if (verticalGap != null) newY = Math.max(minY, newY + verticalGap)
        }
        return { ...b, position: [x + dx, newY, z + dz] }
      })
    )
  }

  // マウス/タッチでのドラッグ移動中（XZ平面、Yは変更しない）。なめらかに追従させたいので
  // ドラッグ中はスナップしない
  const moveBoardXZ = (id, x, z) => {
    setBoardsDirty((prev) => prev.map((b) => (b.id === id && !b.locked ? { ...b, position: [x, b.position[1], z] } : b)))
  }

  // ドラッグを離した瞬間に1cm(10mm)グリッドへスナップして確定する
  // axes: { x, z } … マス目に寄せる方向（ほかの板にそろえた方向は寄せない）
  const snapBoardXZ = (id, axes = { x: true, z: true }) => {
    setBoardsDirty((prev) =>
      prev.map((b) =>
        b.id === id && !b.locked
          ? {
              ...b,
              position: [
                axes.x ? snapToGrid(b.position[0]) : b.position[0],
                b.position[1],
                axes.z ? snapToGrid(b.position[2]) : b.position[2],
              ],
            }
          : b
      )
    )
  }

  const needUser = screen === 'user' || userOpen

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-title">
          木工CAD{slot && <span className="toolbar-slot">｜{slot.title}</span>}
        </div>
        <div className="toolbar-actions">
          {user && (
            <button className="user-chip" onClick={() => setUserOpen(true)} title="番号・名前を変える">
              {user.num} {user.name}
            </button>
          )}
          {saveMsg && <span className={saveMsgType === 'warn' ? 'warn-msg' : 'save-msg'}>{saveMsg}</span>}
          {dbOk ? (
            <button className="btn-secondary" onClick={openSaves}>
              セーブデータ
            </button>
          ) : (
            <button className="btn-secondary" onClick={handleImportClick}>
              開く
            </button>
          )}
          {!appConfig.submitUrl && (
            <button className="btn-secondary" onClick={handleExport} title="ファイルに書き出す（提出・持ち帰り用）">
              書き出し
            </button>
          )}
          <button className="btn-secondary" onClick={() => setCutListOpen(true)}>
            木取り表
          </button>
          <button className="btn-secondary" onClick={() => setSpaceOpen(true)}>
            置き場所
          </button>
          {appConfig.submitUrl && (
            <button className="btn-send" onClick={openSubmit}>
              先生に送る
            </button>
          )}
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            ＋ 板を追加
          </button>
        </div>
        <input
          type="file"
          accept=".json,application/json"
          ref={fileInputRef}
          onChange={handleImportChange}
          style={{ display: 'none' }}
        />
      </header>

      <Scene
        boards={boards}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDeselect={() => setSelectedId(null)}
        onMoveBoardXZ={moveBoardXZ}
        onDragEnd={snapBoardXZ}
        space={space}
        spaceCheck={spaceCheck}
        outsideIds={spaceCheck.outsideIds}
        captureRef={captureRef}
        cameraRef={cameraRef}
      />

      {!dbOk && screen === 'edit' && (
        <div className="nodb-banner">この端末ではデータを保存できません。こまめに「書き出し」でファイルに保存してください</div>
      )}

      {boards.length === 0 && screen === 'edit' && (
        <div className="empty-hint">「＋ 板を追加」から最初の板を置いてください</div>
      )}

      <div className="left-stack">
        <StockPanel stock={stock} boards={boards} onOpen={() => setStockModalOpen(true)} />
        <SpacePanel space={space} check={spaceCheck} onOpen={() => setSpaceOpen(true)} />
        <PartsList boards={boards} selectedId={selectedId} outsideIds={spaceCheck.outsideIds} onSelect={setSelectedId} />
      </div>

      {screen === 'edit' && <HelpPanel />}

      <Inspector
        board={selectedBoard}
        onChange={updateBoard}
        onRotate={rotateBoard}
        onOrientation={setOrientation}
        onToggleLock={toggleLock}
        onDelete={deleteBoard}
        onDeselect={() => setSelectedId(null)}
      />

      <DPad visible={!!selectedBoard && !selectedBoard.locked} onMove={moveSelected} onPlaceOnTop={placeOnTop} onPlaceOnFloor={placeOnFloor} />

      <AddBoardPanel open={addOpen} onClose={() => setAddOpen(false)} onAdd={addBoard} stock={stock} boards={boards} />

      <CutList
        open={cutListOpen}
        boards={boards}
        stock={stock}
        user={owner}
        title={slot?.title}
        space={space}
        spaceCheck={spaceCheck}
        onClose={() => setCutListOpen(false)}
      />

      <StockModal open={stockModalOpen} stock={stock} boards={boards} onClose={() => setStockModalOpen(false)} />

      <SpaceSheet open={spaceOpen} space={space} onSave={setSpaceDirty} onClose={() => setSpaceOpen(false)} />

      <SubmitSheet
        open={submitOpen}
        owner={owner}
        title={slot?.title || ''}
        boardCount={boards.length}
        thumbnail={submitThumb}
        lastSubmittedAt={slot?.submittedAt}
        onSend={handleSend}
        onExport={handleExport}
        onClose={() => setSubmitOpen(false)}
      />

      {screen === 'loading' && <div className="save-screen loading">読み込み中…</div>}

      {screen === 'saves' && (
        <SaveSelect
          user={user}
          saves={saves}
          showAll={showAll}
          currentId={slot?.id}
          onToggleShowAll={handleToggleShowAll}
          onOpen={handleOpenSave}
          onNew={handleNewSave}
          onDuplicate={handleDuplicate}
          onRename={handleRename}
          onDelete={handleDelete}
          onImport={handleImportClick}
          onExport={handleExportSave}
          onChangeUser={() => setUserOpen(true)}
          onClose={slot ? () => setScreen('edit') : null}
        />
      )}

      {needUser && (
        <UserModal
          open
          initial={user}
          onSubmit={handleUserSubmit}
          onCancel={user && screen !== 'user' ? () => setUserOpen(false) : null}
        />
      )}
    </div>
  )
}
