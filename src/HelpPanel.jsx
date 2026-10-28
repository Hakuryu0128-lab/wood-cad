// 操作方法の説明（v12から移植）。はじめて開いたときに出し、あとは上の「設計 ▼」メニューの「操作方法を見る」から出す。
export default function HelpPanel({ onClose }) {
  return (
    <div className="help-panel" role="dialog" aria-label="操作方法">
      <div className="help-head">
        <span>操作方法</span>
        <button className="icon-btn light" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      <div className="help-row"><span className="help-key">板をドラッグ</span>板を水平に動かします。ほかの板に近づけると、面がぴったりくっつきます</div>
      <div className="help-row"><span className="help-key">板をタップ</span>板を選びます。右のパネルで向き・長さ・木目・角の加工を変えます</div>
      <div className="help-row"><span className="help-key">何もない所を1本指</span>見る向きを変えます</div>
      <div className="help-row"><span className="help-key">2本指</span>画面をずらします。指を広げる・閉じるで拡大・縮小します</div>
      <div className="help-row"><span className="help-key">マウス</span>右ボタンでドラッグすると画面をずらし、ホイールで拡大・縮小します</div>
      <div className="help-row"><span className="help-key">もう一度見るとき</span>左上の「設計 ▼」→「操作方法を見る」</div>
      <button className="dads-btn solid md wide help-ok" onClick={onClose}>わかりました</button>
    </div>
  )
}
