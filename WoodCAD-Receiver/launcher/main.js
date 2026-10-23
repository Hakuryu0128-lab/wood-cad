/* 木工CAD 受信（風呂敷版）— ランチャー

   WEEKY Portable のランチャー（2026-10-21 実機で動いたもの）と同じ作り。
     1. 127.0.0.1 の空きポートに設定用の小さいWebサーバーを立てて、ブラウザで開く
     2. そこから app\server.js（提出受付）と cloudflared（トンネル）を子プロセスとして動かす

   ★約束（ここを破らない）★
     **このフォルダの外には何も書かない。レジストリにも触らない。**
     - Node は runtime\node\ に同梱（インストールしない）
     - 一時ファイルは tmp\（WoodCAD.cmd が TMP/TEMP を向けている）
     - cloudflared の資格情報は config\cloudflared\
     - サービス登録・タスクスケジューラ・ファイアウォール規則は作らない
     - 管理者権限は使わない
     だから「消す」はフォルダを消すだけで終わる。

   絶対パスはどこにも保存しない（USBやSSDで D: と E: が入れ替わるため）。
   全部このファイルの位置からの相対で解決する。 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const LIB = require('./lib.js');

const HOME = path.resolve(__dirname, '..');
const APP_DIR = path.join(HOME, 'app');
const CFG_DIR = path.join(HOME, 'config');
const CFG_PATH = path.join(CFG_DIR, 'receiver.json');
const DATA_DIR = path.join(HOME, 'data');
const SUBMIT_DIR = path.join(DATA_DIR, 'submissions');
const LOG_DIR = path.join(HOME, 'logs');
const TMP_DIR = path.join(HOME, 'tmp');
const PUBLIC = path.join(__dirname, 'public');
const IS_WIN = process.platform === 'win32';

/* cloudflared。検査ではにせものに差し替えられるように環境変数で上書きできる。 */
const CF_EXE = process.env.WOODCAD_CF_EXE || path.join(HOME, 'runtime', IS_WIN ? 'cloudflared.exe' : 'cloudflared');
const CF_DIR = path.join(CFG_DIR, 'cloudflared');
const CF_CERT = path.join(CF_DIR, 'cert.pem');
const CF_YML = path.join(CF_DIR, 'config.yml');
/* cloudflared が既定で書く場所。検査では差し替える。 */
const STRAY_DIR = process.env.WOODCAD_STRAY_DIR || path.join(os.homedir(), '.cloudflared');

for (const d of [CFG_DIR, CF_DIR, SUBMIT_DIR, LOG_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

/* ── 設定 ── */
const DEFAULT_CFG = {
  port: 8010,
  hostname: 'woodcad-submit.hakuryu.f5.si',
  tunnelName: 'woodcad',
  tunnel: false,
  autoStart: true,
  openBrowser: true,
  allowedOrigins: ['https://woodcad.hakuryu.f5.si', 'http://localhost:5173', 'http://localhost:4173'],
  maxBodyKb: 3000,
  maxSubmitsPer10min: 30,
};
function loadCfg() {
  try { return Object.assign({}, DEFAULT_CFG, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))); }
  catch { return { ...DEFAULT_CFG }; }
}
function saveCfg(c) { fs.writeFileSync(CFG_PATH, JSON.stringify(c, null, 2)); }
let cfg = loadCfg();
if (!fs.existsSync(CFG_PATH)) saveCfg(cfg);

/* ── ログ（画面にも出すし、ファイルにも残す）── */
const RING = [];
const logFile = path.join(LOG_DIR, 'launcher.log');
function log(line, kind = 'info') {
  // この土地の時刻で出す（toISOString は UTC なので9時間ずれて見える）
  const t = new Date().toTimeString().slice(0, 8);
  const rec = { t, kind, line: String(line).replace(/\s+$/, '') };
  RING.push(rec);
  while (RING.length > 400) RING.shift();
  try { fs.appendFileSync(logFile, `${LIB.localStamp()} [${kind}] ${rec.line}\n`); } catch {}
  console.log(`${t} ${kind === 'err' ? '!' : ' '} ${rec.line}`);
}
function pipeLines(stream, kind, prefix = '') {
  let buf = '';
  stream.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.trim()) log(prefix + line, kind);
    }
  });
}

