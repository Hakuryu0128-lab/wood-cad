import { useEffect, useState } from 'react'

// 「先生に送る」画面。生徒はボタンを押すだけ。
function formatTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SubmitSheet({ open, owner, title, boardCount, thumbnail, lastSubmittedAt, onSend, onExport, onClose }) {
  const [state, setState] = useState('idle') // idle | sending | done | error
  const [error, setError] = useState('')
  const [doneAt, setDoneAt] = useState('')

  useEffect(() => {
    if (open) {
      setState('idle')
      setError('')
    }
  }, [open])

  if (!open) return null

  const send = async () => {
    setState('sending')
    const r = await onSend()
    if (r.ok) {
      setDoneAt(r.receivedAt)
      setState('done')
    } else {
      setError(r.error)
      setState('error')
    }
  }

  return (
    <div className="sheet-backdrop center" onClick={state === 'sending' ? undefined : onClose}>
      <div className="sheet modal-card submit-card" onClick={(e) => e.stopPropagation()}>
        {state === 'done' ? (
          <div className="submit-done">
            <div className="submit-check">✓</div>
            <h2>先生に送ったよ</h2>
            <p className="profile-readout">{formatTime(doneAt)} に届きました。直したら、もう一度送ってもいいよ。</p>
            <button className="btn-primary wide" onClick={onClose}>
              とじる
            </button>
          </div>
        ) : (
          <>
            <h2>先生に送る</h2>
            <div className="submit-preview">
              {thumbnail ? <img src={thumbnail} alt="" /> : <div className="submit-noimg">画像なし</div>}
            </div>
            <div className="submit-who">
              {owner?.num} {owner?.name}
            </div>
            <div className="profile-readout">
              {title} ・ 板 {boardCount}枚
              {lastSubmittedAt && <> ・ 前回 {formatTime(lastSubmittedAt)} に送信</>}
            </div>
            {boardCount === 0 && <p className="add-error">まだ板がないよ。板を置いてから送ろう。</p>}
            {state === 'error' && (
              <p className="add-error">
                送れなかった：{error}。もう一度押してみてね。だめなら先生に言おう。
              </p>
            )}
            <div className="sheet-actions">
              <button className="btn-secondary" onClick={onClose} disabled={state === 'sending'}>
                やめる
              </button>
              <button className="btn-primary" onClick={send} disabled={state === 'sending' || boardCount === 0}>
                {state === 'sending' ? '送っています…' : '送る'}
              </button>
            </div>
            <button className="link-btn" onClick={onExport}>
              ファイルに書き出す（予備）
            </button>
          </>
        )}
      </div>
    </div>
  )
}
