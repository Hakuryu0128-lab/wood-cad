import { useEffect, useState } from 'react'
import { canAddLength, maxAddableLength } from './stock'

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

  // 材料ごとに「いま追加できるいちばん長い長さ」。0 なら選べない
  const maxOf = (p) => maxAddableLength(stock, boards, { thickness: p.thickness, width: p.width })
  // 材料1本を切らずにそのまま使える（ちょうど生材の長さ）か。切りしろが要らないので、最大より長くても入ることがある
  const wholeOk = (p) => p.quantity != null && canAddLength(stock, boards, { thickness: p.thickness, width: p.width, length: p.stockLength })
  const maxText = (p) => {
    const max = maxOf(p)
    if (max <= 0) return 'もう材料がありません'
    if (max < p.stockLength && wholeOk(p)) return `あと最大 ${max}mm（${p.stockLength}mmちょうどなら、切らずにそのまま使えます）`
    return `あと最大 ${max}mm まで切り出せます`
  }

  const selectProfile = (p) => {
    setProfile(p)
    setLength(Math.min(300, maxOf(p) || p.stockLength))
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
      setError('材料が足りないため、この長さでは追加できません。ほかの板の長さを見直してください。')
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
            <h2>板を追加：材料を選ぶ</h2>
            {stock.length === 0 ? (
              <p className="cutlist-empty">材料を読み込んでいます…</p>
            ) : (
              <div className="preset-row">
                {stock.map((s) => {
                  const max = maxOf(s)
                  return (
                    <button
                      key={`${s.thickness}x${s.width}`}
                      className="chip profile-chip"
                      onClick={() => selectProfile(s)}
                      disabled={max <= 0}
                    >
                      厚さ{s.thickness}×幅{s.width}
                      {s.quantity != null && (
                        <span className="profile-chip-sub">
                          長さ{s.stockLength}mmの材料 ×{s.quantity}本
                        </span>
                      )}
                      <span className={`profile-chip-max ${max <= 0 ? 'none' : ''}`}>
                        {maxText(s)}
                      </span>
                    </button>
                  )
                })}
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
              厚さ {profile.thickness}mm × 幅 {profile.width}mm（変更できません）
            </p>
            <p className="add-max">
              いま追加できるのは、長さ <b>{maxOf(profile)}mm</b> までです（切りしろを含めて計算しています）。
              {maxOf(profile) < profile.stockLength && wholeOk(profile) && `${profile.stockLength}mmちょうどなら、材料を切らずにそのまま使えます。`}
            </p>

            <div className="field-grid">
              <label>
                長さ（mm）
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
                ← 材料を選び直す
              </button>
              <button className="btn-primary" onClick={handleAdd}>
                この板を追加する
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
