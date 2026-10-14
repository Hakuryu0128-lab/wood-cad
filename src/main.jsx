import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA：ホーム画面に追加して、電波がなくても開けるようにする（公開版だけ）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}

// ブラウザの保存データ（セーブデータ）を、容量が少なくなっても消されにくくする
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {})
}
