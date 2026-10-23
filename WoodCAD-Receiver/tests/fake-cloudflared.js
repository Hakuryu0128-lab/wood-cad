#!/usr/bin/env node
/* にせ cloudflared（検査用）。本物が書く場所・出す文言をまねる。
     tunnel login            → $FAKE_STRAY/cert.pem を書く（本物は %USERPROFILE%\.cloudflared に書く）
     tunnel list             → $FAKE_STATE のトンネル一覧
     tunnel create --credentials-file X name → X を書き、ID を出す。わざと外にも <id>.json を書く
     tunnel route dns ...    → 成功
     --config Y tunnel run   → Registered と出して居続ける
                               FAKE_TUNNEL_MODE=ipv6once なら1回目は IPv6 の失敗で落ちる */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const a = process.argv.slice(2);
const stray = process.env.FAKE_STRAY;
const stateFile = process.env.FAKE_STATE;
const st = (() => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { tunnels: [], runs: 0 }; } })();
const save = () => fs.writeFileSync(stateFile, JSON.stringify(st));
const has = (w) => a.includes(w);

if (has('login')) {
  fs.mkdirSync(stray, { recursive: true });
  const p = path.join(stray, 'cert.pem');
  if (fs.existsSync(p)) { console.error('ERR You have an existing certificate at ' + p + ' which login would overwrite.'); process.exit(1); }
  setTimeout(() => {
    fs.writeFileSync(p, 'FAKE-CERT');
    console.error('You have successfully logged in.\nIf you wish to copy your credentials to a server, they have been saved to:\n' + p);
    process.exit(0);
  }, 300);
} else if (has('list')) {
  console.log(JSON.stringify(st.tunnels));
} else if (has('create')) {
  if (!fs.existsSync(process.env.TUNNEL_ORIGIN_CERT || '')) { console.error('ERR Cannot find a valid certificate'); process.exit(1); }
  const name = a[a.length - 1];
  const cred = a[a.indexOf('--credentials-file') + 1];
  const id = crypto.randomUUID();
  fs.writeFileSync(cred, JSON.stringify({ TunnelID: id }));
  fs.mkdirSync(stray, { recursive: true });
  fs.writeFileSync(path.join(stray, id + '.json'), JSON.stringify({ TunnelID: id, copy: true }));
  st.tunnels.push({ id, name }); save();
  console.log(`Tunnel credentials written to ${cred}.\nCreated tunnel ${name} with id ${id}`);
} else if (has('route')) {
  console.log('INF Added CNAME ' + a[a.length - 1] + ' which will route to this tunnel');
} else if (has('run')) {
  const yml = fs.readFileSync(a[a.indexOf('--config') + 1], 'utf8');
  const cred = (/credentials-file:\s*(.+)/.exec(yml) || [])[1];
  st.runs = (st.runs || 0) + 1; st.lastEdge = process.env.TUNNEL_EDGE_IP_VERSION || 'auto'; st.lastYml = yml; save();
  if (!cred || !fs.existsSync(cred.trim())) { console.error('ERR credentials file not found'); process.exit(1); }
  if (process.env.FAKE_TUNNEL_MODE === 'ipv6once' && st.runs === 1) {
    console.error('WRN write udp [::]:51404->[2606:4700:a0::3]:7844: unreachable network');
    process.exit(1);
  }
  console.error('INF Registered tunnel connection connIndex=0 location=kix03 protocol=quic edge=' + st.lastEdge);
  setInterval(() => {}, 1 << 30);
  process.on('SIGTERM', () => process.exit(0));
} else {
  console.error('unknown: ' + a.join(' ')); process.exit(2);
}
