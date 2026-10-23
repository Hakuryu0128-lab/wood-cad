/* 木工CAD 提出受付サーバー（風呂敷版）

   生徒の木工CADの「先生に送る」から届いた設計を、このフォルダの data\submissions\日付\ に保存する。
   先生は同じサーバーの一覧ページ（パスワード付き）で、サムネイル付きで確認・ダウンロードできる。

   - Node の標準モジュールだけで動く（npm install 不要）
   - 設定とデータの場所はランチャーが環境変数で渡す
       WOODCAD_CONFIG    … config\receiver.json
       WOODCAD_DATA_DIR  … data\
     渡されなければ、このファイルの1つ上のフォルダの config\ と data\ を使う
   - 待ち受けは 127.0.0.1 だけ。外からは Cloudflare Tunnel 経由で届く

   旧版（server/woodcad_submit.py）と同じ動きにしてある：
     POST /api/submit  … 送信（木工CADのページからだけ受け付ける）
     GET  /api/health  … 動いているか（ランチャーが見る）
     GET  /            … 提出一覧（Basic認証）
     GET  /file?f=     … 1件のファイル（json / jpg）
     GET  /zip?day=    … その日の分をまとめてzip */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const VERSION = '1.0.0';
const HOME = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.WOODCAD_CONFIG || path.join(HOME, 'config', 'receiver.json');
const DATA_DIR = process.env.WOODCAD_DATA_DIR || path.join(HOME, 'data');
const SUBMIT_DIR = path.join(DATA_DIR, 'submissions');

const DEFAULTS = {
  port: 8010,
  allowedOrigins: ['https://woodcad.hakuryu.f5.si', 'http://localhost:5173', 'http://localhost:4173'],
  maxBodyKb: 3000,
  maxSubmitsPer10min: 30,
};

function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return Object.assign({}, DEFAULTS, c);
}
// 設定はランチャーが書き換えることがあるので、使うたびに読み直す（数KBなので軽い）
let CONFIG = loadConfig();
function config() { CONFIG = loadConfig(); return CONFIG; }

/* ── パスワード ──
   ランチャーと同じ形（salt:scrypt）。平文はどこにも置かない。
   Basic認証は毎回送られてくるので、一度通った値はハッシュをとって覚えておく
   （scrypt を毎リクエスト回すと一覧ページの画像読み込みが遅くなる）。 */
