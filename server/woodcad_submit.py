"""
木工CAD 提出受付サーバー（学校PC用）

生徒の木工CADの「先生に送る」ボタンから届いた設計データを、このPCのフォルダに保存する。
先生は同じサーバーの一覧ページ（パスワード付き）で、届いた設計をサムネイル付きで確認・ダウンロードできる。

- Python 標準ライブラリだけで動く（pip install 不要）
- 保存先: このファイルと同じ場所の submissions/日付/ フォルダ
- 設定:   このファイルと同じ場所の config.json（初回起動時に自動で作る）
- 外部公開: Cloudflare Tunnel で https://woodcad-submit.hakuryu.f5.si → http://localhost:8010

起動: python woodcad_submit.py   （または start_woodcad_submit.bat）
"""

import base64
import hmac
import html
import io
import json
import re
import secrets
import sys
import time
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
SUBMIT_DIR = BASE_DIR / "submissions"

DEFAULT_CONFIG = {
    "port": 8010,
    # 一覧ページのパスワード（初回起動時にランダムで作る。好きな値に変えてよい）
    "teacher_password": "",
    # 送信を受け付けるページ（木工CADを置いたURL）。開発用に localhost も入れておく
    "allowed_origins": [
        "https://woodcad.hakuryu.f5.si",
        "http://localhost:5173",
        "http://localhost:4173",
    ],
    "max_body_kb": 3000,
    # いたずら対策：同じ端末から10分間に受け付ける最大回数
    "max_submits_per_10min": 30,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception as e:  # noqa: BLE001
            print(f"[設定] config.json が読めません: {e}")
            sys.exit(1)
    if not cfg.get("teacher_password"):
        cfg["teacher_password"] = secrets.token_urlsafe(9)
        CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[設定] config.json を作りました。一覧ページのパスワード: {cfg['teacher_password']}")
    return cfg


CONFIG = load_config()
RATE = {}  # ip -> [time, ...]

# ---------- 保存 ----------

NAME_SAFE = re.compile(r'[\\/:*?"<>|\r\n\t]+')
FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}/[^/\\]+\.(json|jpg)$")


def safe(s, limit=30):
    s = NAME_SAFE.sub("", str(s or "")).strip().replace(" ", "")
    return s[:limit] or "noname"


def class_label(num):
    """4連番号 1205 → 1年2組5番"""
    m = re.fullmatch(r"(\d)(\d)(\d{2})", str(num))
    if not m:
        return str(num)
    return f"{m.group(1)}年{m.group(2)}組{int(m.group(3))}番"


