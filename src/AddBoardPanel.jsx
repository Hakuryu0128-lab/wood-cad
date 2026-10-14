import { useEffect, useState } from 'react'
import { canAddLength } from './stock'

// 厚み・幅は変更しないルール：まず在庫リストから「どの板を使うか」(厚み×幅)を選び、
// そのあとに「どれだけの長さを切り出すか」を決める、という2段階の流れにする。
export default function AddBoardPanel({ open, onClose, onAdd, stock = [] , boards = [] }) {
  const [profile, setProfile] = useState(null)
  const [length, setLength] = useState(300)
  const [error, setError] = useState('')

  // 開くたびに種類選択からやり直す
  useEffect(() => {
    if (open) {
      setProfile(null)
      setError('')
    }
  }, [open])

  if (!open) return null

  const selectProfile = (p) => {
    setProfile(p)
    setLength(Math.min(300, p.stockLength))
    setError('')
  }

  const back = () => {
    setProfile(null)
    setError('')
  }

  const handleAdd = () => {
    const len = Number(length)
    if (!Number.isFinite(len) || len <= 0) {
      setError('長さを正しく入力してください')
      return
    }
    if (len > profile.stockLength) {
      setError(`この板の生材は${profile.stockLength}mmまでです`)
      return
    }
    const ok = canAddLength(stock, boards, { thickness: profile.thickness, width: profile.width, length: len })
    if (!ok) {
      setError('在庫が足りません。他の板の長さを見直すか、この長さでは追加できません。')
      return
    }
    onAdd({ thickness: profile.thickness, width: profile.width, length: len })
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {!profile ? (
          <>
            <h2>板を追加：種類を選ぶ</h2>
            {stock.length === 0 ? (
              <p className="cutlist-empty">在庫を読み込み中…</p>
            ) : (
              <div className="preset-row">
                {stock.map((s) => (
                  <button
                    key={`${s.thickness}x${s.width}`}
                    className="chip profile-chip"
                    onClick={() => selectProfile(s)}
                  >
                    厚み{s.thickness}×幅{s.width}
                    {s.quantity != null && (
                      <span className="profile-chip-sub">
                        {s.stockLength}mm材 ×{s.quantity}本
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="sheet-actions">
              <button className="btn-secondary" onClick={onClose}>
                キャンセル
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>板を追加：長さを決める</h2>
            <p className="profile-readout">
              厚み {profile.thickness}mm ・ 幅 {profile.width}mm（固定）
            </p>

            <div className="field-grid">
              <label>
                長さ (mm)
                <input
                  type="number"
                  min="1"
                  max={profile.stockLength}
                  value={length}
                  onChange={(e) => {
                    setLength(e.target.value)
                    setError('')
                  }}
                />
              </label>
            </div>

            {error && <p className="add-error">{error}</p>}

            <div className="sheet-actions">
              <button className="btn-secondary" onClick={back}>
                ← 種類を選び直す
              </button>
              <button className="btn-primary" onClick={handleAdd}>
                この板を追加
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
