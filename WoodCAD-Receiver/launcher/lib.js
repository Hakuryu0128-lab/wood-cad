/* 木工CAD 受信 — ランチャーの中身（単体で検査できるように main.js から分けてある）

   ・はじめての設定（パスワードとポート）
   ・フォルダの外に出た cloudflared の資格情報を引き取る
   ・提出を持ち出す（コピーして、中身を照合して、もう一度数える）
   ・このPCから消す（何が消えるかを見せる／消す役を外に立てる） */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MIN_PASSWORD = 8;

function pad(n) { return String(n).padStart(2, '0'); }
function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fileStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/* エクスプローラーの「パスのコピー」は前後に " が付く。対になった引用符だけ剥がす。 */
function cleanPath(v) {
  let t = String(v == null ? '' : v).trim();
  for (let again = true; again;) {
    again = false;
    for (const [a, b] of [['"', '"'], ["'", "'"], ['\u201C', '\u201D']]) {
      if (t.length >= 2 && t.startsWith(a) && t.endsWith(b)) { t = t.slice(1, -1).trim(); again = true; }
    }
  }
  return t;
}
function isInside(base, p) {
  const rel = path.relative(base, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
/* OneDrive の中やネットワークの場所は、同期やロックで書き込みが失敗しやすい */
function suspiciousPath(p) {
  return /onedrive/i.test(p) || /^\\\\/.test(p);
}

/* ── パスワード（salt:scrypt。server.js の verifyHash と同じ形）── */
function makeHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function verifyHash(stored, password) {
  try {
    const [salt, hex] = String(stored).split(':');
    const expected = Buffer.from(hex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

function applySetup(ctx, body) {
  const cfg = ctx.cfg;
  const out = { ok: false };
  const pw = body.password == null ? '' : String(body.password);
  if (!cfg.passwordHash && !pw) return { ok: false, error: '一覧ページのパスワードを入れてください' };
  if (pw) {
    if (pw.length < MIN_PASSWORD) return { ok: false, error: `パスワードは${MIN_PASSWORD}文字以上にしてください（インターネットから見えるページになるため）` };
    if (body.password2 != null && String(body.password2) !== pw) return { ok: false, error: '確認用のパスワードが一致しません' };
  }
  let port = cfg.port;
  if (body.port != null && String(body.port).trim() !== '') {
    port = Number(body.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, error: 'ポートは 1024〜65535 の数字にしてください' };
  }
  const next = Object.assign({}, cfg);
  if (pw) next.passwordHash = makeHash(pw);
  out.portChanged = port !== cfg.port;
  next.port = port;
  if (typeof body.autoStart === 'boolean') next.autoStart = body.autoStart;
  ctx.saveCfg(next);
  // ★書いたあとに読み直して検算する★ 「設定はできたのにログインできない」を出さないため
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(ctx.cfgPath || path.join(ctx.HOME, 'config', 'receiver.json'), 'utf8')); } catch {}
  if (pw && !verifyHash(saved.passwordHash, pw)) return { ok: false, error: '保存したパスワードの検算に失敗しました。もう一度入れてください' };
  Object.assign(cfg, next);
  out.ok = true;
  out.port = port;
  return out;
}

/* ── cloudflared の資格情報 ──
   names に挙げたものだけを、外（strayDir）から中（cfDir）へ移す。
   中に同じ名前で中身が違うものがあれば、上書きせず .new を付ける。 */
function adoptFiles({ strayDir, cfDir, names }) {
  const moved = [], failed = [];
  for (const name of names || []) {
    if (!name || /[\\/]/.test(name)) continue;
    const from = path.join(strayDir, name);
    if (!fs.existsSync(from)) continue;
    let to = path.join(cfDir, name);
    try {
      fs.mkdirSync(cfDir, { recursive: true });
      if (fs.existsSync(to)) {
        if (fs.readFileSync(to).equals(fs.readFileSync(from))) { fs.unlinkSync(from); moved.push(name); continue; }
        to += '.new';
      }
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
      moved.push(path.basename(to));
    } catch (e) { failed.push(name + ': ' + e.message); }
  }
  return { moved, failed };
}
/* 外に残っている「こちらのもの」（トンネルIDの .json と woodcad.json）だけを数える。
   cert.pem はWEEKYなどのものかもしれないので、ここでは数えない。 */
function listStray(strayDir, tunnelId) {
  const names = ['woodcad.json'];
  if (tunnelId) names.push(tunnelId + '.json');
  return names.filter((n) => fs.existsSync(path.join(strayDir, n)));
}

/* ── ファイルを数える・ハッシュ ── */
function walk(dir, base = dir) {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else if (e.isFile() && !e.name.startsWith('.probe-')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function countFiles(dir) {
  const files = walk(dir);
  return { files: files.length, designs: files.filter((f) => f.endsWith('.json')).length };
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/* ── 提出を持ち出す ──
   「コピーしました」で終わらせない。1つずつ中身のハッシュを照合し、書き出した先でもう一度数える。
   出すのはフォルダ（中身は data\submissions と同じ形）。木工CADの「ファイルから読み込む」で開ける。 */
function exportSubmissions(ctx, destRoot) {
  destRoot = cleanPath(destRoot);
  if (!destRoot) return { ok: false, error: '書き出す場所を入れてください（例: D:\\）' };
  if (!path.isAbsolute(destRoot)) return { ok: false, error: 'ドライブから始まる場所を入れてください（例: D:\\ や C:\\Users\\…\\Documents）' };
  destRoot = path.resolve(destRoot);
  if (!fs.existsSync(destRoot) || !fs.statSync(destRoot).isDirectory()) return { ok: false, error: 'その場所が見つかりません: ' + destRoot };
  if (destRoot === ctx.HOME || isInside(ctx.HOME, destRoot)) {
    return { ok: false, error: 'このフォルダの中には書き出せません（「このPCから消す」で一緒に消えてしまうため）' };
  }
  const src = ctx.SUBMIT_DIR;
  const files = walk(src);
  let dir = path.join(destRoot, 'woodcad-submissions-' + fileStamp());
  for (let i = 2; fs.existsSync(dir); i++) dir = dir.replace(/(-\d+)?$/, '') + '-' + i;
  const list = [];
  let bytes = 0;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const rel of files) {
      const from = path.join(src, rel);
      const to = path.join(dir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      const a = sha256(from), b = sha256(to);
      if (a !== b) return { ok: false, dir, error: '書き出した中身が元と一致しません: ' + rel };
      const size = fs.statSync(to).size;
      bytes += size;
      list.push({ path: rel, bytes: size, sha256: a });
    }
    const manifest = {
      app: 'woodcad-receiver', exportedAt: localStamp(), count: list.length, bytes,
      designs: list.filter((f) => f.path.endsWith('.json')).length, files: list,
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  } catch (e) { return { ok: false, dir, error: e.message }; }

  // ★書き出した先で、もう一度数え直す★
  const check = verifyExport(dir);
  if (!check.ok) return { ok: false, dir, error: '書き出したあとの照合に失敗しました: ' + check.error };
  ctx.cfg.lastExportAt = localStamp();
  ctx.cfg.lastExportDir = dir;
  ctx.saveCfg(ctx.cfg);
  return { ok: true, dir, files: list.length, designs: check.designs, bytes, size: fmtSize(bytes) };
}
function verifyExport(dir) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return { ok: false, error: 'manifest.json が読めません' }; }
  if (!Array.isArray(m.files) || m.files.length !== m.count) return { ok: false, error: 'manifest.json の件数が合いません' };
  for (const f of m.files) {
    const full = path.join(dir, f.path);
    if (!fs.existsSync(full)) return { ok: false, error: 'ありません: ' + f.path };
    if (sha256(full) !== f.sha256) return { ok: false, error: '中身が違います: ' + f.path };
  }
  return { ok: true, manifest: m, designs: m.files.filter((f) => f.path.endsWith('.json')).length };
}

/* ── このPCから消す ── */
/* 消してよい形をしているか。rmdir の前に必ず通す。 */
function looksLikeReceiver(home) {
  try {
    if (!home || path.resolve(home) !== home) return false;
    if (path.parse(home).root === home) return false;
    if (home.split(/[\\/]/).filter(Boolean).length < 2) return false;
    if (/["%^&|<>]/.test(home)) return false;
    return fs.existsSync(path.join(home, 'launcher', 'main.js')) && fs.existsSync(path.join(home, 'app', 'server.js'));
  } catch { return false; }
}
function dirSize(dir) {
  let n = 0, bytes = 0;
  for (const rel of walk(dir)) { n++; try { bytes += fs.statSync(path.join(dir, rel)).size; } catch {} }
  return { files: n, bytes };
}
function wipePlan(ctx) {
  const out = { checks: [], canWipe: false, exported: false };
  const add = (name, ok, detail) => out.checks.push({ name, ok, detail: String(detail ?? '') });
  const home = ctx.HOME;
  const shape = looksLikeReceiver(home);
  add('消すのはこの受信フォルダか', shape, shape ? home : home + '  ← 形が違うので消しません');
  if (!shape) { out.error = 'このフォルダは消せません'; return out; }
  out.canWipe = true;
  const s = dirSize(home);
  out.home = home;
  out.size = fmtSize(s.bytes);
  add('消えるもの', true, `${home}（${s.files}ファイル / ${fmtSize(s.bytes)}）`);

  const now = walk(ctx.SUBMIT_DIR);
  const designs = now.filter((f) => f.endsWith('.json')).length;
  if (!now.length) {
    add('提出', true, 'まだ1件も届いていません');
    out.exported = true;
  } else if (!ctx.cfg.lastExportDir) {
    add('★提出を持ち出したか', false, `届いた設計が${designs}件あります。まだ持ち出していません`);
  } else {
    const v = verifyExport(ctx.cfg.lastExportDir);
    if (!v.ok) {
      add('★持ち出した一式がいまも読めるか', false, ctx.cfg.lastExportDir + '  ← ' + v.error + '（外付けを外していませんか）');
    } else {
      const had = new Set(v.manifest.files.map((f) => f.path));
      const newer = now.filter((f) => !had.has(f));
      const newerDesigns = newer.filter((f) => f.endsWith('.json')).length;
      add('★持ち出した一式がいまも読めるか', true, `${ctx.cfg.lastExportDir}（${ctx.cfg.lastExportAt}）`);
      add('持ち出したあとに届いた提出がないか', newer.length === 0,
        newer.length ? `持ち出したあとに${newerDesigns}件届いています。消すとそれは残りません` : 'ありません');
      out.exported = newer.length === 0;
    }
  }
  add('Cloudflare 側のトンネルとアドレス', true,
    'アカウントに残ります（このPCが無ければ動きません）。別のPCで同じアドレスを使うときは、このフォルダごと持っていけばそのまま使えます');
  return out;
}

/* 消す役を外に立てる。自分が動かしている node.exe の上のフォルダは、自分では消せないため。
   ★ファイルは1つも書かない★ コマンドの文字列だけで済ませる
   （WEEKYの風呂敷は %TEMP% に .cmd を置くが、WoodCAD.cmd は TEMP を tmp\ に向けているので、
     そのままだと「消すフォルダの中」に置いてしまう。ここではそもそも置かない）。 */
function spawnWiper(home, pid) {
  if (!looksLikeReceiver(home)) throw new Error('このフォルダは消せません');
  const parent = path.dirname(home);
  if (process.platform === 'win32') {
    const wait = 'ping -n 4 127.0.0.1 >nul';
    const line = `${wait} & rmdir /s /q "${home}" & if exist "${home}" (ping -n 6 127.0.0.1 >nul & rmdir /s /q "${home}") & start "" explorer.exe "${parent}"`;
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
      cwd: parent, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
    }).unref();
  } else {
    const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
    spawn('/bin/sh', ['-c', `i=0; while kill -0 ${Number(pid)} 2>/dev/null && [ $i -lt 30 ]; do sleep 0.5; i=$((i+1)); done; sleep 1; rm -rf ${q(home)}`], {
      cwd: parent, detached: true, stdio: 'ignore',
    }).unref();
  }
}

module.exports = {
  MIN_PASSWORD, localStamp, fileStamp, cleanPath, isInside, suspiciousPath, makeHash, verifyHash, applySetup,
  adoptFiles, listStray, walk, countFiles, fmtSize, exportSubmissions, verifyExport,
  looksLikeReceiver, wipePlan, spawnWiper,
};