def validate(data):
    if not isinstance(data, dict):
        return "形式が違います"
    for key in ("num", "name"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            return f"{key} がありません"
    if not isinstance(data.get("boards"), list):
        return "boards がありません"
    if len(data["boards"]) > 200:
        return "板が多すぎます"
    return None


def save_submission(data):
    now = datetime.now()
    day_dir = SUBMIT_DIR / now.strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{now.strftime('%H%M%S')}_{safe(data['num'], 8)}_{safe(data['name'], 20)}_{safe(data.get('title'), 30)}"

    thumb = data.pop("thumbnail", None)
    record = {
        "version": 2,
        "meta": {
            "num": data["num"].strip(),
            "name": data["name"].strip(),
            "savedAt": now.isoformat(timespec="seconds"),
            "title": str(data.get("title") or ""),
            "submittedAt": now.isoformat(timespec="seconds"),
        },
        "boards": data["boards"],
        "space": data.get("space"),
        "summary": data.get("summary"),
    }
    (day_dir / f"{stem}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    if isinstance(thumb, str) and thumb.startswith("data:image/jpeg;base64,"):
        try:
            (day_dir / f"{stem}.jpg").write_bytes(base64.b64decode(thumb.split(",", 1)[1]))
        except Exception:  # noqa: BLE001
            pass
    return now, stem


def list_days():
    if not SUBMIT_DIR.exists():
        return []
    return sorted([p.name for p in SUBMIT_DIR.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.name)], reverse=True)


def list_submissions(day, latest_only):
    day_dir = SUBMIT_DIR / day
    items = []
    for f in sorted(day_dir.glob("*.json")):
        try:
            rec = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        meta = rec.get("meta", {})
        items.append(
            {
                "file": f"{day}/{f.name}",
                "thumb": f"{day}/{f.stem}.jpg" if (day_dir / f"{f.stem}.jpg").exists() else None,
                "num": meta.get("num", ""),
                "name": meta.get("name", ""),
                "title": meta.get("title", ""),
                "time": f.name[:6],
                "boards": len(rec.get("boards") or []),
                "summary": rec.get("summary") or {},
            }
        )
    if latest_only:
        # 同じ生徒・同じデータ名は、最後に送ったものだけ
        last = {}
        for it in items:
            last[(it["num"], it["name"], it["title"])] = it
        items = list(last.values())
    items.sort(key=lambda it: (it["num"], it["time"]))
    return items


def resolve_file(rel):
    if not rel or not FILE_RE.match(rel):
        return None
    p = (SUBMIT_DIR / rel).resolve()
    if SUBMIT_DIR.resolve() not in p.parents or not p.exists():
        return None
    return p


# ---------- 先生用ページ ----------

PAGE_CSS = """
*{box-sizing:border-box}body{margin:0;font-family:'Hiragino Sans','Yu Gothic',system-ui,sans-serif;background:#eef2f6;color:#2a2f36}
header{background:#fff;padding:12px 20px;box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;flex-wrap:wrap;gap:12px;align-items:center}
h1{font-size:18px;margin:0 auto 0 0}a{color:#2f6fed}
.btn{display:inline-block;padding:8px 14px;border-radius:10px;background:#eef1f5;text-decoration:none;color:#2a2f36;font-weight:600;font-size:14px;border:1px solid #d6dae1}
.btn.primary{background:#2f6fed;color:#fff;border-color:#2f6fed}
main{padding:16px 20px 40px;max-width:1200px;margin:0 auto}
h2{font-size:15px;margin:22px 0 8px;color:#5a616b}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.card img,.noimg{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#dde3ea}
.noimg{display:flex;align-items:center;justify-content:center;color:#9aa1ab;font-size:12px}
.info{padding:8px 10px 10px;font-size:13px}.who{font-weight:700;font-size:14px}.sub{color:#5a616b;font-size:12px;margin:2px 0 6px}
.tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;margin:0 4px 4px 0}
.ok{background:#e6f4ea;color:#2e7d32}.ng{background:#fdecec;color:#c62828}.na{background:#eef1f5;color:#5a616b}
.empty{color:#9aa1ab;padding:40px 0;text-align:center}
select{font-size:14px;padding:6px 8px;border-radius:8px;border:1px solid #d6dae1}
"""


def render_page(day, latest_only):
    days = list_days()
    if not day and days:
        day = days[0]
    items = list_submissions(day, latest_only) if day in days else []

    def tag(ok, yes, no, none):
        if ok is None:
            return f'<span class="tag na">{html.escape(none)}</span>'
        return f'<span class="tag {"ok" if ok else "ng"}">{html.escape(yes if ok else no)}</span>'

    groups = {}
    for it in items:
        key = class_label(it["num"])[:4] if re.fullmatch(r"\d{4}", it["num"]) else "その他"
        groups.setdefault(key, []).append(it)

    cards_html = []
    for g in sorted(groups):
        cards_html.append(f"<h2>{html.escape(g)}（{len(groups[g])}件）</h2><div class='grid'>")
        for it in groups[g]:
            s = it["summary"]
            size = s.get("size")
            size_txt = f"{size['width']/10:g}×{size['depth']/10:g}×{size['height']/10:g}cm" if isinstance(size, dict) else "—"
            img = (
                f"<img src='/file?f={quote(it['thumb'])}' alt='' loading='lazy'>"
                if it["thumb"]
                else "<div class='noimg'>画像なし</div>"
            )
            t = it["time"]
            cards_html.append(
                f"""<div class="card">{img}<div class="info">
<div class="who">{html.escape(it['num'])} {html.escape(it['name'])}</div>
<div class="sub">{html.escape(it['title'])} ・ {t[:2]}:{t[2:4]} ・ 板{it['boards']}枚 ・ {html.escape(size_txt)}</div>
{tag(s.get('fitsSpace'), '置き場所に入る', '置き場所からはみ出し', '置き場所：設定なし')}{tag(s.get('stockOk'), '材料OK', '材料が足りない', '材料：—')}
<div><a class="btn" href="/file?f={quote(it['file'])}&dl=1">ダウンロード</a></div>
</div></div>"""
            )
        cards_html.append("</div>")

    day_opts = "".join(f"<option value='{d}' {'selected' if d == day else ''}>{d}</option>" for d in days)
    latest_q = "1" if latest_only else "0"
    toggle = (
        f"<a class='btn' href='/?day={day}&latest={'0' if latest_only else '1'}'>"
        f"{'すべての送信を表示' if latest_only else '最新だけ表示'}</a>"
    )
    body = "".join(cards_html) or "<p class='empty'>まだ提出はありません</p>"
    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>木工CAD 提出一覧</title>
<style>{PAGE_CSS}</style></head><body>
<header><h1>木工CAD 提出一覧</h1>
<form method="get" action="/"><input type="hidden" name="latest" value="{latest_q}">
<select name="day" onchange="this.form.submit()">{day_opts or '<option>—</option>'}</select></form>
{toggle}
{f"<a class='btn primary' href='/zip?day={day}&latest={latest_q}'>まとめてダウンロード</a>" if items else ''}
<a class="btn" href="/?day={day}&latest={latest_q}">更新</a>
</header><main><p class="sub">{len(items)}件{'（同じ人・同じデータは最新だけ）' if latest_only else ''}。
ダウンロードしたファイルは、木工CADの「セーブデータ」→「ファイルから読み込む」で開けます。</p>{body}</main></body></html>"""


# ---------- HTTP ----------


class Handler(BaseHTTPRequestHandler):
    server_version = "WoodCadSubmit/1.0"

    def log_message(self, fmt, *args):
        print(f"[{datetime.now():%H:%M:%S}] {self.client_ip()} {fmt % args}")

    def client_ip(self):
        return self.headers.get("CF-Connecting-IP") or self.client_address[0]

    # --- CORS（木工CADのページからの送信だけ許可） ---
    def cors_origin(self):
        origin = self.headers.get("Origin", "")
        return origin if origin in CONFIG["allowed_origins"] else None

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        origin = self.cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self.cors_origin()
        self.send_response(204 if origin else 403)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Vary", "Origin")
        self.end_headers()

    # --- 先生用ページの認証（Basic認証。ユーザー名は何でもよい） ---
    def authorized(self):
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            try:
                _, _, pw = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
                if hmac.compare_digest(pw.encode(), CONFIG["teacher_password"].encode()):
                    return True
            except Exception:  # noqa: BLE001
                pass
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="woodcad", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write("パスワードが必要です".encode("utf-8"))
        return False

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if url.path == "/api/ping":
            return self.send_json(200, {"ok": True})
        if not self.authorized():
            return
        if url.path == "/":
            page = render_page(q.get("day", [""])[0], q.get("latest", ["1"])[0] != "0").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(page)
            return
        if url.path == "/file":
            p = resolve_file(q.get("f", [""])[0])
            if not p:
                return self.send_json(404, {"ok": False, "error": "ファイルがありません"})
            data = p.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg" if p.suffix == ".jpg" else "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            if q.get("dl"):
                self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(p.name)}")
            self.end_headers()
            self.wfile.write(data)
            return
        if url.path == "/zip":
            day = q.get("day", [""])[0]
            if day not in list_days():
                return self.send_json(404, {"ok": False, "error": "日付がありません"})
            items = list_submissions(day, q.get("latest", ["1"])[0] != "0")
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for it in items:
                    p = resolve_file(it["file"])
                    if p:
                        z.write(p, p.name)
            data = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote('木工CAD提出_' + day + '.zip')}")
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/submit":
            return self.send_json(404, {"ok": False, "error": "not found"})
        if not self.cors_origin():
            return self.send_json(403, {"ok": False, "error": "このページからは送信できません"})

        ip = self.client_ip()
        now = time.time()
        hist = [t for t in RATE.get(ip, []) if now - t < 600]
        if len(hist) >= CONFIG["max_submits_per_10min"]:
            return self.send_json(429, {"ok": False, "error": "送信の回数が多すぎます。しばらく待ってから送ってください"})

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > CONFIG["max_body_kb"] * 1024:
            return self.send_json(413, {"ok": False, "error": "データが大きすぎます"})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:  # noqa: BLE001
            return self.send_json(400, {"ok": False, "error": "データが読めません"})
        err = validate(data)
        if err:
            return self.send_json(400, {"ok": False, "error": err})

        saved_at, stem = save_submission(data)
        hist.append(now)
        RATE[ip] = hist
        print(f"[提出] {class_label(data['num'])} {data['name']}「{data.get('title', '')}」→ {stem}")
        return self.send_json(200, {"ok": True, "receivedAt": saved_at.isoformat(timespec="seconds")})


def main():
    SUBMIT_DIR.mkdir(exist_ok=True)
    port = int(CONFIG["port"])
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("=" * 50)
    print(" 木工CAD 提出受付サーバー")
    print(f" 待受: http://localhost:{port}/   （一覧ページ。パスワードは config.json）")
    print(f" 保存先: {SUBMIT_DIR}")
    print(" このウィンドウを閉じると受付が止まります")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
