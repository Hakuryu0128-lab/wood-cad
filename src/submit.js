// 「先生に送る」：設計データを学校PCの提出受付サーバーへ送る。
// 送信先は public/config.json の submitUrl（コードを触らずに差し替えられる）。
// submitUrl が空なら「先生に送る」ボタンは出さない。

const CONFIG_URL = `${import.meta.env.BASE_URL}config.json`

export async function loadAppConfig() {
  try {
    const res = await fetch(CONFIG_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error('config.json not found')
    const data = await res.json()
    return { submitUrl: typeof data.submitUrl === 'string' ? data.submitUrl.replace(/\/+$/, '') : '' }
  } catch {
    return { submitUrl: '' }
  }
}

// 戻り値: { ok: true, receivedAt } / { ok: false, error }
export async function sendSubmission(submitUrl, payload, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${submitUrl}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (res.ok && data && data.ok) return { ok: true, receivedAt: data.receivedAt }
    return { ok: false, error: (data && data.error) || `エラー（${res.status}）` }
  } catch {
    return { ok: false, error: '先生のパソコンにつながりませんでした' }
  } finally {
    clearTimeout(timer)
  }
}
