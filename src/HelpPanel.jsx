import { useEffect, useState } from 'react'

// 操作方法の説明（v12から移植）。開いて数秒で自動的に閉じ、ボタンでいつでも出せる。
export default function HelpPanel() {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(false), 8000)
    return () => clearTimeout(t)
  }, [open])

  if (!open) {
    return (
      <button className="help-toggle" onClick={() => setOpen(true)}>
        ？ 操作方法
      </button>
    )
  }

  return (
    <div className="help-panel">
      <div className="help-head">
        <span>操作方法</span>
        <button className="icon-btn light" onClick={() => setOpen(false)} aria-label="閉じる">
          ×
        </button>
      </div>
      <div className="help-row"><span className="help-key">板をドラッグ</span>板を水平に動かす（近づけると面がくっつく）</div>
      <div className="help-row"><span className="help-key">板をタップ</span>選ぶ → 右で長さ・木目・回転、右下で1cmずつ移動・上下</div>
      <div className="help-row"><span className="help-key">何もない所を1本指</span>見る向きを回す</div>
      <div className="help-row"><span className="help-key">2本指</span>ずらす・ズーム（ピンチ）</div>
      <div className="help-row"><span className="help-key">マウス</span>右ドラッグ＝ずらす、ホイール＝ズーム</div>
    </div>
  )
}
