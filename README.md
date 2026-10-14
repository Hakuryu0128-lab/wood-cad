# 木工CAD（wood-cad）

中学1年「材料と加工の技術」で、木材の製作品を設計するためのWebアプリ。iPad / Chromebook のブラウザで動く。

- 公開URL: https://woodcad.hakuryu.f5.si
- 本体: React + Vite + three.js（`src/`）
- 在庫（使える板材）: `public/stock.json`
- 提出先の設定: `public/config.json` の `submitUrl`（空にすると「先生に送る」ボタンが消える）
- 提出受付サーバー（学校PC用）: `server/woodcad_submit.py`（Python標準ライブラリだけ）

## 開発

```
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ に公開用ファイル
```

`main` に push すると GitHub Actions がビルドして GitHub Pages に公開する（`.github/workflows/deploy.yml`）。
