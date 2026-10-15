import { useEffect, useState } from 'react'

// 置き場所の枠の設定シート。写真で測った幅・奥行き・高さを入れる。
export default function SpaceSheet({ open, space, onSave, onClose }) {
  const [draft, setDraft] = useState(space)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(space)
      setError('')
    }
  }, [open, space])

  if (!open) return null

  const set = (key) => (e) => {
    setDraft({ ...draft, [key]: e.target.value })
    setError('')
  }

  const save = (enabled) => {
    const w = Number(draft.width)
    const d = Number(draft.depth)
    const h = Number(draft.height)
    if (enabled && !(w > 0 && d > 0 && h > 0)) {
      setError('幅・奥行き・高さを正しく入力してください')
      return
    }
    onSave({ enabled, width: w > 0 ? w : space.width, depth: d > 0 ? d : space.depth, height: h > 0 ? h : space.height })
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>置き場所の大きさ</h2>
        <p className="profile-readout">
          写真で測った「置きたい場所」の大きさを入力してください。作品の真ん中に合わせて枠が表示され、作品が枠より大きいと赤くなります。
        </p>
        <div className="field-grid">
          <label>
            幅（左右） mm
            <input type="number" inputMode="numeric" min="1" value={draft.width} onChange={set('width')} />
          </label>
          <label>
            奥行き（前後） mm
            <input type="number" inputMode="numeric" min="1" value={draft.depth} onChange={set('depth')} />
          </label>
          <label>
            高さ（上下） mm
            <input type="number" inputMode="numeric" min="1" value={draft.height} onChange={set('height')} />
          </label>
        </div>
        {error && <p className="add-error">{error}</p>}
        <div className="sheet-actions">
          {space.enabled ? (
            <button className="btn-secondary" onClick={() => save(false)}>
              枠を消す
            </button>
          ) : (
            <button className="btn-secondary" onClick={onClose}>
              キャンセル
            </button>
          )}
          <button className="btn-primary" onClick={() => save(true)}>
            この大きさで表示する
          </button>
        </div>
      </div>
    </div>
  )
}
