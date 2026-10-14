// 在庫（今回の授業で使える木材のリスト）を起動時に読み込むための仕組み。
// 板は「厚み・幅」が固定されたプロファイルの中から選び、そこから任意の長さを
// 切り出す運用にする（1本の生材(stockLength)を、必要な長さの部材に切り分けるイメージ）。
// public/stock.json を編集すれば、コードを触らずに授業ごとの在庫内容を差し替えられる。
// 例: [{ "thickness": 15, "width": 150, "stockLength": 600, "quantity": 2 }, ...]

const STOCK_URL = `${import.meta.env.BASE_URL}stock.json`

// stock.jsonが無い/読み込めない場合に使う既定の在庫（quantity:null＝数量無制限＝チェックなし）
const FALLBACK_STOCK = [{ thickness: 9, width: 40, stockLength: 900, quantity: null }]

// 切断線から仕上がり寸法線までのクリアランス（片側、mm）。
// 部品と部品の間には両側分＝4mm、生材の端に接する側はクリアランス不要。
const CLEARANCE = 2

export async function loadStock() {
  try {
    const res = await fetch(STOCK_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error('stock.json not found')
    const data = await res.json()
    if (!Array.isArray(data)) throw new Error('invalid stock.json')
    const parsed = data
      .filter((s) => s && Number(s.thickness) > 0 && Number(s.width) > 0 && Number(s.stockLength) > 0)
      .map((s) => ({
        thickness: Number(s.thickness),
        width: Number(s.width),
        stockLength: Number(s.stockLength),
        quantity: s.quantity == null ? null : Number(s.quantity),
      }))
    return parsed.length > 0 ? parsed : FALLBACK_STOCK
  } catch (e) {
    return FALLBACK_STOCK
  }
}

// 部材を生材の左端から順に並べたときの、実際に必要な生材長さと配置(切断位置)を計算する。
// - 部材と部材の間（切断線）は、両側の仕上がり寸法線までのクリアランス分＝4mm必要
// - 生材の左端に接する最初の部材の左側はクリアランス不要（切る必要がないため）
// - 最後の部材の右側に端材が残る場合は、切り離すための切断線が必要＝+2mm
//   （残らずぴったり生材の端まで使い切る場合は不要）
export function layoutPieces(pieces, stockLength, clearance = CLEARANCE) {
  let pos = 0
  const placed = []
  pieces.forEach((piece, i) => {
    if (i > 0) pos += clearance * 2
    const start = pos
    const end = pos + piece.length
    placed.push({ ...piece, start, end })
    pos = end
  })
  let usedLength = pos
  const hasLeftover = placed.length > 0 && usedLength < stockLength - 1e-6
  if (hasLeftover) usedLength += clearance
  const leftover = Math.max(stockLength - usedLength, 0)
  return { placed, usedLength, leftover, fits: usedLength <= stockLength + 1e-6 }
}

// piecesを、長さstockLengthの生材quantity本にBest-Fit方式で詰め込む。
// quantityがnullなら生材は無制限にあるとみなす。
export function packBars(pieces, stockLength, quantity) {
  const sorted = [...pieces].sort((a, b) => b.length - a.length)
  const unlimited = quantity == null
  const bins = unlimited ? [] : Array.from({ length: quantity }, () => [])
  const unassigned = []

  for (const piece of sorted) {
    let bestIdx = -1
    let bestLeftover = Infinity
    for (let i = 0; i < bins.length; i++) {
      const trial = layoutPieces([...bins[i], piece], stockLength)
      if (trial.fits && trial.leftover < bestLeftover) {
        bestLeftover = trial.leftover
        bestIdx = i
      }
    }
    if (bestIdx === -1 && unlimited) {
      bins.push([piece])
    } else if (bestIdx === -1) {
      unassigned.push(piece)
    } else {
      bins[bestIdx] = [...bins[bestIdx], piece]
    }
  }

  const bars = bins.map((binPieces) => layoutPieces(binPieces, stockLength))
  return { fits: unassigned.length === 0, bars, unassigned }
}

// 現在配置されている板を、在庫のプロファイル（厚み・幅）ごとに集計する。
// quantityが設定されているプロファイルは、実際の切り出し可否(クリアランス込み)を計算する。
export function summarizeStockUsage(stock, boards) {
  return stock.map((s) => {
    const pieces = boards
      .filter((b) => b.thickness === s.thickness && b.width === s.width)
      .map((b) => ({ id: b.id, length: b.length }))
    const totalUsed = pieces.reduce((sum, p) => sum + p.length, 0)

    if (s.quantity == null) {
      return { ...s, count: pieces.length, totalUsed, totalRequired: totalUsed, totalCapacity: null, fits: true, bars: [] }
    }

    const { fits, bars } = packBars(pieces, s.stockLength, s.quantity)
    const totalRequired = bars.reduce((sum, b) => sum + b.usedLength, 0)
    return {
      ...s,
      count: pieces.length,
      totalUsed,
      totalRequired,
      totalCapacity: s.stockLength * s.quantity,
      fits,
      bars,
    }
  })
}

// 指定プロファイル(thickness/width)に、新しく長さlengthの部材を追加しても在庫内に収まるか判定する。
// プロファイルが在庫リストに無い、または数量無制限なら常にtrue。
export function canAddLength(stock, boards, { thickness, width, length }) {
  const entry = stock.find((s) => s.thickness === thickness && s.width === width)
  if (!entry || entry.quantity == null) return true
  const pieces = boards
    .filter((b) => b.thickness === thickness && b.width === width)
    .map((b) => ({ id: b.id, length: b.length }))
  pieces.push({ id: '__candidate__', length })
  return packBars(pieces, entry.stockLength, entry.quantity).fits
}
