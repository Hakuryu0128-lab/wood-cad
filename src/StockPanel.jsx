import { summarizeStockUsage } from './stock'
import BarDiagram from './BarDiagram'

// 左上に常時表示する、材料の残りを一目で確認できる小さいパネル。
// タップ/クリックすると拡大モーダルが開く。
export default function StockPanel({ stock = [], boards = [], onOpen }) {
  const limited = stock.filter((s) => s.quantity != null)
  if (limited.length === 0) return null

  const usage = summarizeStockUsage(stock, boards).filter((u) => u.quantity != null)

  return (
    <button className="stock-panel" onClick={onOpen}>
      <div className="stock-panel-title">材料の残り ›</div>
      {usage.map((u, i) => (
        <div key={i} className="stock-panel-row">
          <span className="stock-panel-label">
            {u.thickness}×{u.width}
          </span>
          <div className="stock-panel-bars">
            {u.bars.map((bar, j) => (
              <BarDiagram key={j} bar={bar} stockLength={u.stockLength} width={100} height={14} />
            ))}
          </div>
          {!u.fits && <span className="stock-panel-warn">材料が足りません</span>}
        </div>
      ))}
    </button>
  )
}