/* ── 子プロセスの始末（Windows は SIGTERM が効かないことがある）── */
function killTree(pid) {
  try {
    if (IS_WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
    else process.kill(pid, 'SIGTERM');
    return true;
  } catch { return false; }
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/* ── 提出受付（app\server.js）── */
/* 黒い窓を閉じても子が道連れにならないことがある（Windowsでは閉じる合図が届かない）。
   PIDを書き残して、次の起動で拾えるようにする。WEEKYで実際に踏んだ。 */
const PID_PATH = path.join(TMP_DIR, 'receiver-server.pid');
function readPid() {
  try { const o = JSON.parse(fs.readFileSync(PID_PATH, 'utf8')); return Number.isInteger(o.pid) ? o : null; } catch { return null; }
}
function writePid(pid) { try { fs.writeFileSync(PID_PATH, JSON.stringify({ pid, port: cfg.port, at: Date.now() })); } catch {} }
function clearPid() { try { fs.unlinkSync(PID_PATH); } catch {} }

let child = null;
let childStartedAt = 0;

async function startServer() {
  if (child) return { ok: true, note: 'すでに動いています' };
  if (!cfg.passwordHash) return { ok: false, error: '先に「はじめての設定」で一覧ページのパスワードを決めてください' };
  if (!(await portFree(cfg.port))) {
    const old = readPid();
    if (old && isAlive(old.pid) && old.port === cfg.port) {
      return { ok: false, needsKill: true, pid: old.pid,
        error: `ポート ${cfg.port} は、前回起動した受付（PID ${old.pid}）がまだ使っています。「前のを止めて起動」を押してください。` };
    }
    return { ok: false, error: `ポート ${cfg.port} はほかのプログラムが使っています。「はじめての設定」でポートを 8011 などに変えてください。` };
  }
  log(`提出受付を起動します（ポート ${cfg.port}）`);
  child = spawn(process.execPath, ['server.js'], {
    cwd: APP_DIR,
    env: Object.assign({}, process.env, {
      PORT: String(cfg.port), WOODCAD_CONFIG: CFG_PATH, WOODCAD_DATA_DIR: DATA_DIR, TMP: TMP_DIR, TEMP: TMP_DIR,
    }),
    windowsHide: true,
  });
  childStartedAt = Date.now();
  writePid(child.pid);
  pipeLines(child.stdout, 'app');
  pipeLines(child.stderr, 'err');
  const me = child;
  child.on('exit', (code, sig) => {
    log(`提出受付が終了しました（code=${code} signal=${sig || '-'}）`, code ? 'err' : 'info');
    if (child === me) { child = null; clearPid(); }
  });
  child.on('error', (e) => { log('起動できませんでした: ' + e.message, 'err'); if (child === me) child = null; });
  return { ok: true };
}
function stopServer() {
  if (!child) return { ok: true, note: '動いていません' };
  log('提出受付を停止します');
  const c = child; child = null;
  killTree(c.pid);
  clearPid();
  return { ok: true };
}
function serverAnswers(ms = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: cfg.port, path: '/api/health', timeout: ms }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b).app === 'woodcad-receiver'); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitForServer(totalMs = 15000) {
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    if (await serverAnswers()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ── トンネル ──

   ★2026-10-21、WEEKYの実機で分かったこと★
   `cloudflared tunnel login` は書き先の指定を無視して %USERPROFILE%\.cloudflared\cert.pem に書く。
   なので「フラグを信じず、あとから実物を見てフォルダの中へ移す」。

   ★このPCでは WEEKY の風呂敷も cloudflared を使う★
   %USERPROFILE%\.cloudflared\ にあるものが WEEKY のものかもしれないので、
   **こちらが作ったと分かるものだけを移す**（WEEKYは何でも移す作りなので、ここが違う）。
     ・cert.pem … こちらのログインで出来たときだけ移す。
                  ログインの前から置いてあったら、移さずに「写して」使う（元は残す）
     ・<トンネルID>.json … こちらのトンネルのIDと一致するときだけ移す */
function cfEnv(extra) {
  return Object.assign({}, process.env, { TUNNEL_ORIGIN_CERT: CF_CERT, TMP: TMP_DIR, TEMP: TMP_DIR }, extra || {});
}
function cfRun(args, timeoutMs = 120000) {
  const r = spawnSync(CF_EXE, args, { env: cfEnv(), encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  return { ok: r.status === 0, code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}
function tunnelIdFromYml() {
  try { return (/^tunnel:\s*(\S+)/m.exec(fs.readFileSync(CF_YML, 'utf8')) || [])[1] || null; } catch { return null; }
}
function adoptOwn(names) {
  const r = LIB.adoptFiles({ strayDir: STRAY_DIR, cfDir: CF_DIR, names });
  if (r.moved.length) log('フォルダの外に出た資格情報を、このフォルダへ移しました: ' + r.moved.join(', '));
  for (const f of r.failed) log('移せませんでした: ' + f, 'err');
  return r;
}
function credFile() {
  const want = path.join(CF_DIR, (cfg.tunnelName || 'woodcad') + '.json');
  if (fs.existsSync(want)) return want;
  const id = tunnelIdFromYml();
  if (id && fs.existsSync(path.join(CF_DIR, id + '.json'))) return path.join(CF_DIR, id + '.json');
  return null;
}
/* config.yml は張る直前に、いまのフォルダといまのポートで書き直す。
   credentials-file は絶対パスなので、フォルダを動かすとそのままでは張れなくなる（WEEKYで踏んだ）。 */
function writeYml(id) {
  const cred = credFile() || path.join(CF_DIR, (cfg.tunnelName || 'woodcad') + '.json');
  const yml = [
    '# 木工CAD 受信のランチャーが作りました。張るたびに書き直します。',
    'tunnel: ' + id,
    'credentials-file: ' + cred,
    'no-autoupdate: true',
    'ingress:',
    '  - hostname: ' + cfg.hostname,
    '    service: http://127.0.0.1:' + cfg.port,
    '  - service: http_status:404',
    '',
  ].join('\n');
  fs.writeFileSync(CF_YML, yml);
}

let tunnel = null;
let tunnelWanted = false;
let tunnelRetried = false;
let tunnelRegistered = false;
let tunnelBackoff = 0;
let tunnelTimer = null;
let lastTunnelErr = '';
let currentEdgeVer = null;
let edgeLearned = null;

async function startTunnel() {
  if (tunnel) return { ok: true, note: 'すでに動いています' };
  if (!fs.existsSync(CF_EXE)) return { ok: false, error: 'runtime の cloudflared が見つかりません' };
  const id = tunnelIdFromYml();
  if (!id) return { ok: false, error: 'トンネルの用意がまだです。「外から受け取れるようにする」の①②から' };
  adoptOwn([id + '.json']);
  if (!credFile()) return { ok: false, error: 'トンネルの資格情報（config\\cloudflared\\*.json）がありません。②「トンネルを用意する」をやり直してください' };
  writeYml(id);

  /* ★受付が動いてからトンネルを張る★ 先に張ると外からは 502 になる（WEEKYの実機で踏んだ） */
  if (!(await serverAnswers())) {
    log('提出受付がまだ動いていないので、先に起動します');
    const r = await startServer();
    if (!r.ok) return { ok: false, error: '提出受付を起動できませんでした: ' + (r.error || '') };
    if (!(await waitForServer())) return { ok: false, error: '提出受付が応答しません。ログを見てください' };
  }
  tunnelWanted = true;
  tunnelRetried = false;
  tunnelBackoff = 0;
  spawnTunnel();
  cfg.tunnel = true; saveCfg(cfg);
  return { ok: true };
}
/* 落ち方で張り直し方を変える（WEEKYと同じ）。
   ① 一度も繋がらずに落ちた → 原因が分かれば直して1回だけ
   ② 繋がったあとで落ちた → 5秒→15秒→45秒→最大2分で何度でも（技術室のPCはつけっぱなしなので）
   ③ 人が止めた → 張り直さない */
function spawnTunnel(edgeVer) {
  const ver = edgeVer || cfg.edgeIpVersion || edgeLearned || null;
  currentEdgeVer = ver;
  log('トンネルを起動します' + (ver ? `（接続先は IPv${ver}）` : ''));
  const startedAt = Date.now();
  lastTunnelErr = '';
  tunnelRegistered = false;
  const t = spawn(CF_EXE, ['--config', CF_YML, 'tunnel', 'run'], {
    cwd: HOME, env: cfEnv(ver ? { TUNNEL_EDGE_IP_VERSION: String(ver) } : null), windowsHide: true,
  });
  tunnel = t;
  const watch = (st) => {
    let buf = '';
    st.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        if (/unreachable network/i.test(line) && /\[[0-9a-f:]+\]/i.test(line)) lastTunnelErr = 'ipv6';
        if (/Registered tunnel connection/i.test(line)) {
          if (!tunnelRegistered) log('外から届くようになりました: https://' + cfg.hostname);
          tunnelRegistered = true;
          if (currentEdgeVer) edgeLearned = currentEdgeVer;
        }
        log('[tunnel] ' + line, 'app');
      }
    });
  };
  watch(t.stdout); watch(t.stderr);
  t.on('exit', (c) => {
    if (tunnel === t) tunnel = null;
    const lived = Date.now() - startedAt;
    log('トンネルが終了しました（code=' + c + '）', c ? 'err' : 'info');
    if (!tunnelWanted) return;
    if (!tunnelRegistered && !tunnelRetried) {
      tunnelRetried = true;
      const v6 = lastTunnelErr === 'ipv6';
      log(v6 ? 'IPv6 で接続先に届きませんでした。IPv4 に固定して張り直します' : '繋がらないまま落ちたので、もう一度だけ張り直します');
      tunnelTimer = setTimeout(() => { if (tunnelWanted && !tunnel) spawnTunnel(v6 ? '4' : null); }, 1500);
      return;
    }
    if (tunnelRegistered && lived >= 60000) { tunnelBackoff = 0; }
    tunnelBackoff = tunnelBackoff ? Math.min(tunnelBackoff * 3, 120000) : 5000;
    log('トンネルが切れました。' + Math.round(tunnelBackoff / 1000) + '秒後に張り直します');
    tunnelRetried = false;
    tunnelTimer = setTimeout(() => { if (tunnelWanted && !tunnel) spawnTunnel(null); }, tunnelBackoff);
  });
  t.on('error', (e) => { log('トンネルを起動できませんでした: ' + e.message, 'err'); if (tunnel === t) tunnel = null; });
}
function stopTunnel(remember = true) {
  tunnelWanted = false;
  if (tunnelTimer) { clearTimeout(tunnelTimer); tunnelTimer = null; }
  if (remember && cfg.tunnel) { cfg.tunnel = false; saveCfg(cfg); }
  if (!tunnel) return { ok: true, note: '動いていません' };
  log('トンネルを停止します');
  const t = tunnel; tunnel = null;
  killTree(t.pid);
  return { ok: true };
}

/* Cloudflare へのログイン（子プロセスで待たない。人がブラウザで選ぶまで終わらないため） */
let loginProc = null;
let loginNote = '';
function startLogin() {
  if (loginProc) return { ok: true, note: 'ログイン待ちです。開いたブラウザで hakuryu.f5.si を選んでください' };
  if (!fs.existsSync(CF_EXE)) return { ok: false, error: 'runtime の cloudflared が見つかりません' };
  if (fs.existsSync(CF_CERT)) return { ok: true, note: 'ログインは済んでいます' };
  /* ログインの前から外に cert.pem があると、cloudflared は何もせずに終わる。
     それはWEEKYなど別のソフトのものかもしれないので、移さずに写して使う。 */
  const outside = path.join(STRAY_DIR, 'cert.pem');
  if (fs.existsSync(outside)) {
    fs.copyFileSync(outside, CF_CERT);
    log('このPCにあったCloudflareのログイン情報を写して使います（元のファイルはほかのソフトのものかもしれないので、そのまま残します）');
    return { ok: true, note: 'このPCにあったログイン情報を使いました' };
  }
  const hadDir = fs.existsSync(STRAY_DIR);
  log('Cloudflare へのログインを始めます（ブラウザが開きます。hakuryu.f5.si を選んで「Authorize」を押してください）');
  loginNote = 'ブラウザで hakuryu.f5.si を選んでください';
  try {
    loginProc = spawn(CF_EXE, ['tunnel', 'login'], { env: cfEnv(), windowsHide: true });
  } catch (e) { loginProc = null; return { ok: false, error: e.message }; }
  pipeLines(loginProc.stdout, 'app');
  pipeLines(loginProc.stderr, 'app');
  const lp = loginProc;
  const timer = setTimeout(() => {
    if (loginProc === lp) { log('ログインの待ち時間が15分を超えたので打ち切ります', 'err'); killTree(lp.pid); }
  }, 15 * 60 * 1000);
  timer.unref?.();
  lp.on('exit', (code) => {
    clearTimeout(timer);
    if (loginProc === lp) loginProc = null;
    // このログインで出来た cert.pem はこちらのもの。フォルダの中へ移す
    adoptOwn(['cert.pem']);
    if (!hadDir) { try { if (!fs.readdirSync(STRAY_DIR).length) fs.rmdirSync(STRAY_DIR); } catch {} }
    if (fs.existsSync(CF_CERT)) { loginNote = ''; log('Cloudflare にログインできました'); }
    else { loginNote = 'ログインが完了していません'; log('ログインが終わりませんでした（code=' + code + '）', 'err'); }
  });
  lp.on('error', (e) => { if (loginProc === lp) loginProc = null; log('ログインできませんでした: ' + e.message, 'err'); });
  return { ok: true, running: true };
}

function setupTunnel(hostname) {
  hostname = String(hostname || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+\.hakuryu\.f5\.si$/.test(hostname) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)) {
    return { ok: false, error: 'アドレスの形が違います（例: woodcad-submit.hakuryu.f5.si）' };
  }
  if (/^[a-z0-9-]+\.[a-z0-9-]+\.hakuryu\.f5\.si$/.test(hostname)) {
    return { ok: false, error: '2段のサブドメインは無料の証明書の範囲外です。woodcad-submit.hakuryu.f5.si のように1段にしてください' };
  }
  if (!fs.existsSync(CF_CERT)) return { ok: false, error: '先に①「Cloudflareにログイン」を' };
  const name = String(cfg.tunnelName || 'woodcad').replace(/[^A-Za-z0-9_-]/g, '') || 'woodcad';

  // 既にあれば作り直さない（作り直すとIDが変わってDNSが迷子になる）
  let id = null;
  const list = cfRun(['tunnel', 'list', '--output', 'json']);
  try {
    const hit = JSON.parse(list.out).find((t) => t.name === name && !t.deleted_at);
    if (hit) { id = hit.id; log(`既にあるトンネル ${name} を使います（${id}）`); }
  } catch {}
  if (!id) {
    const c = cfRun(['tunnel', 'create', '--credentials-file', path.join(CF_DIR, name + '.json'), name]);
    log(c.out.slice(0, 1200), c.ok ? 'app' : 'err');
    id = (/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(c.out) || [])[1];
    if (!id) return { ok: false, error: 'トンネルを作れませんでした（ログを見てください）' };
  }
  adoptOwn([id + '.json']);
  if (!credFile()) {
    return { ok: false, error: `トンネル ${name} はありますが、資格情報がこのフォルダにありません。`
      + 'ほかのPCで作ったトンネルなら、そのPCのフォルダの config\\cloudflared\\ を持ってきてください' };
  }
  const d = cfRun(['tunnel', 'route', 'dns', '--overwrite-dns', name, hostname]);
  log(d.out.slice(0, 800), d.ok ? 'app' : 'err');
  if (!d.ok) return { ok: false, error: 'アドレス（DNS）をトンネルに向けられませんでした（ログを見てください）' };
  cfg.hostname = hostname; cfg.tunnelName = name; saveCfg(cfg);
  writeYml(id);
  log('トンネルを用意しました: https://' + hostname + ' → このPCの提出受付');
  return { ok: true, id, hostname };
}

/* ── 診断 ── */
async function diagnose() {
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok, detail: String(detail ?? '') });
  add('同梱のNodeで動いている', true, `${process.version} / ${process.platform}-${process.arch}`);
  add('フォルダの場所', !LIB.suspiciousPath(HOME), LIB.suspiciousPath(HOME)
    ? HOME + '  ← OneDriveやネットワークの場所は避けて、C:\\ の直下などに置いてください' : HOME);
  try {
    const probe = path.join(SUBMIT_DIR, '.probe-' + process.pid);
    fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
    add('提出の保存先に書き込める', true, SUBMIT_DIR);
  } catch (e) { add('提出の保存先に書き込める', false, e.message); }
  add('一覧ページのパスワード', !!cfg.passwordHash, cfg.passwordHash ? '設定済み' : '「はじめての設定」で決めてください');
  add('提出受付', !!child, child ? `動いています（ポート ${cfg.port}）` : '止まっています');
  if (child) {
    const ans = await serverAnswers();
    add('提出受付が応答する', ans, ans ? `http://127.0.0.1:${cfg.port}/api/health` : '応答がありません');
  }
  add('cloudflared がある', fs.existsSync(CF_EXE), fs.existsSync(CF_EXE) ? path.relative(HOME, CF_EXE) : '見つかりません');
  add('Cloudflare にログイン済み', fs.existsSync(CF_CERT), fs.existsSync(CF_CERT) ? 'config\\cloudflared\\cert.pem' : 'まだです');
  const id = tunnelIdFromYml();
  add('トンネルの用意', !!(id && credFile()), id ? `${cfg.tunnelName}（${id.slice(0, 8)}…）→ ${cfg.hostname}` : 'まだです');
  add('外から届く（トンネル）', !!(tunnel && tunnelRegistered),
    tunnel ? (tunnelRegistered ? 'https://' + cfg.hostname : '接続中…') : '止まっています');
  const strays = LIB.listStray(STRAY_DIR, id);
  add('フォルダの外に、こちらの資格情報が残っていない', strays.length === 0,
    strays.length ? strays.join(', ') + '（「外に出た資格情報を移す」を押してください）' : 'ありません');
  return out;
}

