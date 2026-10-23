/* 木工CAD 受信（風呂敷版）の通し検査。Linux 上で「何も無いPC」を組んで、上から順に叩く。
   node tests/t-receiver.js
   ・にせ cloudflared を使う（本物の書き先のくせ＝外に書く、をまねている）
   ・HOME を空のフォルダに差し替え、最後に「フォルダの外に何も残っていない」ことを確かめる */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('OK  ' + m); } else { fail++; console.log('NG  ' + m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wcr-'));
const PC = path.join(ROOT, 'pc');            // 学校PCのつもり
const HOMEDIR = path.join(ROOT, 'userhome');  // %USERPROFILE% のつもり
const STRAY = path.join(HOMEDIR, '.cloudflared');
const DEST = path.join(ROOT, 'usb');          // 持ち出し先（USBのつもり）
fs.mkdirSync(PC); fs.mkdirSync(HOMEDIR); fs.mkdirSync(DEST);
const R = path.join(PC, 'WoodCAD-Receiver');
fs.cpSync(SRC, R, { recursive: true, filter: (s) => !/^(tests|runtime|data|config|logs|tmp)(\/|$)/.test(path.relative(SRC, s)) });
const FAKE = path.join(ROOT, 'fake-cloudflared.js');
fs.copyFileSync(path.join(__dirname, 'fake-cloudflared.js'), FAKE);
fs.chmodSync(FAKE, 0o755);
const STATE = path.join(ROOT, 'fake-state.json');
const SERVER_PORT = 18010 + Math.floor(Math.random() * 500);
const ORIGIN = 'https://woodcad.hakuryu.f5.si';

function req(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}, headers) }, (res) => {
      const ch = []; res.on('data', (d) => ch.push(d));
      res.on('end', () => { const buf = Buffer.concat(ch); let json = null; try { json = JSON.parse(buf.toString()); } catch {} resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString(), json }); });
    });
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

