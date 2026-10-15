# 公開と提出のしくみ：やること

全体の形

```
生徒のiPad（ホーム画面の「木工CAD」）
   │ 開く                         │「先生に送る」
   ▼                              ▼
https://woodcad.hakuryu.f5.si    https://woodcad-submit.hakuryu.f5.si
（GitHub Pages）                  （Cloudflare Tunnel → 集め先PCの localhost:8010）
                                    └ server/submissions/日付/ に保存
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

## 3. 集め先PCで受付プログラムを動かす

集め先PC：技術室の電子黒板につないでいるPC（予定）

1. `wood_cad\server` フォルダを、そのPCの好きな場所にコピーする（例：`C:\woodcad_submit`）
2. Python が入っているか確認：PowerShell で `py --version`（だめなら `python --version`）。なければ python.org から入れる（「Add to PATH」にチェック）
3. `start_woodcad_submit.bat` をダブルクリック
   - 初回は `config.json` ができて、**一覧ページのパスワード**が画面に出る（`config.json` の `teacher_password`。好きな値に変えてよい。変えたら bat を起動し直す）
   - 黒い画面を閉じると受付が止まる
4. 同じPCのブラウザで `http://localhost:8010/` を開き、パスワードを入れて一覧が出ればOK
5. PCの電源設定：**電源接続中のスリープは「なし」**（寝ると受付が止まる）
6. 自動で起動したいとき：`Win + R` → `shell:startup` → 開いたフォルダに bat のショートカットを置く

## 4. Cloudflare Tunnel で外から届くようにする

**A. 集め先PCが school-intercom と同じPCの場合**
Cloudflare → Zero Trust → Networks → Tunnels → `school-intercom` → **Public Hostname → Add**

| Subdomain | Domain | Service |
|---|---|---|
| `woodcad-submit` | `hakuryu.f5.si` | HTTP ／ `localhost:8010` |

**B. 別のPC（電子黒板のPCなど）の場合**
ホストごとに別Tunnelにする方針なので、そのPCに新しい Tunnel を作る。

1. Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared → 名前 `woodcad`
2. 表示される Windows 用のコマンドを、そのPCの**管理者 PowerShell**で実行（cloudflared がWindowsサービスとして入る）
3. Public Hostname を上の表のとおりに追加

確認：iPad や自分のスマホで `https://woodcad-submit.hakuryu.f5.si/` を開き、パスワードを入れて一覧が出ればOK。

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
- 提出ファイルは集め先PCの `server\submissions\日付\` にも保存されている（サムネイル画像つき）

## 7. 中身を変えたいとき

- 使える板材：`public/stock.json`
- 送信先：`public/config.json` の `submitUrl`（空にすると「先生に送る」ボタンが消え、代わりに「書き出し」ボタンが出る）
- 受付を許可するページ：`server/config.json` の `allowed_origins`
- どれも、変えて GitHub に push すれば数分で反映される（`server/` は集め先PCのファイルを直接書き換える）
