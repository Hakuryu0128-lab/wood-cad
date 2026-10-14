import { summarizeStockUsage } from './stock'
import BarDiagram from './BarDiagram'

// 材料の在庫状況を大きく表示するモーダル。各生材ごとに、切り出した部材と
// 残り（端材）の長さをmm単位で確認できる。
export default function StockModal({ open, stock = [], boards = [], onClose }) {
  if (!open) return null

  const usage = summarizeStockUsage(stock, boards)

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stock-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cutlist-header">
          <h2>材料の在庫</h2>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {usage.length === 0 ? (
          <p className="cutlist-empty">在庫リストがありません</p>
        ) : (
          usage.map((u, i) => (
            <div key={i} className="stock-modal-profile">
              <h3 className="cutlist-subheading">
                厚み{u.thickness}mm × 幅{u.width}mm
                {!u.fits && <span className="stock-modal-warn"> ・ 材料が足りません</span>}
              </h3>

              {u.quantity == null ? (
                <p className="cutlist-empty">数量無制限（在庫チェックなし）</p>
              ) : (
                u.bars.map((bar, j) => (
                  <div key={j} className="stock-modal-bar">
                    <div className="stock-modal-bar-label">
                      {j + 1}本目（{u.stockLength}mm材）・残り {Math.round(bar.leftover)}mm
                      {!bar.fits && <span className="stock-modal-warn"> ・ 収まりません</span>}
                    </div>
                    <BarDiagram bar={bar} stockLength={u.stockLength} width={600} height={36} showLabels />
                  </div>
                ))
              )}
            </div>
          ))
        )}

        <div className="sheet-actions">
          <button className="btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