function verifyHash(stored, password) {
  try {
    const [salt, hex] = String(stored).split(':');
    if (!salt || !hex) return false;
    const expected = Buffer.from(hex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
const AUTH_OK = new Map(); // sha256(Authorization) -> passwordHash（パスワードを変えたら無効になる）

function authorized(req) {
  const hash = config().passwordHash;
  if (!hash) return false;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const key = crypto.createHash('sha256').update(h).digest('hex');
  if (AUTH_OK.get(key) === hash) return true;
  let pw = '';
  try {
    const dec = Buffer.from(h.slice(6), 'base64').toString('utf8');
    pw = dec.slice(dec.indexOf(':') + 1);
  } catch { return false; }
  if (!verifyHash(hash, pw)) return false;
  if (AUTH_OK.size > 50) AUTH_OK.clear();
  AUTH_OK.set(key, hash);
  return true;
}

/* ── 保存 ── */
const NAME_UNSAFE = /[\\/:*?"<>|\r\n\t]+/g;
const FILE_RE = /^\d{4}-\d{2}-\d{2}\/[^/\\]+\.(json|jpg)$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function safe(s, limit = 30) {
  const t = String(s == null ? '' : s).replace(NAME_UNSAFE, '').trim().replace(/\s/g, '');
  return t.slice(0, limit) || 'noname';
}
function pad(n) { return String(n).padStart(2, '0'); }
function localIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// 4桁の番号 1205 → 1年2組5番
function classLabel(num) {
  const m = /^(\d)(\d)(\d{2})$/.exec(String(num));
  return m ? `${m[1]}年${m[2]}組${Number(m[3])}番` : String(num);
}
function validate(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '形式が違います';
  for (const k of ['num', 'name']) {
    if (typeof d[k] !== 'string' || !d[k].trim()) return `${k} がありません`;
  }
  if (!Array.isArray(d.boards)) return 'boards がありません';
  if (d.boards.length > 200) return '板が多すぎます';
  return null;
}

function saveSubmission(d) {
  const now = new Date();
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dayDir = path.join(SUBMIT_DIR, day);
  fs.mkdirSync(dayDir, { recursive: true });
  const hms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let stem = `${hms}_${safe(d.num, 8)}_${safe(d.name, 20)}_${safe(d.title, 30)}`;
  // 同じ秒に同じ人が2回送っても上書きしない
  for (let i = 2; fs.existsSync(path.join(dayDir, stem + '.json')); i++) stem = stem.replace(/(-\d+)?$/, '-' + i);

  const iso = localIso(now);
  const record = {
    version: 2,
    meta: { num: d.num.trim(), name: d.name.trim(), savedAt: iso, title: String(d.title || ''), submittedAt: iso },
    boards: d.boards,
    space: d.space ?? null,
    summary: d.summary ?? null,
  };
  fs.writeFileSync(path.join(dayDir, stem + '.json'), JSON.stringify(record, null, 2));
  const thumb = d.thumbnail;
  if (typeof thumb === 'string' && thumb.startsWith('data:image/jpeg;base64,')) {
    try { fs.writeFileSync(path.join(dayDir, stem + '.jpg'), Buffer.from(thumb.split(',', 2)[1], 'base64')); } catch {}
  }
  return { iso, stem, day };
}

function listDays() {
  try {
    return fs.readdirSync(SUBMIT_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && DAY_RE.test(e.name)).map((e) => e.name).sort().reverse();
  } catch { return []; }
}

function listSubmissions(day, latestOnly) {
  const dayDir = path.join(SUBMIT_DIR, day);
  let names = [];
  try { names = fs.readdirSync(dayDir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
  let items = [];
  for (const f of names) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dayDir, f), 'utf8')); } catch { continue; }
    const meta = rec.meta || {};
    const stem = f.slice(0, -5);
    items.push({
      file: `${day}/${f}`,
      thumb: fs.existsSync(path.join(dayDir, stem + '.jpg')) ? `${day}/${stem}.jpg` : null,
      num: meta.num || '', name: meta.name || '', title: meta.title || '',
      time: f.slice(0, 6),
      boards: Array.isArray(rec.boards) ? rec.boards.length : 0,
      summary: rec.summary || {},
    });
  }
  if (latestOnly) {
    // 同じ生徒・同じデータ名は、最後に送ったものだけ
    const last = new Map();
    for (const it of items) last.set(JSON.stringify([it.num, it.name, it.title]), it);
    items = [...last.values()];
  }
  items.sort((a, b) => (a.num === b.num ? a.time.localeCompare(b.time) : a.num.localeCompare(b.num)));
  return items;
}

function resolveFile(rel) {
  if (!rel || !FILE_RE.test(rel)) return null;
  const root = path.resolve(SUBMIT_DIR);
  const p = path.resolve(root, rel);
  if (!p.startsWith(root + path.sep) || !fs.existsSync(p)) return null;
  return p;
}

/* ── zip（標準モジュールだけで作る。deflate＋CRC32） ── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);           // ファイル名はUTF-8
    local.writeUInt16LE(8, 8);                // deflate
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + comp.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

/* ── 先生用ページ ── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const PAGE_CSS = `
*{box-sizing:border-box}body{margin:0;font-family:'Hiragino Sans','Yu Gothic UI','Yu Gothic',system-ui,sans-serif;background:#f2f2f2;color:#1a1a1a;line-height:1.6}
header{background:#fff;padding:12px 20px;border-bottom:1px solid #ccc;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
h1{font-size:20px;margin:0 auto 0 0}a{color:#0017c1}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:8px;background:#fff;text-decoration:none;color:#0017c1;font-weight:700;font-size:16px;border:1px solid #0017c1}
.btn.primary{background:#0017c1;color:#fff}
main{padding:16px 20px 40px;max-width:1200px;margin:0 auto}
h2{font-size:18px;margin:24px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ccc}
.card img,.noimg{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#e6e6e6}
.noimg{display:flex;align-items:center;justify-content:center;color:#666;font-size:14px}
.info{padding:8px 12px 12px;font-size:14px}.who{font-weight:700;font-size:16px}.sub{color:#4d4d4d;font-size:14px;margin:2px 0 6px}
.tag{display:inline-block;font-size:14px;padding:0 8px;border-radius:999px;margin:0 4px 6px 0}
.ok{background:#e6f5ec;color:#197a4b}.ng{background:#fdeeee;color:#ce0000}.na{background:#eee;color:#4d4d4d}
.empty{color:#666;padding:40px 0;text-align:center}
select{font-size:16px;min-height:44px;padding:0 8px;border-radius:8px;border:1px solid #666;background:#fff}
`;

function renderPage(day, latestOnly) {
  const days = listDays();
  if (!day && days.length) day = days[0];
  const items = days.includes(day) ? listSubmissions(day, latestOnly) : [];
  const tag = (ok, yes, no, none) => (ok == null
    ? `<span class="tag na">${esc(none)}</span>`
    : `<span class="tag ${ok ? 'ok' : 'ng'}">${esc(ok ? yes : no)}</span>`);

  const groups = {};
  for (const it of items) {
    const key = /^\d{4}$/.test(it.num) ? classLabel(it.num).slice(0, 4) : 'その他';
    (groups[key] = groups[key] || []).push(it);
  }
  const cards = [];
  for (const g of Object.keys(groups).sort()) {
    cards.push(`<h2>${esc(g)}（${groups[g].length}件）</h2><div class="grid">`);
    for (const it of groups[g]) {
      const s = it.summary || {};
      const size = s.size;
      const sizeTxt = size && typeof size === 'object'
        ? `${size.width / 10}×${size.depth / 10}×${size.height / 10}cm` : '—';
      const img = it.thumb
        ? `<img src="/file?f=${encodeURIComponent(it.thumb)}" alt="" loading="lazy">`
        : '<div class="noimg">画像なし</div>';
      const t = it.time;
      cards.push(`<div class="card">${img}<div class="info">
<div class="who">${esc(it.num)} ${esc(it.name)}</div>
<div class="sub">${esc(it.title)} ・ ${t.slice(0, 2)}:${t.slice(2, 4)} ・ 板${it.boards}枚 ・ ${esc(sizeTxt)}</div>
${tag(s.fitsSpace, '置き場所に収まる', '置き場所より大きい', '置き場所：設定なし')}${tag(s.stockOk, '材料OK', '材料が足りない', '材料：—')}
<div><a class="btn" href="/file?f=${encodeURIComponent(it.file)}&dl=1">ダウンロード</a></div>
</div></div>`);
    }
    cards.push('</div>');
  }
  const lq = latestOnly ? '1' : '0';
  const opts = days.map((d) => `<option value="${d}" ${d === day ? 'selected' : ''}>${d}</option>`).join('');
  const dq = encodeURIComponent(day || '');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>木工CAD 提出一覧</title>
<style>${PAGE_CSS}</style></head><body>
<header><h1>木工CAD 提出一覧</h1>
<form method="get" action="/"><input type="hidden" name="latest" value="${lq}">
<select name="day" aria-label="日付" onchange="this.form.submit()">${opts || '<option>—</option>'}</select></form>
<a class="btn" href="/?day=${dq}&latest=${latestOnly ? '0' : '1'}">${latestOnly ? 'すべての送信を表示' : '最新だけ表示'}</a>
${items.length ? `<a class="btn primary" href="/zip?day=${dq}&latest=${lq}">まとめてダウンロード</a>` : ''}
<a class="btn" href="/?day=${dq}&latest=${lq}">更新</a>
</header><main><p class="sub">${items.length}件${latestOnly ? '（同じ人・同じデータは最新だけ）' : ''}。
ダウンロードしたファイルは、木工CADの「セーブデータ」→「ファイルから読み込む」で開けます。</p>
${cards.join('') || '<p class="empty">まだ提出はありません</p>'}</main></body></html>`;
}

/* ── HTTP ── */
const RATE = new Map(); // ip -> [時刻...]

function clientIp(req) { return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || ''; }
function corsOrigin(req) {
  const o = req.headers.origin || '';
  return config().allowedOrigins.includes(o) ? o : null;
}
function sendJson(req, res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' };
  const o = corsOrigin(req);
  if (o) { h['Access-Control-Allow-Origin'] = o; h.Vary = 'Origin'; }
  res.writeHead(code, h);
  res.end(body);
}
function log(msg) {
  // ランチャーの下で動くときは、時刻はランチャーが付ける（二重にしない）
  if (process.env.WOODCAD_CONFIG) return console.log(msg);
  const d = new Date();
  console.log(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${msg}`);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    const o = corsOrigin(req);
    const h = {};
    if (o) Object.assign(h, {
      'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin',
    });
    res.writeHead(o ? 204 : 403, h);
    return res.end();
  }

  if (p === '/api/health' || p === '/api/ping') {
    return sendJson(req, res, 200, { ok: true, app: 'woodcad-receiver', version: VERSION });
  }

  if (req.method === 'POST' && p === '/api/submit') {
    if (!corsOrigin(req)) return sendJson(req, res, 403, { ok: false, error: 'このページからは送信できません' });
    const ip = clientIp(req);
    const now = Date.now();
    const hist = (RATE.get(ip) || []).filter((t) => now - t < 600000);
    if (hist.length >= config().maxSubmitsPer10min) {
      return sendJson(req, res, 429, { ok: false, error: '送信の回数が多すぎます。しばらく待ってから送ってください' });
    }
    const limit = config().maxBodyKb * 1024;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { req.resume(); return sendJson(req, res, 413, { ok: false, error: 'データが大きすぎます' }); }
    const chunks = [];
    let size = 0, tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // 上限を超えたら読み捨てずに応答して切る
        if (!tooBig) { tooBig = true; sendJson(req, res, 413, { ok: false, error: 'データが大きすぎます' }); req.destroy(); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      if (size === 0) return sendJson(req, res, 400, { ok: false, error: 'データがありません' });
      let d;
      try { d = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        return sendJson(req, res, 400, { ok: false, error: 'データが読めません' });
      }
      const err = validate(d);
      if (err) return sendJson(req, res, 400, { ok: false, error: err });
      let saved;
      try { saved = saveSubmission(d); } catch (e) {
        log('[保存できませんでした] ' + e.message);
        return sendJson(req, res, 500, { ok: false, error: '先生のパソコンに保存できませんでした' });
      }
      hist.push(now); RATE.set(ip, hist);
      log(`[提出] ${classLabel(d.num)} ${d.name}「${d.title || ''}」→ ${saved.day}/${saved.stem}`);
      return sendJson(req, res, 200, { ok: true, receivedAt: saved.iso });
    });
    return;
  }

  if (req.method !== 'GET') return sendJson(req, res, 404, { ok: false, error: 'not found' });

  // ここから先は先生用（パスワード）
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="woodcad", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(config().passwordHash ? 'パスワードが必要です（ユーザー名は何でもかまいません）' : 'パスワードがまだ設定されていません。ランチャーの「はじめての設定」から設定してください');
  }
  if (p === '/') {
    const page = Buffer.from(renderPage(u.searchParams.get('day') || '', u.searchParams.get('latest') !== '0'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Cache-Control': 'no-store' });
    return res.end(page);
  }
  if (p === '/file') {
    const f = resolveFile(u.searchParams.get('f'));
    if (!f) return sendJson(req, res, 404, { ok: false, error: 'ファイルがありません' });
    const data = fs.readFileSync(f);
    const h = { 'Content-Type': f.endsWith('.jpg') ? 'image/jpeg' : 'application/json; charset=utf-8', 'Content-Length': data.length };
    if (u.searchParams.get('dl')) h['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}`;
    res.writeHead(200, h);
    return res.end(data);
  }
  if (p === '/zip') {
    const day = u.searchParams.get('day') || '';
    if (!listDays().includes(day)) return sendJson(req, res, 404, { ok: false, error: '日付がありません' });
    const files = [];
    for (const it of listSubmissions(day, u.searchParams.get('latest') !== '0')) {
      const f = resolveFile(it.file);
      if (f) files.push({ name: path.basename(f), data: fs.readFileSync(f) });
    }
    const zip = makeZip(files);
    res.writeHead(200, {
      'Content-Type': 'application/zip', 'Content-Length': zip.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('木工CAD提出_' + day + '.zip')}`,
    });
    return res.end(zip);
  }
  return sendJson(req, res, 404, { ok: false, error: 'not found' });
});

if (require.main === module) {
  fs.mkdirSync(SUBMIT_DIR, { recursive: true });
  const port = Number(process.env.PORT || config().port);
  server.on('error', (e) => { log('起動できませんでした: ' + e.message); process.exit(1); });
  server.listen(port, '127.0.0.1', () => {
    log(`木工CAD 提出受付 ${VERSION} 待ち受け中 http://127.0.0.1:${port}/`);
    log(`保存先: ${SUBMIT_DIR}`);
  });
}

module.exports = { server, makeZip, crc32, verifyHash, classLabel, listSubmissions, SUBMIT_DIR };
