# 公開と提出のしくみ：やること

全体の形

```
生徒のiPad（ホーム画面の「木工CAD」）
   │ 開く                         │「先生に送る」
   ▼                              ▼
https://woodcad.hakuryu.f5.si    https://woodcad-submit.hakuryu.f5.si
（GitHub Pages）                  （Cloudflare Tunnel → 集め先PCの localhost:8010）
                                    └ WoodCAD-Receiver\data\submissions\日付\ に保存
                                    └ 同じURLを先生が開くと提出一覧（パスワード付き）
```

---

## 1. GitHub に公開する（1回だけ）

1. GitHub で空のリポジトリ `wood-cad` を作る（**Public**。README などは付けない）
2. コードを push する（Claude がやる。または `wood_cad` フォルダから `git push`）
3. リポジトリの **Settings → Pages**
   - Source：**GitHub Actions**
   - Custom domain：`woodcad.hakuryu.f5.si` → Save
4. **Actions** タブで「Deploy to GitHub Pages」が緑になるのを待つ

## 2. Cloudflare の DNS（1回だけ）

`hakuryu.f5.si` → **DNS → Records → Add record**

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `woodcad` | `hakuryu0128-lab.github.io` | **DNS only（グレーの雲）** |

- 数分〜1時間ほどで GitHub の Pages 設定に「DNS check successful」と出る。証明書ができたら **Enforce HTTPS** にチェック
- **学校のiPadで開けなかったら**：フィルタが GitHub のIPアドレスで止めている可能性がある。そのときは Proxy を **Proxied（オレンジの雲）** に変え、SSL/TLS を「Full」にすると、school-intercom と同じ Cloudflare 経由の通り道になる。ただしこの組み合わせはまだ試していない（GitHub側の証明書の更新がうまくいかないことがあるらしい）ので、その時は一緒に確認しよう

## 3. 集め先PCで受け取る（風呂敷版 `WoodCAD-Receiver`）

集め先PC：技術室の電子黒板につないでいるPC（WEEKYの風呂敷と同じPC。いっしょに動く）

WEEKYの風呂敷と同じ考え方で作ってある：**フォルダをコピーして `WoodCAD.cmd` を押すだけで全部そろい、フォルダごと消せば跡が残らない。**

1. `wood_cad\WoodCAD-Receiver` フォルダを丸ごと、そのPCにコピーする（例：`C:\WoodCAD-Receiver`。OneDriveの中は避ける）
   - Node と cloudflared は `runtime\` に同梱してある。Python もインストールも要らない
2. `WoodCAD.cmd` をダブルクリック → ブラウザに設定画面が開く
3. 「はじめての設定」で提出一覧のパスワード（8文字以上）を決める → 「受付を始める」
4. 「外から受け取れるようにする」の①Cloudflareにログイン ②トンネルを用意する（`woodcad-submit.hakuryu.f5.si`） ③始める
   - トンネルは WEEKY とは別の「woodcad」。資格情報は全部フォルダの中（`config\cloudflared\`）
   - サービス登録・ファイアウォール設定・管理者権限は使わない
5. 次からは `WoodCAD.cmd` を押すだけで、受付もトンネルも自動で始まる
6. PCの電源設定：**電源接続中のスリープは「なし」**（寝ると受付が止まる）

詳しくは `WoodCAD-Receiver\README.txt`。

## 4. 片づけ・引っ越し

- 届いた設計の持ち出し：設定画面の「提出を持ち出す」（USBなどに書き出して、中身を照合する）
- 消す：設定画面の「このPCから消す」（持ち出しが済んでいるかを確かめてからフォルダごと消す）。手で消すなら、止めて黒い窓を閉じてからフォルダを削除するだけ
- 別のPCへ：止めてからフォルダごとコピーすれば、ログインからやり直さずにそのまま動く
- Cloudflare 側にはトンネル「woodcad」とアドレスが残る（PCが無ければ動かないので害はない）

## 5. iPadへの配り方

1. Safari で `https://woodcad.hakuryu.f5.si` を開く
2. 共有ボタン → **ホーム画面に追加**
3. 以後は**必ずホーム画面のアイコンから開く**
   - Safari で開いたときと、ホーム画面から開いたときでは、**セーブデータが別々**（iPadの仕様）
   - ホーム画面から開けば、電波がなくても起動できる（送信だけはネットが必要）
   - ブラウザ内の保存なので、iPadの初期化や設定によっては消えることがある。大事な設計は送るか書き出しておく

## 6. 授業での使い方

- 生徒：右上の緑の「先生に送る」→「送る」→「先生に送りました」。直したら何回送ってもよい
- 先生：`https://woodcad-submit.hakuryu.f5.si/`（電子黒板でもよい）
  - 学級ごとにサムネイル付きで並ぶ。「置き場所に収まる／置き場所より大きい」「材料OK／足りない」も出る
  - ふだんは同じ人・同じデータの**最新だけ**表示。「すべての送信を表示」で全部
  - 「ダウンロード」したファイルは、木工CADの「セーブデータ → ファイルから読み込む」で開ける
  - 「まとめてダウンロード」でその日の分をzipでまとめて保存
- 提出ファイルは集め先PCの `WoodCAD-Receiver\data\submissions\日付\` に保存されている（サムネイル画像つき）

## 7. 中身を変えたいとき

- 使える板材：`public/stock.json`
- 送信先：`public/config.json` の `submitUrl`（空にすると「先生に送る」ボタンが消え、代わりに「書き出し」ボタンが出る）
- 受付を許可するページ：集め先PCの `WoodCAD-Receiver\config\receiver.json` の `allowedOrigins`
- `public/` の2つは、変えて GitHub に push すれば数分で反映される（`receiver.json` は集め先PCのファイルを直接書き換える）
