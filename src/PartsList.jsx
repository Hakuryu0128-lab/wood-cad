import { useState } from 'react'

// 置いた板の一覧（v12から移植）。タップで選択できるので、板が重なって
// 画面上でつかみにくいときでも選べる。
export default function PartsList({ boards, selectedId, outsideIds, onSelect }) {
  const [open, setOpen] = useState(true)
  if (boards.length === 0) return null

  return (
    <div className="side-card parts-list">
      <button className="parts-list-head" onClick={() => setOpen(!open)}>
        <span>板の一覧（{boards.length}枚）</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="parts-list-body">
          {boards.map((b, i) => (
            <button
              key={b.id}
              className={`parts-item ${b.id === selectedId ? 'sel' : ''} ${outsideIds.has(b.id) ? 'over' : ''}`}
              onClick={() => onSelect(b.id)}
            >
              <span className="parts-no">{i + 1}</span>
              <span>
                {b.thickness}×{b.width}×{b.length}
                <span className="parts-sub"> 木目:{b.grainAxis === 'X' ? '長さ' : '幅'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
