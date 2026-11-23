#!/usr/bin/env node
/**
 * Developer test for the channel push: sends ONE test message to this machine's Connect listener from a throwaway local
 * peer, the way a real peer would (it pairs with its own key, the request is approved here, the message goes out sealed),
 * so an open Claude session started with the Connect channel can be watched for the push. The throwaway peer is removed
 * again; its message stays in the inbox. Run it in a terminal, not in the session being watched.
 *
 *   node tools/connect/loopback-test.js [--root <workspace>] [--text "<message>"] [--session <session>] [--address host:port]
 *
 * --root     the workspace of the session to reach (default: the nearest Joserah workspace from here); its device folder
 *            and listener port are read from it. --session sends to that session's own inbox, else the device's shared one.
 * Nothing secret is printed. Nothing is started on this machine; the throwaway peer listens on a free local port while it runs.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { process.stderr.write(m + '\n'); process.exit(1); };

async function main() {
  const { findWorkspace } = require('../../hooks/lib/workspace');
  const ws = findWorkspace(arg('root') || process.cwd());
  if (!ws) die('no Joserah workspace here; pass --root <workspace>');
  const device = require('./device'); const config = require('./config'); const store = require('./store');
  const listener = require('./listener'); const api = require('./api');
  const target = device.resolve(ws).deviceRoot; // the machine's side: where its listener keeps its state
  const tcfg = config.loadConfig(target);
  const address = arg('address') || '127.0.0.1:' + tcfg.port;
  const text = arg('text') || 'Connect loopback test ' + new Date().toISOString();
  const name = 'loopback-' + crypto.randomBytes(2).toString('hex');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-loopback-'));
  config.saveConfig(tmp, { name, port: 0, bind: ['127.0.0.1'] });
  const servers = await listener.startListener(tmp, { bind: ['127.0.0.1'], port: 0 });
  try {
    const p = await api.connect(tmp, address, name);
    if (!p.ok) die('could not reach the listener at ' + address + ': ' + p.error);
    const a = await api.approve(target, p.id); // this machine's owner side of the pairing
    if (!a.ok) die('the pairing request was not found on this machine: ' + a.error);
    for (let i = 0; i < 50 && !Object.keys(store.readPeers(tmp)).length; i++) await sleep(100);
    const peer = Object.keys(store.readPeers(tmp))[0];
    if (!peer) die('the listener did not answer the pairing');
    const rec = store.readPeers(tmp)[peer];
    const session = arg('session');
    const to = session && rec.person && rec.device ? rec.person + '/' + rec.device + '/' + session : peer;
    const r = await api.send(tmp, to, text);
    if (!r.ok) die('not delivered: ' + r.error);
    console.log(`sent to ${address} as "${name}" (${session ? 'session ' + session : 'shared inbox'}): ${JSON.stringify(text)} [id ${r.id}]`);
  } finally {
    store.removePeer(target, name);
    await servers.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => die('failed: ' + (e && e.message)));