let L = null, LURL = '';
async function startLauncher(extraEnv = {}) {
  try { fs.unlinkSync(path.join(R, 'tmp', 'launcher-url.txt')); } catch {}
  L = spawn(process.execPath, [path.join(R, 'launcher', 'main.js')], {
    env: Object.assign({}, process.env, {
      HOME: HOMEDIR, USERPROFILE: HOMEDIR, TMP: path.join(R, 'tmp'), TEMP: path.join(R, 'tmp'), TMPDIR: path.join(R, 'tmp'),
      WOODCAD_CF_EXE: FAKE, WOODCAD_STRAY_DIR: STRAY, WOODCAD_NO_BROWSER: '1',
      WOODCAD_LAUNCHER_PORT: String(17445 + Math.floor(Math.random() * 300)), FAKE_STRAY: STRAY, FAKE_STATE: STATE,
    }, extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  L.out = '';
  L.stdout.on('data', (d) => { L.out += d; });
  L.stderr.on('data', (d) => { L.out += d; });
  for (let i = 0; i < 50; i++) {
    try { LURL = fs.readFileSync(path.join(R, 'tmp', 'launcher-url.txt'), 'utf8').trim(); break; } catch { await sleep(100); }
  }
  return LURL;
}
const lp = (p, body) => req('POST', LURL + p.replace(/^\//, ''), { body: body || {}, headers: { Origin: LURL.replace(/\/$/, '') } });
const lg = (p) => req('GET', LURL + p.replace(/^\//, ''));
async function waitFor(fn, ms = 8000) { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return true; await sleep(200); } return false; }
const SRV = () => `http://127.0.0.1:${SERVER_PORT}`;
const basic = (pw) => ({ Authorization: 'Basic ' + Buffer.from('sensei:' + pw).toString('base64') });

(async () => {
  console.log('検査用のPC: ' + PC);
  // ── zip と CRC（単体） ──
  const S = require(path.join(R, 'app', 'server.js'));
  ok(S.crc32(Buffer.from('123456789')) === 0xcbf43926, 'CRC32 が正しい（123456789 → CBF43926）');
  const zf = path.join(ROOT, 't.zip');
  fs.writeFileSync(zf, S.makeZip([{ name: '日本語.json', data: Buffer.from('{"a":1}') }, { name: 'b.jpg', data: Buffer.alloc(5000, 7) }]));
  const py = spawnSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),z.namelist(),z.read('日本語.json'))`, zf], { encoding: 'utf8' });
  ok(py.stdout.includes("None ['日本語.json', 'b.jpg']") && py.stdout.includes('{"a":1}'), 'zip を Python の zipfile が壊れずに読める（日本語のファイル名も）');
  ok(S.classLabel('1205') === '1年2組5番', '番号 1205 → 1年2組5番');

  // ── 1回目の起動：何も設定していない ──
  await startLauncher();
  ok(!!LURL, 'ランチャーが起動して設定画面のURLを書いた: ' + LURL);
  let st = (await lg('/api/state')).json;
  ok(st && st.configured === false, 'はじめは「未設定」');
  ok(fs.existsSync(path.join(R, 'config', 'receiver.json')), 'config\\receiver.json ができた');
  let r = await lp('/api/start');
  ok(r.json && !r.json.ok && /パスワード/.test(r.json.error), 'パスワードを決める前は起動できない: ' + (r.json && r.json.error));
  r = await req('POST', LURL + 'api/start', { body: {}, headers: { Origin: 'https://evil.example' } });
  ok(r.status === 403, 'ほかのサイトからランチャーを操作できない（403）');

  // ── はじめての設定 ──
  r = await lp('/api/setup', { password: 'short', password2: 'short' });
  ok(r.status === 400 && /8文字/.test(r.json.error), '短いパスワードは断る');
  r = await lp('/api/setup', { password: 'mokkou-2026', password2: 'mokkou-2027' });
  ok(r.status === 400 && /一致/.test(r.json.error), '確認用が違うと断る');
  r = await lp('/api/setup', { password: 'mokkou-2026', password2: 'mokkou-2026', port: SERVER_PORT, autoStart: true });
  ok(r.json && r.json.ok, 'パスワードとポートを保存できた');
  const cfg1 = JSON.parse(fs.readFileSync(path.join(R, 'config', 'receiver.json'), 'utf8'));
  ok(cfg1.passwordHash && !JSON.stringify(cfg1).includes('mokkou-2026'), '設定ファイルにパスワードの平文が無い（ハッシュだけ）');
  // 開発中のページから送る検査のため、受け付けるページを1つ足す（ランチャーの設定ファイルをそのまま使う）
  cfg1.allowedOrigins.push('http://localhost:4175');
  fs.writeFileSync(path.join(R, 'config', 'receiver.json'), JSON.stringify(cfg1, null, 2));

  // ── 受付を始める ──
  r = await lp('/api/start');
  ok(r.json && r.json.ok, '受付を起動できた');
  ok(await waitFor(async () => (await req('GET', SRV() + '/api/health')).json?.app === 'woodcad-receiver'), '提出受付が応答する（/api/health）');

  // ── 生徒からの送信 ──
  const thumb = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const design = { num: '1205', name: '山田 太郎', title: '本棚案', boards: [{ id: 1, thickness: 15, width: 150, length: 300 }], summary: { boardCount: 1, fitsSpace: true, stockOk: true, size: { width: 300, depth: 150, height: 15 } }, thumbnail: thumb };
  r = await req('POST', SRV() + '/api/submit', { body: design });
  ok(r.status === 403, 'Origin が無い送信は断る（403）');
  r = await req('POST', SRV() + '/api/submit', { body: design, headers: { Origin: 'https://evil.example' } });
  ok(r.status === 403, '知らないページからの送信は断る（403）');
  r = await req('OPTIONS', SRV() + '/api/submit', { headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
  ok(r.status === 204 && r.headers['access-control-allow-origin'] === ORIGIN, '木工CADのページからの事前確認（CORS）に答える');
  r = await req('POST', SRV() + '/api/submit', { body: design, headers: { Origin: ORIGIN } });
  ok(r.status === 200 && r.json.ok && r.headers['access-control-allow-origin'] === ORIGIN, '木工CADのページからの送信を受け取った');
  r = await req('POST', SRV() + '/api/submit', { body: Object.assign({}, design, { title: '机案' }), headers: { Origin: ORIGIN } });
  ok(r.status === 200, '2件目も受け取った');
  r = await req('POST', SRV() + '/api/submit', { body: { num: '1205' }, headers: { Origin: ORIGIN } });
  ok(r.status === 400 && /name/.test(r.json.error), '名前の無い送信は断る（400）');
  r = await req('POST', SRV() + '/api/submit', { body: '{"num":', headers: { Origin: ORIGIN } });
  ok(r.status === 400, '壊れたデータは断る（400）');
  r = await req('POST', SRV() + '/api/submit', { body: Buffer.alloc(3100 * 1024, 32), headers: { Origin: ORIGIN } });
  ok(r.status === 413, '大きすぎるデータは断る（413）');
  const days = fs.readdirSync(path.join(R, 'data', 'submissions'));
  const saved = fs.readdirSync(path.join(R, 'data', 'submissions', days[0]));
  ok(days.length === 1 && saved.filter((f) => f.endsWith('.json')).length === 2 && saved.filter((f) => f.endsWith('.jpg')).length === 2,
    'data\\submissions\\日付\\ に設計2件とサムネイル2枚: ' + saved.join(', '));
  const rec = JSON.parse(fs.readFileSync(path.join(R, 'data', 'submissions', days[0], saved.find((f) => f.endsWith('.json'))), 'utf8'));
  ok(rec.version === 2 && rec.meta.num === '1205' && !('thumbnail' in rec) && rec.boards.length === 1, '保存した形が木工CADで読める形（version 2・サムネイルは別ファイル）');

  // ── 先生の一覧ページ ──
  r = await req('GET', SRV() + '/');
  ok(r.status === 401 && /Basic/.test(r.headers['www-authenticate'] || ''), '一覧ページはパスワードが要る（401）');
  r = await req('GET', SRV() + '/', { headers: basic('wrong-pass') });
  ok(r.status === 401, '違うパスワードでは開けない');
  r = await req('GET', SRV() + '/', { headers: basic('mokkou-2026') });
  ok(r.status === 200 && r.text.includes('山田 太郎') && r.text.includes('1年2組') && r.text.includes('置き場所に収まる'), '正しいパスワードで一覧が開く（学級でまとまり、判定も出る）');
  const fileHref = (/href="\/file\?f=([^"&]+)&dl=1"/.exec(r.text) || [])[1];
  r = await req('GET', SRV() + '/file?f=' + fileHref + '&dl=1', { headers: basic('mokkou-2026') });
  ok(r.status === 200 && r.json && r.json.meta && /attachment/.test(r.headers['content-disposition'] || ''), '1件ずつダウンロードできる');
  r = await req('GET', SRV() + '/file?f=' + encodeURIComponent('../config/receiver.json'), { headers: basic('mokkou-2026') });
  ok(r.status === 404, 'フォルダの外のファイルは出さない（../ を断る）');
  r = await req('GET', SRV() + `/zip?day=${days[0]}&latest=1`, { headers: basic('mokkou-2026') });
  fs.writeFileSync(zf, r.buf);
  const pz = spawnSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),len(z.namelist()))', zf], { encoding: 'utf8' });
  ok(r.status === 200 && pz.stdout.trim() === 'None 2', 'まとめてダウンロードのzipが読める（設計2件。旧版と同じく json だけ）: ' + pz.stdout.trim());

  // ── トンネル ──
  // WEEKYの風呂敷の資格情報が外に残っている状況を作る（こちらは触ってはいけない）
  fs.mkdirSync(STRAY, { recursive: true });
  fs.writeFileSync(path.join(STRAY, 'weeky.json'), '{"WEEKY":true}');
  r = await lp('/api/tunnel/setup', { hostname: 'woodcad-submit.hakuryu.f5.si' });
  ok(r.json && !r.json.ok && /ログイン/.test(r.json.error), 'ログイン前はトンネルを用意できない');
  r = await lp('/api/tunnel/login');
  ok(r.json && r.json.ok, 'ログインを始めた');
  ok(await waitFor(async () => (await lg('/api/state')).json.tunnel.loggedIn), 'ログインが終わった');
  ok(fs.existsSync(path.join(R, 'config', 'cloudflared', 'cert.pem')) && !fs.existsSync(path.join(STRAY, 'cert.pem')),
    '外に書かれた cert.pem をフォルダの中へ移した');
  r = await lp('/api/tunnel/setup', { hostname: 'a.b.hakuryu.f5.si' });
  ok(r.json && !r.json.ok && /1段/.test(r.json.error), '2段のサブドメインは断る');
  r = await lp('/api/tunnel/setup', { hostname: 'woodcad-submit.hakuryu.f5.si' });
  ok(r.json && r.json.ok, 'トンネルを用意できた: ' + (r.json && (r.json.error || r.json.id)));
  const id1 = r.json.id;
  ok(fs.existsSync(path.join(R, 'config', 'cloudflared', 'woodcad.json')), '資格情報はフォルダの中（--credentials-file）');
  ok(!fs.existsSync(path.join(STRAY, id1 + '.json')), '外にも書かれた <ID>.json はフォルダの中へ引き取った');
  ok(fs.existsSync(path.join(STRAY, 'weeky.json')), '★WEEKYの資格情報（weeky.json）には触っていない★');
  const yml = fs.readFileSync(path.join(R, 'config', 'cloudflared', 'config.yml'), 'utf8');
  ok(yml.includes('hostname: woodcad-submit.hakuryu.f5.si') && yml.includes(`service: http://127.0.0.1:${SERVER_PORT}`) && yml.includes(path.join(R, 'config', 'cloudflared')),
    'config.yml がこのフォルダとこのポートを向いている');
  r = await lp('/api/tunnel/setup', { hostname: 'woodcad-submit.hakuryu.f5.si' });
  ok(r.json.ok && r.json.id === id1, 'もう一度押しても作り直さない（同じID）');

  r = await lp('/api/tunnel/start');
  ok(r.json && r.json.ok, 'トンネルを始めた');
  ok(await waitFor(async () => (await lg('/api/state')).json.tunnel.connected), '「外から届きます」になった');
  r = await lp('/api/tunnel/stop');
  await sleep(500);
  st = (await lg('/api/state')).json;
  ok(!st.tunnel.running && st.running, 'トンネルだけ止められる（受付は動いたまま）');

  // ── IPv6 で落ちたら IPv4 で張り直す ──
  // （にせ cloudflared の起動回数を数え直す）
  fs.writeFileSync(STATE, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(STATE, 'utf8')), { runs: 0 })));

  // ── 持ち出す ──
  r = await lp('/api/export', { dest: path.join(R, 'data') });
  ok(r.status === 400 && /中には/.test(r.json.error), 'このフォルダの中には書き出さない');
  r = await lp('/api/export', { dest: '"' + DEST + '"' });
  ok(r.json && r.json.ok && r.json.designs === 2 && r.json.files === 4, '前後の " を外して書き出せた（設計2件・4ファイル）: ' + (r.json.error || r.json.dir));
  const man = JSON.parse(fs.readFileSync(path.join(r.json.dir, 'manifest.json'), 'utf8'));
  ok(man.count === 4 && man.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)), 'manifest.json に4ファイルとハッシュ');
  let plan = (await lp('/api/wipe/plan')).json;
  ok(plan.canWipe && plan.exported, '消す前の確認：持ち出し済み');
  r = await req('POST', SRV() + '/api/submit', { body: Object.assign({}, design, { title: '箱案' }), headers: { Origin: ORIGIN } });
  plan = (await lp('/api/wipe/plan')).json;
  ok(!plan.exported && plan.checks.some((c) => !c.ok && /届いています/.test(c.detail)), '持ち出したあとに届いた分があると「持ち出し済み」にしない');
  const exp2 = (await lp('/api/export', { dest: DEST })).json;
  ok(exp2.ok && exp2.designs === 3 && exp2.dir !== r.json?.dir, 'もう一度持ち出せる（別のフォルダに）');
  // 持ち出した一式を壊すと、消す前の確認で気づく
  const victim = JSON.parse(fs.readFileSync(path.join(exp2.dir, 'manifest.json'), 'utf8')).files[0].path;
  fs.appendFileSync(path.join(exp2.dir, victim), 'x');
  plan = (await lp('/api/wipe/plan')).json;
  ok(!plan.exported && plan.checks.some((c) => /中身が違います/.test(c.detail)), '持ち出した一式が壊れていたら気づく（中身のハッシュ）');
  fs.writeFileSync(path.join(exp2.dir, victim), fs.readFileSync(path.join(R, 'data', 'submissions', victim)));

  // ── 開き直すと全部自動で始まる（IPv6 で1回落ちる回線のつもり）──
  L.kill('SIGTERM');
  await sleep(1200);
  ok(!(await req('GET', SRV() + '/api/health')).json, 'ランチャーを閉じると受付も止まる');
  // 外からの受付を「始めた」状態で閉じた、にしておく
  const c2 = JSON.parse(fs.readFileSync(path.join(R, 'config', 'receiver.json'), 'utf8')); c2.tunnel = true;
  fs.writeFileSync(path.join(R, 'config', 'receiver.json'), JSON.stringify(c2, null, 2));
  await startLauncher({ FAKE_TUNNEL_MODE: 'ipv6once' });
  ok(await waitFor(async () => (await req('GET', SRV() + '/api/health')).json?.ok), '開き直すだけで受付が自動で始まる');
  ok(await waitFor(async () => (await lg('/api/state')).json.tunnel.connected, 10000), '開き直すだけでトンネルも自動で張られる');
  const fst = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  ok(fst.runs === 2 && fst.lastEdge === '4' && /IPv4 に固定/.test(L.out), 'IPv6 で落ちたら IPv4 に固定して1回だけ張り直した');
  ok(fst.lastYml.includes(path.join(R, 'config', 'cloudflared', 'woodcad.json')), '張る直前に config.yml をいまのフォルダで書き直している');

  // ── 診断 ──
  const diag = (await lg('/api/diag')).json.checks;
  ok(diag.length >= 9 && diag.filter((c) => !c.ok).length === 0, '診断が全部 ✓: ' + diag.filter((c) => !c.ok).map((c) => c.name).join(','));

  // ── このPCから消す ──
  r = await lp('/api/wipe/run', { confirm: 'けす' });
  ok(r.status === 400 && /確認/.test(r.json.error), '確認のことばが違うと消さない');
  ok(fs.existsSync(R), 'まだ消えていない');
  r = await lp('/api/wipe/run', { confirm: 'このPCから消す' });
  ok(r.json && r.json.ok, '「このPCから消す」で消し始めた');
  ok(await waitFor(async () => !fs.existsSync(R), 10000), '★フォルダが丸ごと消えた★');
  ok(!(await req('GET', SRV() + '/api/health')).json, '受付も止まっている');
  await sleep(500);
  const leftHome = fs.readdirSync(HOMEDIR).concat(fs.existsSync(STRAY) ? fs.readdirSync(STRAY).map((f) => '.cloudflared/' + f) : []);
  ok(JSON.stringify(leftHome) === JSON.stringify(['.cloudflared', '.cloudflared/weeky.json']),
    '★ユーザーフォルダに残っているのは、もともとあったWEEKYの weeky.json だけ★: ' + leftHome.join(', '));
  ok(JSON.stringify(fs.readdirSync(PC)) === '[]', '★PCの置き場所には何も残っていない★');
  const ps = spawnSync('pgrep', ['-f', R], { encoding: 'utf8' });
  ok(!ps.stdout.trim(), '置き去りのプロセスが無い');

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  try { L.kill(); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { L.kill(); } catch {} process.exit(1); });
