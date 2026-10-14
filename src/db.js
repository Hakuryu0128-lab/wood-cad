// IndexedDB を使ったブラウザ内の保存（セーブデータ）。
//
// - profile ストア … 番号・名前（key: 'user'）。一度入れれば次からは入力不要
// - saves ストア   … 設計データのセーブスロット。いくつでも持てる
//     { id, num, name, title, boards, space, thumbnail, createdAt, updatedAt }
//
// localStorage より容量が大きく（サムネイル画像も入る）、スロットを何個でも持てる。
// ただしブラウザのデータを消すと消えるので、提出・持ち帰り用には
// これまで通り「ファイルに書き出し」を使う。
//
// IndexedDB が使えない環境（プライベートブラウズ等）では open が失敗する。
// その場合は呼び出し側でメモリ上だけで動かし、ファイル書き出しを案内する。

const DB_NAME = 'wood-cad'
const DB_VERSION = 1

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile')
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
  // 失敗したら次回また開き直せるようにする
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

// ストアに対して1回の操作をする小さなヘルパー
async function run(storeName, mode, fn) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result
    const req = fn(store)
    if (req) req.onsuccess = () => (result = req.result)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function isAvailable() {
  try {
    await openDB()
    return true
  } catch {
    return false
  }
}

// ---- 番号・名前 ----

export async function getUser() {
  const u = await run('profile', 'readonly', (s) => s.get('user'))
  return u && typeof u.num === 'string' && typeof u.name === 'string' ? u : null
}

export async function setUser(user) {
  await run('profile', 'readwrite', (s) => s.put({ num: user.num, name: user.name }, 'user'))
}

// ---- セーブデータ ----

export function newSaveId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

// 一覧（新しく更新した順）。user を渡すとその人のデータだけ
export async function listSaves(user = null) {
  const all = (await run('saves', 'readonly', (s) => s.getAll())) || []
  const mine = user ? all.filter((r) => r.num === user.num && r.name === user.name) : all
  return mine.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getSave(id) {
  return (await run('saves', 'readonly', (s) => s.get(id))) || null
}

// 保存（上書き）。updatedAt は自動で今の時刻にする。
// keepTime=true なら更新日時を変えない（名前の変更だけのときなど、並び順を動かさないため）
export async function putSave(record, { keepTime = false } = {}) {
  const now = Date.now()
  const rec = {
    ...record,
    createdAt: record.createdAt || now,
    updatedAt: keepTime && record.updatedAt ? record.updatedAt : now,
  }
  await run('saves', 'readwrite', (s) => s.put(rec))
  return rec
}

export async function deleteSave(id) {
  await run('saves', 'readwrite', (s) => s.delete(id))
}

// 既存のデータを別のセーブデータとして複製する（「この形をもとに別案を作る」用）
export async function duplicateSave(id, title) {
  const src = await getSave(id)
  if (!src) return null
  return putSave({ ...src, id: newSaveId(), title, createdAt: 0 })
}

// 同じ人のデータの中で使われていない「設計◯」の名前を作る
export function nextTitle(saves) {
  const used = new Set(saves.map((s) => s.title))
  let n = saves.length + 1
  while (used.has(`設計${n}`)) n++
  return `設計${n}`
}
