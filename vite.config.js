import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // どのURL（GitHub Pagesのサブフォルダなど）に置いても動くよう相対パスでビルドする
  base: './',
})
