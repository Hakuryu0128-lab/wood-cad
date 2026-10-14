// 木工CAD の Service Worker
// - アプリ本体（HTML・JS・CSS・アイコン）を端末に保存し、電波がなくても開けるようにする
// - HTML と設定（config.json / stock.json）は「まずネット、だめなら保存分」なので、
//   GitHub に新しい版を上げると、次に開いたときに新しい版になる
// - JS/CSS はファイル名にハッシュが付いていて中身が変わると名前も変わるので「保存分を優先」
// - 提出（別のサーバーへの送信）には一切関わらない（同じサイト内のGETだけ扱う）

const CACHE = 'woodcad-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const res = await fetch('./', { cache: 'no-store' })
      const html = await res.clone().text()
      await cache.put('./', res)
      // index.html が読み込んでいるファイルをまとめて保存する
      const urls = new Set(['./manifest.webmanifest', './stock.json', './config.json', './icons/icon-192.png', './icons/apple-touch-icon.png'])
      for (const m of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) urls.add(m[1])
      await Promise.all(
        [...urls].map((u) =>
          fetch(u, { cache: 'no-store' })
            .then((r) => (r.ok ? cache.put(u, r) : null))
            .catch(() => null)
        )
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(request, { cache: 'no-store' })
    if (res.ok) cache.put(cacheKey || request, res.clone())
    return res
  } catch {
    const hit = await cache.match(cacheKey || request)
    if (hit) return hit
    throw new Error('offline and not cached')
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    // ページを開くとき：最新のHTML。オフラインなら保存してあるHTML
    event.respondWith(networkFirst(req, './'))
    return
  }
  if (url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(req))
    return
  }
  event.respondWith(cacheFirst(req))
})
