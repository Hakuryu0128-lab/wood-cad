// 生材1本を横棒で表し、切り出した部材を色分け表示する図。
// 使われていない部分（在庫としてまだ残っている部分）は背景色のまま透けて見える。
const PIECE_COLORS = ['#8a6d3b', '#b08a52']

export default function BarDiagram({ bar, stockLength, width = 220, height = 22, showLabels = false }) {
  const scale = width / stockLength
  const labelHeight = showLabels ? 14 : 0
  const svgH = height + labelHeight

  return (
    <svg width={width} height={svgH} viewBox={`0 0 ${width} ${svgH}`}>
      <rect x={0} y={0} width={width} height={height} rx={3} fill="#eef2f6" stroke="#c7cdd6" strokeWidth="1" />
      {bar.placed.map((p, i) => (
        <rect
          key={i}
          x={p.start * scale}
          y={0}
          width={Math.max((p.end - p.start) * scale, 0.5)}
          height={height}
          fill={PIECE_COLORS[i % PIECE_COLORS.length]}
        />
      ))}
      {/* 切断線：部材同士の間 */}
      {bar.placed.slice(0, -1).map((p, i) => (
        <line key={`cut-${i}`} x1={p.end * scale} y1={0} x2={p.end * scale} y2={height} stroke="#2a2f36" strokeWidth="1" />
      ))}
      {/* 最後の部材と端材の間の切断線（端材が残る場合のみ） */}
      {bar.placed.length > 0 && bar.leftover > 0 && (
        <line
          x1={bar.placed[bar.placed.length - 1].end * scale}
          y1={0}
          x2={bar.placed[bar.placed.length - 1].end * scale}
          y2={height}
          stroke="#2a2f36"
          strokeWidth="1"
        />
      )}
      <rect x={0} y={0} width={width} height={height} rx={3} fill="none" stroke="#c7cdd6" strokeWidth="1" />
      {showLabels &&
        bar.placed.map((p, i) => (
          <text
            key={`label-${i}`}
            x={((p.start + p.end) / 2) * scale}
            y={height + 11}
            fontSize="9"
            textAnchor="middle"
            fill="#5a616b"
          >
            {p.length}
          </text>
        ))}
    </svg>
  )
}
