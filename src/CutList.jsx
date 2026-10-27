import { useId, useMemo } from 'react'
import { summarizeStockUsage } from './stock'
import { cm } from './space'
import { cornersSummary, outlinePoints, hasCorners } from './corners'

// 同じ厚み・幅・長さ・木目方向の板をまとめて「◯枚」とカウントする
function groupBoards(boards) {
  const map = new Map()
  boards.forEach((b) => {
    // 角の加工が違う板は別の行にする
    const corners = hasCorners(b) ? b.corners : null
    const key = `${b.thickness}x${b.width}x${b.length}x${b.grainAxis}x${JSON.stringify(corners)}`
    if (!map.has(key)) {
      map.set(key, { thickness: b.thickness, width: b.width, length: b.length, grainAxis: b.grainAxis, corners, count: 0 })
    }
    map.get(key).count += 1
  })
  return Array.from(map.values()).sort((a, b) => b.length - a.length || b.width - a.width || b.thickness - a.thickness)
}

// 板1枚分の簡易寸法図（上から見た形＋木目の向き＋寸法）
function CutDiagram({ length, width, grainAxis, corners }) {
  const clipId = 'cut' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const maxDim = 100
  const scale = maxDim / Math.max(length, width)
  const w = Math.max(length * scale, 10)
  const h = Math.max(width * scale, 10)
  const pad = 16
  const svgW = w + pad * 2
  const svgH = h + pad * 2 + 4

  const grainLines = []
  const lineCount = 5
  if (grainAxis === 'X') {
    for (let i = 1; i < lineCount; i++) {
      const y = pad + (h / lineCount) * i
      grainLines.push(<line key={i} x1={pad} y1={y} x2={pad + w} y2={y} stroke="#c8b590" strokeWidth="1" />)
    }
  } else {
    for (let i = 1; i < lineCount; i++) {
      const x = pad + (w / lineCount) * i
      grainLines.push(<line key={i} x1={x} y1={pad} x2={x} y2={pad + h} stroke="#c8b590" strokeWidth="1" />)
    }
  }

  return (
    <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
      {corners ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <polygon points={outlinePoints(length, width, corners).map(([x, y]) => `${pad + (x + length / 2) * scale},${pad + (width / 2 - y) * scale}`).join(' ')} />
            </clipPath>
          </defs>
          <rect x={pad} y={pad} width={w} height={h} fill="none" stroke="#c8b590" strokeDasharray="3 2" strokeWidth="1" />
          <g clipPath={`url(#${clipId})`}>
            <rect x={pad} y={pad} width={w} height={h} fill="#f1e4c8" />
            {grainLines}
          </g>
          <polygon
            points={outlinePoints(length, width, corners).map(([x, y]) => `${pad + (x + length / 2) * scale},${pad + (width / 2 - y) * scale}`).join(' ')}
            fill="none" stroke="#8a6d3b" strokeWidth="1.5"
          />
        </>
      ) : (
        <>
          <rect x={pad} y={pad} width={w} height={h} fill="#f1e4c8" stroke="#8a6d3b" strokeWidth="1.5" />
          {grainLines}
        </>
      )}
      <text x={pad + w / 2} y={pad - 4} fontSize="9" textAnchor="middle" fill="#5a616b">
        {length}
      </text>
      <text
        x={pad - 6}
        y={pad + h / 2}
        fontSize="9"
        textAnchor="middle"
        fill="#5a616b"
        transform={`rotate(-90 ${pad - 6} ${pad + h / 2})`}
      >
        {width}
      </text>
    </svg>
  )
}

export default function CutList({ open, boards, stock = [], user, title, space, spaceCheck, onClose }) {
  const groups = useMemo(() => groupBoards(boards), [boards])
  const usage = useMemo(() => summarizeStockUsage(stock, boards), [stock, boards])
  if (!open) return null

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet cutlist-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cutlist-header">
          <h2>木取り表</h2>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cutlist-meta">
          <span>番号 {user?.num || '　　'}</span>
          <span>名前 {user?.name || '　　　　'}</span>
          {title && <span>{title}</span>}
          <span>{new Date().toLocaleDateString('ja-JP')}</span>
        </div>

        {(space?.enabled || spaceCheck?.size) && (
          <table className="cutlist-table stock-table">
            <thead>
              <tr>
                <th></th>
                <th>幅</th>
                <th>奥行き</th>
                <th>高さ</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {space?.enabled && (
                <tr>
                  <td>置き場所</td>
                  <td>{cm(space.width)}cm</td>
                  <td>{cm(space.depth)}cm</td>
                  <td>{cm(space.height)}cm</td>
                  <td rowSpan={spaceCheck?.size ? 2 : 1}>
                    {!spaceCheck?.size ? '—' : spaceCheck.outsideIds.size > 0 ? '大きすぎる' : '収まる'}
                  </td>
                </tr>
              )}
              {spaceCheck?.size && (
                <tr className={space?.enabled && spaceCheck.outsideIds.size > 0 ? 'stock-over' : ''}>
                  <td>作品</td>
                  <td>{cm(spaceCheck.size.width)}cm</td>
                  <td>{cm(spaceCheck.size.depth)}cm</td>
                  <td>{cm(spaceCheck.size.height)}cm</td>
                  {!space?.enabled && <td>—</td>}
                </tr>
              )}
            </tbody>
          </table>
        )}

        {usage.length > 0 && (
          <>
            <h3 className="cutlist-subheading">在庫状況</h3>
            <table className="cutlist-table stock-table">
              <thead>
                <tr>
                  <th>厚さ</th>
                  <th>幅</th>
                  <th>材料</th>
                  <th>使う長さ（切りしろを含む）</th>
                  <th>容量</th>
                  <th>判定</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u, i) => {
                  const over = u.quantity != null && !u.fits
                  return (
                    <tr key={i} className={over ? 'stock-over' : ''}>
                      <td>{u.thickness}mm</td>
                      <td>{u.width}mm</td>
                      <td>{u.quantity != null ? `${u.stockLength}mm ×${u.quantity}本` : '無制限'}</td>
                      <td>
                        {Math.round(u.totalRequired)}mm（{u.count}枚）
                      </td>
                      <td>{u.totalCapacity ?? '—'}</td>
                      <td>{u.quantity == null ? '—' : u.fits ? 'OK' : '不足'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        <h3 className="cutlist-subheading">木取り図</h3>
        {groups.length === 0 ? (
          <p className="cutlist-empty">板がまだありません。板を追加すると、ここに表示されます。</p>
        ) : (
          <>
            <table className="cutlist-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>木取り図</th>
                  <th>厚さ</th>
                  <th>幅</th>
                  <th>長さ</th>
                  <th>木目の向き</th>
                  <th>角の加工</th>
                  <th>枚数</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <CutDiagram length={g.length} width={g.width} grainAxis={g.grainAxis} corners={g.corners} />
                    </td>
                    <td>{g.thickness}mm</td>
                    <td>{g.width}mm</td>
                    <td>{g.length}mm</td>
                    <td>{g.grainAxis === 'X' ? '長さ方向' : '幅方向'}</td>
                    <td className="cutlist-corners">{g.corners ? cornersSummary(g.corners) : 'なし'}</td>
                    <td>{g.count}枚</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cutlist-total">合計 {boards.length}枚</p>
          </>
        )}

        <div className="sheet-actions">
          <button className="btn-secondary" onClick={onClose}>
            閉じる
          </button>
          <button className="btn-primary" onClick={() => window.print()} disabled={groups.length === 0}>
            印刷 / PDF保存
          </button>
        </div>
      </div>
    </div>
  )
}
