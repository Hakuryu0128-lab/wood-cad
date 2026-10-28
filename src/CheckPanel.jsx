import { summarizeStockUsage } from './stock'
import BarDiagram from './BarDiagram'
import { cm } from './space'

// 左上の「チェック」。材料が足りているか・置き場所に収まるかを、✓／✕ でひと目で分かるようにする。
// それぞれの行を押すと、くわしい画面（材料の残り／置き場所の設定）が開く。
export default function CheckPanel({ stock = [], boards = [], space, check, onOpenStock, onOpenSpace }) {
  const usage = summarizeStockUsage(stock, boards).filter((u) => u.quantity != null)
  const stockOk = usage.every((u) => u.fits)

  const size = check.size
  const over = check.overflow
  const spaceOver = space.enabled && (over.width > 0 || over.depth > 0 || over.height > 0)
  const overText = [
    over.width > 0 && `幅 ${cm(over.width)}cm`,
    over.depth > 0 && `奥行き ${cm(over.depth)}cm`,
    over.height > 0 && `高さ ${cm(over.height)}cm`,
  ].filter(Boolean).join('・')

  let spaceState = 'none'
  let spaceText = '置き場所：未設定'
  if (space.enabled && !size) { spaceState = 'none'; spaceText = '置き場所：板を置くと調べます' }
  else if (space.enabled && spaceOver) { spaceState = 'ng'; spaceText = `置き場所より大きいです（${overText}）` }
  else if (space.enabled) { spaceState = 'ok'; spaceText = '置き場所に収まります' }

  return (
    <section className="side-card check-panel" aria-label="チェック">
      <div className="check-title">チェック</div>
      {usage.length > 0 && (
        <button className={`check-row ${stockOk ? 'ok' : 'ng'}`} onClick={onOpenStock}>
          <span className="check-mark" aria-hidden="true">{stockOk ? '✓' : '✕'}</span>
          <span className="check-body">
            <span className="check-text">{stockOk ? '材料は足りています' : '材料が足りません'}</span>
            <span className="check-bars">
              {usage.map((u, i) => (
                <span key={i} className="check-bar-row">
                  <span className="check-bar-label">{u.thickness}×{u.width}</span>
                  {u.bars.map((bar, j) => <BarDiagram key={j} bar={bar} stockLength={u.stockLength} width={60} height={10} />)}
                </span>
              ))}
            </span>
          </span>
          <span className="check-go" aria-hidden="true">›</span>
        </button>
      )}
      <button className={`check-row ${spaceState}`} onClick={onOpenSpace}>
        <span className="check-mark" aria-hidden="true">{spaceState === 'ok' ? '✓' : spaceState === 'ng' ? '✕' : '・'}</span>
        <span className="check-body">
          <span className="check-text">{spaceText}</span>
          {size && <span className="check-sub">作品 {cm(size.width)}×{cm(size.depth)}×{cm(size.height)}cm（幅×奥行き×高さ）</span>}
        </span>
        <span className="check-go" aria-hidden="true">›</span>
      </button>
    </section>
  )
}
