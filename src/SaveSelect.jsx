import { useState } from 'react'

// セーブデータ選択画面。起動時と、ツールバーの「セーブデータ」から開く。
// セーブデータはブラウザ内（IndexedDB）に保存され、編集すると自動で上書きされる。

function formatTime(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SaveCard({ save, current, showOwner, onOpen, onDuplicate, onRename, onDelete, onExport }) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(save.title)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const submitRename = (e) => {
    e.preventDefault()
    const t = title.trim()
    if (t) onRename(save.id, t)
    setRenaming(false)
  }

  return (
    <div className={`save-card ${current ? 'current' : ''}`}>
      <button className="save-thumb" onClick={() => onOpen(save.id)} aria-label={`${save.title}を開く`}>
        {save.thumbnail ? <img src={save.thumbnail} alt="" /> : <span className="save-thumb-empty">まだ板がない</span>}
        {current && <span className="save-current-badge">いま開いている</span>}
      </button>
      <div className="save-info">
        {renaming ? (
          <form onSubmit={submitRename} className="save-rename">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={30} autoFocus />
            <button type="submit" className="btn-primary small">決定</button>
          </form>
        ) : (
          <div className="save-title">{save.title}</div>
        )}
        <div className="save-meta">
          {formatTime(save.updatedAt)} ・ 板 {save.boards?.length || 0}枚
          {save.submittedAt && <span className="save-submitted"> ・ 送信済み {formatTime(new Date(save.submittedAt).getTime())}</span>}
          {showOwner && (
            <>
              {' '}・ {save.num} {save.name}
            </>
          )}
        </div>
        <div className="save-actions">
          <button className="btn-primary small" onClick={() => onOpen(save.id)}>
            開く
          </button>
          <button className="btn-secondary small" onClick={() => onDuplicate(save.id)}>
            コピー
          </button>
          <button className="btn-secondary small" onClick={() => setRenaming(true)}>
            名前
          </button>
          <button className="btn-secondary small" onClick={() => onExport(save.id)}>
            書き出し
          </button>
          {confirmDelete ? (
            <button className="btn-danger-small" onClick={() => onDelete(save.id)} onBlur={() => setConfirmDelete(false)}>
              本当に消す
            </button>
          ) : (
            <button className="btn-secondary small" onClick={() => setConfirmDelete(true)}>
              削除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SaveSelect({
  user,
  saves,
  showAll,
  currentId,
  onToggleShowAll,
  onOpen,
  onNew,
  onDuplicate,
  onRename,
  onDelete,
  onImport,
  onExport,
  onChangeUser,
  onClose,
}) {
  return (
    <div className="save-screen">
      <div className="save-screen-inner">
        <div className="save-head">
          <div>
            <h2>セーブデータ</h2>
            <p className="profile-readout">開くデータを選ぼう。編集すると自動で保存されるよ。</p>
          </div>
          <div className="save-head-right">
            {user && (
              <button className="user-chip" onClick={onChangeUser} title="番号・名前を変える">
                {user.num} {user.name}（変更）
              </button>
            )}
            {onClose && (
              <button className="icon-btn" onClick={onClose} aria-label="閉じる">
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="save-toolbar">
          <button className="btn-primary" onClick={onNew}>
            ＋ 新しく作る
          </button>
          <button className="btn-secondary" onClick={onImport}>
            ファイルから読み込む
          </button>
          <label className="save-showall">
            <input type="checkbox" checked={showAll} onChange={(e) => onToggleShowAll(e.target.checked)} />
            ほかの人のデータも表示
          </label>
        </div>

        {saves.length === 0 ? (
          <p className="cutlist-empty">まだセーブデータがないよ。「＋ 新しく作る」から始めよう。</p>
        ) : (
          <div className="save-grid">
            {saves.map((s) => (
              <SaveCard
                key={s.id}
                save={s}
                current={s.id === currentId}
                showOwner={showAll}
                onOpen={onOpen}
                onDuplicate={onDuplicate}
                onRename={onRename}
                onDelete={onDelete}
                onExport={onExport}
              />
            ))}
          </div>
        )}

        <p className="save-note">
          セーブデータはこのiPad（ブラウザ）の中だけに保存されるよ。別の端末で続きをするときは「書き出し」でファイルにしてね。
        </p>
      </div>
    </div>
  )
}
