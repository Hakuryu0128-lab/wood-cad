// ブラウザへの自動保存(localStorage)と、ファイルへの書き出し・読み込み(JSON)。
// Chromebook / iPad でブラウザのデータが消えてしまう環境でも、ファイルとして
// 手元に残しておけば「続きから編集」できるようにするための仕組み。
//
// 保存する中身: { boards, space }（space＝置き場所の枠）
// ファイルにはさらに meta: { num, name }（4連番号・名前）を入れ、ファイル名にも付ける
// （v12の「日時_番号_名前.json」形式を移植。提出ファイルを集めたときに誰のものか分かるように）

const STORAGE_KEY = 'wood-cad-autosave-v1'
const USER_KEY = 'wood-cad-user-v1'

export function saveToLocalStorage({ boards, space }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards, space, savedAt: Date.now() }))
  } catch (e) {
    // 保存容量オーバー・プライベートブラウズ等は無視する（次の変更時にまた保存を試みる）
  }
}

// 戻り値: { boards, space } または null。旧形式（boardsのみ）も読める
export function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!Array.isArray(data.boards)) return null
    return { boards: data.boards, space: data.space || null }
  } catch (e) {
    return null
  }
}

export function saveUser(user) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch (e) {
    // 無視
  }
}

export function loadUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw)
    return u && typeof u.num === 'string' && typeof u.name === 'string' ? u : null
  } catch (e) {
    return null
  }
}

function stamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

// ファイル名に使えない文字を取り除く
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '')

export function makeFileName(user) {
  const parts = [stamp(), safe(user?.num), safe(user?.name)].filter(Boolean)
  return `${parts.join('_')}.json`
}

// 現在の設計をJSONファイルとしてダウンロードする
export function exportDesignToFile({ boards, space, user }) {
  const data = JSON.stringify(
    {
      version: 2,
      meta: { num: user?.num || '', name: user?.name || '', savedAt: new Date().toISOString() },
      boards,
      space,
    },
    null,
    2
  )
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = makeFileName(user)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// JSONファイルを読み込んで { boards, space, meta } を返す（旧形式は space/meta が null）
export function importDesignFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (!Array.isArray(data.boards)) throw new Error('invalid file')
        resolve({ boards: data.boards, space: data.space || null, meta: data.meta || null })
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

// ---- 閉じる直前の控え ----
// IndexedDB への保存は非同期なので、タブを閉じる・再読み込みする直前の変更は
// 書き終わる前にページが消えて失われることがある。そこで、ページが隠れる瞬間に
// 同期的に書ける localStorage へ控えを取り、次に開いたときにセーブデータへ戻す。
const PENDING_KEY = 'wood-cad-pending-v1'

export function writePending(data) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(data))
  } catch {
    // 容量不足などは無視
  }
}

export function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // 無視
  }
}