/* ── ランチャーの画面 ── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
/* 画面からの操作は、この画面のページからだけ受け付ける（ほかのサイトから叩かせない） */
let LAUNCHER_ORIGIN = '';
function fromLauncher(req) {
  const o = req.headers.origin;
  return !o || o === LAUNCHER_ORIGIN;
}

const ctx = { HOME, DATA_DIR, SUBMIT_DIR, cfgPath: CFG_PATH, get cfg() { return cfg; }, saveCfg, isRunning: () => !!child || !!tunnel };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  if (req.method === 'POST' && !fromLauncher(req)) return send(res, 403, { ok: false, error: 'forbidden' });
  try {
    if (p === '/api/state') {
      const stale = (() => { if (child) return null; const o = readPid(); return o && isAlive(o.pid) ? o : null; })();
      return send(res, 200, {
        home: HOME,
        configured: !!cfg.passwordHash,
        running: !!child,
        uptimeSec: child ? Math.floor((Date.now() - childStartedAt) / 1000) : 0,
        stale,
        port: cfg.port,
        localUrl: `http://127.0.0.1:${cfg.port}/`,
        hostname: cfg.hostname,
        publicUrl: 'https://' + cfg.hostname,
        autoStart: cfg.autoStart !== false,
        tunnel: {
          hasExe: fs.existsSync(CF_EXE),
          loggedIn: fs.existsSync(CF_CERT),
          loginRunning: !!loginProc,
          loginNote,
          configured: !!(tunnelIdFromYml() && credFile()),
          running: !!tunnel,
          connected: !!(tunnel && tunnelRegistered),
          wanted: tunnelWanted,
        },
        submissions: LIB.countFiles(SUBMIT_DIR),
        lastExportAt: cfg.lastExportAt || '',
        lastExportDir: cfg.lastExportDir || '',
      });
    }
    if (p === '/api/diag') return send(res, 200, { checks: await diagnose() });
    if (p === '/api/log') return send(res, 200, { lines: RING.slice(-Number(u.searchParams.get('n') || 200)) });

    if (req.method !== 'POST') {
      // 静的ファイル
      const file = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const full = path.join(PUBLIC, file);
      if (!full.startsWith(PUBLIC + path.sep)) return send(res, 403, 'no', 'text/plain');
      return fs.readFile(full, (e, buf) => (e ? send(res, 404, 'not found', 'text/plain; charset=utf-8')
        : send(res, 200, buf, MIME[path.extname(full)] || 'application/octet-stream')));
    }

    const b = await readBody(req);
    /* 操作の前に設定ファイルを読み直す。開いている間に人が receiver.json を手で直していても
       （受け付けるページを足した、など）、こちらの古い中身で上書きしないため。検査で踏んだ。 */
    cfg = loadCfg();
    if (p === '/api/setup') {
      const r = LIB.applySetup(ctx, b);
      log(r.ok ? 'はじめての設定を保存しました' : '設定できませんでした: ' + r.error, r.ok ? 'info' : 'err');
      // ポートを変えたら、動いているものを新しいポートで立て直す
      if (r.ok && r.portChanged && child) {
        const tun = !!tunnel;
        stopTunnel(false); stopServer();
        await new Promise((x) => setTimeout(x, 800));
        await startServer();
        if (tun) await startTunnel();
      }
      return send(res, r.ok ? 200 : 400, r);
    }
    if (p === '/api/start') return send(res, 200, await startServer());
    if (p === '/api/stop') { stopTunnel(); return send(res, 200, stopServer()); }
    if (p === '/api/killstale') {
      const old = readPid();
      if (old && isAlive(old.pid)) { log(`置き去りの受付（PID ${old.pid}）を止めます`); killTree(old.pid); }
      clearPid();
      await new Promise((x) => setTimeout(x, 800));
      return send(res, 200, await startServer());
    }
    if (p === '/api/tunnel/login') return send(res, 200, startLogin());
    if (p === '/api/tunnel/setup') return send(res, 200, setupTunnel(b.hostname || cfg.hostname));
    if (p === '/api/tunnel/start') return send(res, 200, await startTunnel());
    if (p === '/api/tunnel/stop') return send(res, 200, stopTunnel());
    if (p === '/api/tunnel/adopt') return send(res, 200, adoptOwn(LIB.listStray(STRAY_DIR, tunnelIdFromYml())));

    if (p === '/api/export') {
      const r = LIB.exportSubmissions(ctx, b.dest);
      log(r.ok ? `提出を持ち出しました（${r.files}ファイル、照合OK）: ${r.dir}` : '持ち出せませんでした: ' + r.error, r.ok ? 'info' : 'err');
      return send(res, r.ok ? 200 : 400, r);
    }
    if (p === '/api/wipe/plan') return send(res, 200, LIB.wipePlan(ctx));
    if (p === '/api/wipe/run') {
      const plan = LIB.wipePlan(ctx);
      if (!plan.canWipe) return send(res, 400, { ok: false, error: plan.error || 'このフォルダは消せません' });
      if (b.confirm !== 'このPCから消す') return send(res, 400, { ok: false, error: '確認のことばが違います' });
      if (!plan.exported && !b.force) {
        return send(res, 400, { ok: false, needsExport: true, error: 'まだ提出を持ち出していません。先に「提出を持ち出す」を（持ち出さずに消すときはチェックを入れてください）' });
      }
      stopTunnel(false); stopServer();
      if (loginProc) killTree(loginProc.pid);
      await new Promise((x) => setTimeout(x, 1200));
      const old = readPid();
      if (old && isAlive(old.pid)) killTree(old.pid);
      LIB.spawnWiper(HOME, process.pid);
      log('このフォルダを消します。ランチャーを終了します: ' + HOME);
      send(res, 200, { ok: true, note: 'ランチャーを終了します。消し終わると、親フォルダが開きます' });
      setTimeout(() => process.exit(0), 700);
      return;
    }
    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    log('エラー: ' + (e && e.stack || e), 'err');
    return send(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

function freePort(from) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(freePort(from + 1)));
    s.once('listening', () => { const pt = s.address().port; s.close(() => resolve(pt)); });
    s.listen(from, '127.0.0.1');
  });
}

