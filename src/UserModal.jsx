import { useState } from 'react'

// 起動時の「4連番号・名前」入力（v12から移植）。
// 入力した内容は画面上部に表示し、保存ファイル名と木取り表にも入れる。
export default function UserModal({ open, initial, onSubmit, onCancel }) {
  const [num, setNum] = useState(initial?.num || '')
  const [name, setName] = useState(initial?.name || '')
  const [error, setError] = useState('')
  if (!open) return null

  const submit = (e) => {
    e.preventDefault()
    const n = num.trim()
    const nm = name.trim()
    if (!n || !nm) {
      setError('番号と名前を入力してください')
      return
    }
    onSubmit({ num: n, name: nm })
  }

  return (
    <div className="sheet-backdrop center">
      <form className="sheet modal-card" onSubmit={submit}>
        <h2>木工CAD</h2>
        <p className="profile-readout">はじめに番号と名前を入力してください。次回からは入力する必要はありません。</p>
        <div className="field-grid">
          <label>
            4連番号
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="1205"
              value={num}
              onChange={(e) => {
                setNum(e.target.value)
                setError('')
              }}
            />
          </label>
          <p className="field-note">例：1年2組5番 → 1205</p>
          <label>
            名前
            <input
              type="text"
              placeholder="山田 太郎"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
            />
          </label>
        </div>
        {error && <p className="add-error">{error}</p>}
        <div className="sheet-actions">
          {onCancel && (
            <button type="button" className="btn-secondary" onClick={onCancel}>
              キャンセル
            </button>
          )}
          <button type="submit" className="btn-primary">
            はじめる
          </button>
        </div>
      </form>
    </div>
  )
}
