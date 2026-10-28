import { useEffect, useRef, useState } from 'react'

// 上のバーの左：「設計1 ▼」。押すと、ファイルや名前に関わる操作をまとめたメニューが開く。
// 上のバーのボタンを減らすため、ふだんは使わない操作はここに入れる。
export default function DesignMenu({ title, user, dbOk, onOpenSaves, onImport, onExport, onRename, onChangeUser, onHelp }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(title || '')
  const ref = useRef(null)

  // メニューの外を押したら閉じる
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setRenaming(false) } }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const run = (fn) => () => { setOpen(false); setRenaming(false); fn() }
  const submitName = (e) => {
    e.preventDefault()
    const t = name.trim()
    if (t) onRename(t)
    setRenaming(false)
    setOpen(false)
  }

  return (
    <div className="design-menu" ref={ref}>
      <button
        className="design-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(!open); setRenaming(false); setName(title || '') }}
      >
        <span className="design-menu-app">木工CAD</span>
        <span className="design-menu-title">{title || '設計'}</span>
        <span aria-hidden="true" className="design-menu-caret">▼</span>
      </button>
      {open && (
        <div className="design-menu-list" role="menu">
          {user && <div className="design-menu-user">{user.num} {user.name}</div>}
          {renaming ? (
            <form className="design-menu-rename" onSubmit={submitName}>
              <label htmlFor="design-rename">設計の名前</label>
              <input id="design-rename" className="dads-input" value={name} maxLength={30} autoFocus onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="dads-btn solid sm">決定</button>
            </form>
          ) : (
            <>
              {dbOk ? (
                <button role="menuitem" onClick={run(onOpenSaves)}>セーブデータを開く</button>
              ) : (
                <button role="menuitem" onClick={run(onImport)}>ファイルを開く</button>
              )}
              {onRename && <button role="menuitem" onClick={() => setRenaming(true)}>この設計の名前を変える</button>}
              <button role="menuitem" onClick={run(onExport)}>ファイルに書き出す</button>
              <button role="menuitem" onClick={run(onChangeUser)}>番号・名前を変える</button>
              <button role="menuitem" onClick={run(onHelp)}>操作方法を見る</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