(async () => {
  // WEEKY の風呂敷（17345〜）と同じPCで動くので、番号をずらしておく
  const port = await freePort(Number(process.env.WOODCAD_LAUNCHER_PORT || 17445));
  server.listen(port, '127.0.0.1', async () => {
    const url = `http://127.0.0.1:${port}/`;
    LAUNCHER_ORIGIN = `http://127.0.0.1:${port}`;
    console.log('');
    console.log('  木工CAD 受信（風呂敷版）');
    console.log('  ' + HOME);
    console.log('  設定画面: ' + url);
    console.log('  この黒い窓は閉じないでください（閉じると受付も止まります）。最小化しておけば大丈夫です');
    console.log('');
    log('ランチャー起動 ' + url);
    try { fs.writeFileSync(path.join(TMP_DIR, 'launcher-url.txt'), url); } catch {}

    // ★開くだけで全部そろう★ 設定が済んでいれば、受付とトンネルを自動で起こす
    if (cfg.passwordHash && cfg.autoStart !== false) {
      const old = readPid();
      if (old && isAlive(old.pid) && old.port === cfg.port) { log(`前回の受付（PID ${old.pid}）が残っていたので止めます`); killTree(old.pid); clearPid(); await new Promise((x) => setTimeout(x, 800)); }
      const r = await startServer();
      if (!r.ok) log('自動起動できませんでした: ' + r.error, 'err');
      else if (cfg.tunnel && tunnelIdFromYml()) {
        const t = await startTunnel();
        if (!t.ok) log('トンネルを自動で張れませんでした: ' + t.error, 'err');
      }
    }
    if (cfg.openBrowser && IS_WIN && !process.env.WOODCAD_NO_BROWSER) {
      try { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
    }
    setInterval(() => {
      if (!process.stdout.isTTY) return; // 窓が無いときは書かない（制御文字がログに混ざる）
      const s = child ? (tunnel && tunnelRegistered ? '受付中（外から届きます）' : '受付中（このPCだけ）') : '停止中';
      try { process.stdout.write(`\x1b]0;木工CAD 受信 — ${s}\x07`); } catch {}
    }, 2000);
  });
})();

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => { stopTunnel(false); stopServer(); process.exit(0); }); } catch {}
}
process.on('exit', () => { try { stopTunnel(false); } catch {} try { stopServer(); } catch {} });
// 窓が閉じた合図。対話的な窓のときだけ（バックグラウンド起動だと最初から閉じていて即終了してしまう）
try {
  if (process.stdin.isTTY) { process.stdin.on('end', () => { stopTunnel(false); stopServer(); process.exit(0); }); process.stdin.resume(); }
} catch {}

