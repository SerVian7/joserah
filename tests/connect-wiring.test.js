'use strict';
// Joserah Connect v2, wiring: device-level store, path addresses and session routing, who, automatic setup,
// v1 migration, one listener per person-device, the unread hook. Temp home (JOSERAH_CONNECT_HOME), temp
// workspaces, loopback, firewall off; nothing here may touch the real home or port 4790.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { PLUGIN_ROOT, runTool } = require('./helpers');

const C = path.join(PLUGIN_ROOT, 'tools', 'connect');
const MCP = path.join(C, 'mcp.js');
const HOOK = path.join(PLUGIN_ROOT, 'hooks', 'connect-unread.js');
const cfg = require(path.join(C, 'config.js'));
const store = require(path.join(C, 'store.js'));
const cx = require(path.join(C, 'crypto.js'));
const http = require(path.join(C, 'http.js'));
const listener = require(path.join(C, 'listener.js'));
const api = require(path.join(C, 'api.js'));
const files = require(path.join(C, 'files.js'));
const device = require(path.join(C, 'device.js'));
const firewall = require(path.join(C, 'firewall.js'));
const { TOOLS } = require(MCP);

const T = { timeout: 60000 };
const LOCAL = '127.0.0.1';
const MARKER = 'ZZ-WIRING-MARKER-ZZ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => crypto.randomBytes(n).toString('hex');
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };

// A per-test kit: temp folders and child processes, cleaned up in the right order (children first).
function kit(t) {
  const kids = []; const dirs = [];
  t.after(async () => {
    await Promise.all(kids.map((k) => k.stop()));
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-wire-')); dirs.push(d); return d; };
  const wsDir = (config, name = 'ws') => {
    const root = path.join(tmp(), name);
    fs.mkdirSync(path.join(root, '.joserah'), { recursive: true });
    if (config !== undefined) fs.writeFileSync(path.join(root, '.joserah', 'config.json'), JSON.stringify(config));
    return root;
  };
  const owner = (person, workspace, extra) => wsDir({ ownerName: person, workspaceName: workspace, trust: 'owner', ...(extra || {}) }, 'w-' + hex(3));
  const mcp = async (ws, { home, port = '0', env = {} } = {}) => {
    const child = spawn(process.execPath, [MCP], {
      cwd: ws, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: ws, JOSERAH_CONNECT_HOME: home, JOSERAH_CONNECT_PORT: String(port),
        JOSERAH_CONNECT_FIREWALL: 'off', JOSERAH_CONNECT_RETRY_MS: '200', ...env },
    });
    let err = ''; let stopped = false;
    child.stderr.on('data', (c) => { err += c; });
    const waiting = new Map(); let next = 1;
    readline.createInterface({ input: child.stdout }).on('line', (l) => {
      let m; try { m = JSON.parse(l); } catch { return; }
      const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); }
    });
    const exited = new Promise((r) => child.on('exit', r));
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => reject(new Error('no answer to ' + method)), 20000);
      waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const h = {
      child, rpc, stderr: () => err, all: [],
      async call(name, args) {
        const m = await rpc('tools/call', { name, arguments: args || {} });
        const text = m.result.content[0].text;
        h.all.push(text);
        const body = text.startsWith('{') ? text : text.slice(text.indexOf('\n') + 1);
        return { ...JSON.parse(body), isError: m.result.isError };
      },
      async stop() {
        if (stopped) return; stopped = true;
        try { child.stdin.end(); } catch { /* gone */ }
        const timer = setTimeout(() => child.kill(), 8000); // only the process this test started
        await exited; clearTimeout(timer);
      },
    };
    kids.push(h);
    await rpc('initialize', {});
    return h;
  };
  return { tmp, wsDir, owner, mcp };
}

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, LOCAL, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const idAt = async (port) => { try { const r = await http.request({ address: LOCAL, port, path: '/id', timeout: 3000 }); return r.status === 200 && r.json ? r.json.keyid : null; } catch { return null; } };
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting'); await sleep(100); } };
const devRoot = (home, person) => device.deviceDir(home, person);
const keyOf = (dev) => JSON.parse(fs.readFileSync(path.join(dev, 'keys', 'connect.json'), 'utf8')).identity;
function listing(dir) {
  const out = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); out.push(path.relative(dir, p) + (e.isDirectory() ? '/' : '')); if (e.isDirectory()) walk(p); } })(dir);
  return out.sort();
}

// ---- store and device fixes ------------------------------------------------------------------

test('store.connectDir: a device root is its own connect folder, a workspace uses .joserah/connect', (t) => {
  const k = kit(t);
  const home = k.tmp();
  const dev = devRoot(home, 'some-person');
  assert.strictEqual(store.connectDir(dev), dev);
  const wsRoot = k.wsDir({});
  assert.strictEqual(store.connectDir(wsRoot), path.join(wsRoot, '.joserah', 'connect'));
  assert.strictEqual(store.keysPath(dev), path.join(dev, 'keys', 'connect.json'));
  store.writeKeys(dev, { identity: { private: 'p', public: 'q' } });
  assert.ok(fs.existsSync(path.join(dev, 'keys', 'connect.json')));
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(dev).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(path.join(dev, 'keys', 'connect.json')).mode & 0o777, 0o600);
  }
});

test('device.resolve takes its default home from JOSERAH_CONNECT_HOME', T, (t) => {
  const k = kit(t);
  const home = k.tmp();
  const root = k.owner('Pat Person', 'W One');
  const r = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(C, 'device.js'))}).resolve(${JSON.stringify(root)}).deviceRoot)`],
    { encoding: 'utf8', env: { ...process.env, JOSERAH_CONNECT_HOME: home } });
  assert.strictEqual(r.stdout.trim(), devRoot(home, 'pat-person'));
});

test('registerSession from several processes at once loses no session', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const dev = devRoot(home, 'pat-person');
  const names = ['s1', 's2', 's3', 's4', 's5', 's6'];
  await Promise.all(names.map((n) => new Promise((resolve, reject) => {
    const code = `const d=require(${JSON.stringify(path.join(C, 'device.js'))});` +
      `for(let i=0;i<5;i++)d.registerSession({mode:'owner',deviceRoot:${JSON.stringify(dev)},session:${JSON.stringify(n)},wsRoot:${JSON.stringify(path.join(home, n))}})`;
    const c = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
    c.on('exit', (s) => (s === 0 ? resolve() : reject(new Error('registerSession process failed: ' + s))));
  })));
  const map = JSON.parse(fs.readFileSync(path.join(dev, 'sessions.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(map).sort(), names);
});

test('migrate carries seen.json and delivered.json so replay protection survives the move', T, (t) => {
  const k = kit(t);
  const home = k.tmp();
  const root = k.owner('Pat Person', 'W One');
  put(path.join(root, 'keys', 'connect.json'), { identity: { private: 'PRIV', public: 'PUB' } });
  const c = path.join(root, '.joserah', 'connect');
  put(path.join(c, 'peers.json'), { p: { keyid: 'k' } });
  put(path.join(c, 'seen.json'), { k: { iv1: Date.now() } });
  put(path.join(c, 'delivered.json'), { k: { oid1: Date.now() } });
  const r = device.migrate(root, { home, hostname: 'H' });
  assert.strictEqual(r.migrated, true);
  const dev = devRoot(home, 'pat-person');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dev, 'seen.json'), 'utf8')).k.iv1);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dev, 'delivered.json'), 'utf8')).k.oid1);
  assert.ok(fs.existsSync(path.join(c, 'seen.json.v1-backup')));
  assert.ok(fs.existsSync(path.join(c, 'delivered.json.v1-backup')));
});

test('device.self: owner device, guest workspace', T, (t) => {
  const k = kit(t);
  const home = k.tmp();
  const a = k.owner('Pat Person', 'W One');
  const b = k.owner('Pat Person', 'W Two');
  const dev = devRoot(home, 'pat-person');
  put(path.join(dev, 'config.json'), { name: 'pc-one', port: 1 });
  device.registerSession(device.resolve(a, { home, hostname: 'H' }));
  device.registerSession(device.resolve(b, { home, hostname: 'H' }));
  assert.deepStrictEqual(device.self(dev), { person: 'pat-person', device: 'pc-one', sessions: ['w-one', 'w-two'], version: 2 });
  const g = k.wsDir({ ownerName: 'Gus Guest', workspaceName: 'Gw' });
  cfg.saveConfig(g, { name: 'gdev', port: 1 });
  assert.deepStrictEqual(device.self(g), { person: 'gus-guest', device: 'gdev', sessions: ['gw'], version: 2 });
});

// ---- tools surface -------------------------------------------------------------------------------

test('tool list: who exists, connect needs only the address', () => {
  assert.ok(TOOLS.who, 'who tool');
  assert.deepStrictEqual(TOOLS.who[1], []);
  assert.deepStrictEqual(TOOLS.connect[1], ['ip', 'username']);
  assert.deepStrictEqual(TOOLS.connect[2], ['username'], 'username is optional');
  for (const n of ['send', 'send_file']) assert.match(TOOLS[n][0], /person\/device\/session/, n + ' describes the address form');
});

// ---- in-process rig: a receiver device with two sessions, a sender, real listeners ---------------------

async function device_(t, k, { person, sessions, name, home, smallFileMax }) {
  home = home || k.tmp();
  const wss = sessions.map((s) => k.owner(person, s));
  const infos = wss.map((w) => device.resolve(w, { home, hostname: 'H' }));
  const dev = infos[0].deviceRoot;
  cfg.saveConfig(dev, { name, device: name, port: 0, bind: [LOCAL], ...(smallFileMax !== undefined ? { smallFileMax } : {}) });
  infos.forEach((i) => device.registerSession(i));
  const servers = await listener.startListener(dev, { bind: [LOCAL], port: 0 });
  t.after(() => servers.close());
  return { home, dev, wss, sessions: infos.map((i) => i.session), at: LOCAL + ':' + servers.port, servers };
}
async function sender(t, k, person = 'Sam Sender', name = 'sdev') {
  const root = k.wsDir({ ownerName: person, workspaceName: 'S' });
  cfg.saveConfig(root, { name, port: 0, bind: [LOCAL] });
  const servers = await listener.startListener(root, { bind: [LOCAL], port: 0 });
  t.after(() => servers.close());
  return { root, at: LOCAL + ':' + servers.port };
}
async function pair(S, R) {
  const r = await api.connect(S.root, R.at);
  assert.strictEqual(r.ok, true, r.error);
  const p = api.pending(R.dev).pending;
  assert.strictEqual(p.length, 1);
  const a = await api.approve(R.dev, p[0].id);
  assert.strictEqual(a.ok, true, a.error);
  assert.ok(Object.keys(store.readPeers(S.root)).length >= 1, 'the sender stored the accepting device');
}
const bodies = (res) => res.messages.map((m) => m.text);

test('connect without a username pairs under the device name and exchanges person and device', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One', 'R Two'], name: 'rdev' });
  const S = await sender(t, k);
  const r = await api.connect(S.root, R.at);
  assert.strictEqual(r.ok, true, r.error);
  const p = api.pending(R.dev).pending[0];
  assert.strictEqual(p.username, 'sdev');
  assert.strictEqual(p.person, 'sam-sender');
  assert.strictEqual(p.device, 'sdev');
  assert.strictEqual((await api.approve(R.dev, p.id)).ok, true);
  const mine = api.peers(S.root).peers.find((x) => x.name === 'rdev');
  assert.strictEqual(mine.person, 'rita-receiver');
  assert.strictEqual(mine.device, 'rdev');
  assert.strictEqual(mine.address, 'rita-receiver/rdev');
  const theirs = await waitFor(() => api.peers(R.dev).peers.find((x) => x.name === 'sdev'));
  assert.strictEqual(theirs.address, 'sam-sender/sdev');
});

test('routing: person/device/session reaches one workspace, person/device the shared inbox, person fans out', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One', 'R Two'], name: 'rdev' });
  const R2 = await device_(t, k, { person: 'Rita Receiver', sessions: ['R Three'], name: 'rdev2' });
  const S = await sender(t, k);
  await pair(S, R);
  await pair(S, R2);

  let r = await api.send(S.root, 'rita-receiver/rdev/r-two', 'for two');
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(bodies(api.inbox(R.dev, R.wss[1])), ['for two']);
  assert.deepStrictEqual(bodies(api.inbox(R.dev, R.wss[0])), [], 'the other session does not see it');
  assert.ok(!fs.existsSync(path.join(R.dev, 'messages')), 'the shared inbox did not get it');

  r = await api.send(S.root, 'rita-receiver/rdev', 'for the device');
  assert.strictEqual(r.ok, true, r.error);
  const one = api.inbox(R.dev, R.wss[0]);
  const two = api.inbox(R.dev, R.wss[1]);
  assert.deepStrictEqual(bodies(one), ['for the device']);
  assert.deepStrictEqual(bodies(two), ['for the device'], 'readable by every session of the device');
  assert.strictEqual(one.messages[0].shared, true);
  assert.deepStrictEqual(bodies(api.inbox(R.dev, R.wss[0])), [], 'marked read for that session');

  r = await api.send(S.root, 'rita-receiver', 'to every device');
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.results.length, 2);
  assert.deepStrictEqual(bodies(api.inbox(R.dev, R.wss[0])), ['to every device']);
  assert.deepStrictEqual(bodies(api.inbox(R2.dev, R2.wss[0])), ['to every device']);

  r = await api.send(S.root, 'rita-receiver/nodevice', 'x');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /rita-receiver\/rdev/);
  assert.match(r.error, /rita-receiver\/rdev2/);
});

test('routing: the flat v1 name still works, an unknown session or no `to` lands in the shared inbox', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One', 'R Two'], name: 'rdev' });
  const S = await sender(t, k);
  await pair(S, R);
  assert.strictEqual((await api.send(S.root, 'rdev', 'flat name')).ok, true);
  assert.deepStrictEqual(bodies(api.inbox(R.dev, R.wss[0])), ['flat name']);
  // wire level, as a v1 sender writes it: no `to`; and a `to` this device does not know
  for (const [id, text, to] of [[hex(8), 'v1 style', undefined], [hex(8), 'unknown session', 'nope']]) {
    const res = await http.request({ address: LOCAL, port: Number(R.at.split(':')[1]), method: 'POST', path: '/m',
      json: cx.sealRequest(S.root, cx.linkKeys(S.root, store.readPeers(S.root).rdev), { type: 'message', id, text, ...(to ? { to } : {}) }) });
    assert.strictEqual(res.status, 200);
  }
  const got = api.inbox(R.dev, R.wss[1]);
  assert.deepStrictEqual(bodies(got), ['flat name', 'v1 style', 'unknown session']);
  assert.strictEqual(got.messages[2].to, 'nope', 'the `to` stays on the line');
  const lines = fs.readFileSync(path.join(R.dev, 'messages', 'sdev.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  assert.strictEqual(lines.find((l) => l.text === 'unknown session').to, 'nope');
});

test('a pair answer without person or device still pairs', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One'], name: 'rdev' });
  const S = await sender(t, k);
  // a v1 machine answers /pair without person or device
  const strip = require('http').createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const up = require('http').request({ hostname: LOCAL, port: Number(R.at.split(':')[1]), method: req.method, path: req.url, headers: { ...req.headers, connection: 'close' }, agent: false }, (ur) => {
        const out = []; ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          let data = Buffer.concat(out);
          if (req.url === '/pair') { const j = JSON.parse(data.toString()); delete j.person; delete j.device; data = Buffer.from(JSON.stringify(j)); }
          res.writeHead(ur.statusCode, { 'content-type': 'application/json', 'content-length': data.length }); res.end(data);
        });
      });
      up.end(Buffer.concat(chunks));
    });
  });
  await new Promise((r) => strip.listen(0, LOCAL, r));
  t.after(() => new Promise((r) => { strip.close(r); strip.closeAllConnections(); }));
  const r = await api.connect(S.root, LOCAL + ':' + strip.address().port, 'sdev');
  assert.strictEqual(r.ok, true, r.error);
  const p = api.pending(R.dev).pending[0];
  assert.strictEqual((await api.approve(R.dev, p.id)).ok, true);
  const mine = await waitFor(() => store.readPeers(S.root).rdev);
  assert.ok(mine.keyid);
  assert.strictEqual(api.peers(S.root).peers.length, 1);
});

test('who fills person, device and sessions; an unreachable peer keeps what is stored; a v1 peer stays flat', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One', 'R Two'], name: 'rdev' });
  const S = await sender(t, k);
  await pair(S, R);
  store.updatePeers(S.root, (p) => { delete p.rdev.person; delete p.rdev.device; delete p.rdev.sessions; });
  const w = await api.who(S.root);
  assert.strictEqual(w.ok, true, w.error);
  const row = w.peers.find((x) => x.name === 'rdev');
  assert.deepStrictEqual([row.person, row.device, row.sessions, row.reachable], ['rita-receiver', 'rdev', ['r-one', 'r-two'], true]);
  const rec = store.readPeers(S.root).rdev;
  assert.deepStrictEqual([rec.person, rec.device, rec.sessions], ['rita-receiver', 'rdev', ['r-one', 'r-two']]);

  await R.servers.close();
  store.updatePeers(S.root, (p) => { p.rdev.addresses = [LOCAL]; }); // a closed loopback port is slow to refuse on Windows, one address is enough
  const down = await api.who(S.root);
  const d = down.peers.find((x) => x.name === 'rdev');
  assert.strictEqual(d.reachable, false);
  assert.strictEqual(d.address, 'rita-receiver/rdev');
  assert.deepStrictEqual(d.sessions, ['r-one', 'r-two']);

  // a v1 device answers 400 unknown type to a type it does not know
  const v1 = require('http').createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"unknown type"}'); }); });
  await new Promise((r) => v1.listen(0, LOCAL, r));
  t.after(() => new Promise((r) => { v1.close(r); v1.closeAllConnections(); }));
  store.updatePeers(S.root, (p) => { p.oldbox = { ...p.rdev, person: undefined, device: undefined, sessions: undefined, keyid: 'abcd1234abcd1234', addresses: [LOCAL], port: v1.address().port }; });
  const again = await api.who(S.root);
  const o = again.peers.find((x) => x.name === 'oldbox');
  assert.strictEqual(o.version, 1);
  assert.strictEqual(o.address, 'oldbox');
  assert.strictEqual(o.person, undefined);
});

test('files: `to` puts the file in that workspace, no `to` in the device folder; an offer keeps its `to`', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One', 'R Two'], name: 'rdev', smallFileMax: 20 });
  const S = await sender(t, k);
  cfg.saveConfig(S.root, { ...cfg.loadConfig(S.root), smallFileMax: 20 });
  await pair(S, R);
  const dir = k.tmp();
  const small = path.join(dir, 'small.txt'); fs.writeFileSync(small, 'tiny');
  const big = path.join(dir, 'big.bin'); fs.writeFileSync(big, 'x'.repeat(100));
  let r = await files.sendFile(S.root, 'rita-receiver/rdev/r-two', small);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(fs.readFileSync(path.join(R.wss[1], '.joserah', 'connect', 'files', 'sdev', 'small.txt'), 'utf8'), 'tiny');
  r = await files.sendFile(S.root, 'rita-receiver/rdev', small);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(fs.readFileSync(path.join(R.dev, 'files', 'sdev', 'small.txt'), 'utf8'), 'tiny');
  const own = files.files(R.dev, R.wss[1]);
  assert.deepStrictEqual(own.received.map((x) => [x.name, !!x.shared]).sort(), [['small.txt', false], ['small.txt', true]]);
  assert.strictEqual(files.files(R.dev, R.wss[0]).received.length, 1, 'the other session sees only the shared one');
  r = await files.sendFile(S.root, 'rita-receiver/rdev/r-two', big);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(files.files(R.dev, R.wss[1]).offers.length, 1);
  assert.strictEqual(files.files(R.dev, R.wss[0]).offers.length, 0, 'an offer for one session is not listed for the other');
  const offer = files.files(R.dev, R.wss[1]).offers[0];
  const a = await files.acceptFile(R.dev, offer.id);
  assert.strictEqual(a.ok, true, a.error);
  assert.ok(fs.existsSync(path.join(R.wss[1], '.joserah', 'connect', 'files', 'sdev', 'big.bin')));
});

test('unreadSummary counts the session, the shared inbox and offers for that workspace', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One', 'R Two'], name: 'rdev' });
  const S = await sender(t, k);
  await pair(S, R);
  await api.send(S.root, 'rita-receiver/rdev/r-one', 'a');
  await api.send(S.root, 'rita-receiver/rdev', 'b');
  const s1 = api.unreadSummary(R.dev, R.wss[0]);
  const s2 = api.unreadSummary(R.dev, R.wss[1]);
  assert.strictEqual(s1.messages.sdev, 2);
  assert.strictEqual(s2.messages.sdev, 1);
  api.inbox(R.dev, R.wss[0]);
  assert.strictEqual(api.unreadSummary(R.dev, R.wss[0]).total, 0);
  assert.strictEqual(api.unreadSummary(R.dev, R.wss[1]).total, 1);
});

test('send to a name nobody knows lists the known addresses', T, async (t) => {
  const k = kit(t);
  const R = await device_(t, k, { person: 'Rita Receiver', sessions: ['R One'], name: 'rdev' });
  const S = await sender(t, k);
  await pair(S, R);
  const r = await api.send(S.root, 'nobody', 'x');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /rita-receiver\/rdev/);
  assert.strictEqual((await api.send(S.root, '../x', 'x')).ok, false);
});

// ---- startup wiring through the real mcp.js ----------------------------------------------------------

test('owner workspace: automatic setup creates the device folder under the home and registers the session', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const ws = k.owner('Pat Person', 'W One');
  const m = await k.mcp(ws, { home });
  const r = await m.call('peers');
  assert.strictEqual(r.ok, true);
  const dev = devRoot(home, 'pat-person');
  const c = JSON.parse(fs.readFileSync(path.join(dev, 'config.json'), 'utf8'));
  assert.ok(c.name && c.port > 0, 'device name and the real port are saved');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dev, 'sessions.json'), 'utf8'))['w-one'].root, ws);
  assert.ok(fs.existsSync(path.join(dev, 'keys', 'connect.json')), 'the key sits in the device folder');
  assert.ok(!fs.existsSync(path.join(ws, 'keys')), 'not in the workspace');
  assert.ok(!fs.existsSync(path.join(ws, '.joserah', 'connect', 'config.json')));
  assert.strictEqual(await idAt(c.port), keyOf(dev) && cx.keyid(keyOf(dev).public), 'the listener answers /id with the device key id');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dev, 'listener.json'), 'utf8')).pid, m.child.pid);
});

test('two workspaces of one person share one identity and one listener; the second takes over when the first exits', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const a = k.owner('Pat Person', 'W One');
  const b = k.owner('Pat Person', 'W Two');
  const m1 = await k.mcp(a, { home });
  await m1.call('peers');
  const m2 = await k.mcp(b, { home });
  await m2.call('peers');
  const dev = devRoot(home, 'pat-person');
  const port = JSON.parse(fs.readFileSync(path.join(dev, 'config.json'), 'utf8')).port;
  const keyid = cx.keyid(keyOf(dev).public);
  assert.strictEqual(await idAt(port), keyid);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dev, 'sessions.json'), 'utf8'))).sort(), ['w-one', 'w-two']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dev, 'listener.json'), 'utf8')).pid, m1.child.pid, 'the first holds the port');
  assert.ok(!/another port|because/.test(m2.stderr()), 'waiting for our own listener is not a conflict');
  await m1.stop();
  await waitFor(async () => (JSON.parse(fs.readFileSync(path.join(dev, 'listener.json'), 'utf8')).pid === m2.child.pid));
  assert.strictEqual(await idAt(port), keyid);
  assert.match(m2.stderr(), /took over/);
});

test('a guest workspace never touches the home and takes its own port when the owner holds it', T, async (t) => {
  const k = kit(t);
  const ownerHome = k.tmp();
  const guestHome = k.tmp();
  put(path.join(guestHome, 'decoy.txt'), 'x');
  const before = listing(guestHome);
  const n = await freePort();
  const mo = await k.mcp(k.owner('Pat Person', 'W One'), { home: ownerHome, port: n });
  await mo.call('peers');
  assert.strictEqual(await idAt(n), cx.keyid(keyOf(devRoot(ownerHome, 'pat-person')).public));
  const gws = k.wsDir({ ownerName: 'Gus Guest', workspaceName: 'Gw', trust: 'guest' });
  const mg = await k.mcp(gws, { home: guestHome, port: n });
  const r = await mg.call('peers');
  assert.strictEqual(r.ok, true);
  assert.match(r.note, /listening on port \d+ because \d+ is used by someone else on this machine/);
  assert.match(mg.stderr(), /\[connect\].*port/);
  const gc = JSON.parse(fs.readFileSync(path.join(gws, '.joserah', 'connect', 'config.json'), 'utf8'));
  assert.notStrictEqual(gc.port, n);
  const gid = cx.keyid(JSON.parse(fs.readFileSync(path.join(gws, 'keys', 'connect.json'), 'utf8')).identity.public);
  assert.strictEqual(await idAt(gc.port), gid);
  assert.strictEqual(await idAt(n), cx.keyid(keyOf(devRoot(ownerHome, 'pat-person')).public), 'the owner is undisturbed');
  assert.deepStrictEqual(listing(guestHome), before, 'the home was not touched');
  const second = await mg.call('peers');
  assert.strictEqual(second.note, undefined, 'the note comes once');
});

test('two persons on one machine: the second gets another port and the note', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const n = await freePort();
  const ma = await k.mcp(k.owner('Pat Person', 'W One'), { home, port: n });
  await ma.call('peers');
  const mb = await k.mcp(k.owner('Quinn Other', 'Q One'), { home, port: n });
  const r = await mb.call('peers');
  assert.match(r.note, /listening on port \d+ because \d+ is used by someone else on this machine/);
  const cb = JSON.parse(fs.readFileSync(path.join(devRoot(home, 'quinn-other'), 'config.json'), 'utf8'));
  assert.notStrictEqual(cb.port, n);
  assert.strictEqual(await idAt(cb.port), cx.keyid(keyOf(devRoot(home, 'quinn-other')).public));
  assert.strictEqual(await idAt(n), cx.keyid(keyOf(devRoot(home, 'pat-person')).public));
  assert.notStrictEqual(cx.keyid(keyOf(devRoot(home, 'quinn-other')).public), cx.keyid(keyOf(devRoot(home, 'pat-person')).public));
});

test('v1 migration through startup keeps identity, the flat name, the backups and the old messages', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const ws = k.owner('Pat Person', 'W One');
  const id = cx.identity(ws); // v1 key in <ws>/keys
  const deadPort = await freePort();
  const peerPub = crypto.generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x;
  cfg.saveConfig(ws, { name: 'oldname', port: 0 });
  store.setPeer(ws, 'oldpeer', { pub: peerPub, keyid: cx.keyid(peerPub), salt: hex(32), addresses: [LOCAL], port: deadPort });
  store.appendMessage(ws, 'oldpeer', { dir: 'in', text: 'old hello' });
  const m = await k.mcp(ws, { home });
  const dev = devRoot(home, 'pat-person');
  const peers = await m.call('peers');
  assert.strictEqual(peers.ok, true);
  assert.strictEqual(cx.keyid(keyOf(dev).public), id.keyid, 'same identity');
  assert.ok(fs.existsSync(path.join(ws, 'keys', 'connect.json.v1-backup')));
  assert.ok(fs.existsSync(path.join(ws, '.joserah', 'connect', 'peers.json.v1-backup')));
  assert.ok(!fs.existsSync(path.join(ws, 'keys', 'connect.json')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dev, 'config.json'), 'utf8')).name, 'oldname');
  assert.strictEqual(peers.peers.find((p) => p.name === 'oldpeer').address, 'oldpeer');
  const sent = await m.call('send', { peer: 'oldpeer', message: 'still works' });
  assert.strictEqual(sent.ok, true, sent.error);
  assert.strictEqual(sent.queued, true, 'the peer is unreachable, so it waits');
  const inbox = await m.call('inbox');
  assert.deepStrictEqual(inbox.messages.map((x) => x.text), ['old hello']);
});

test('a tool call does not hang on a dead peer', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const ws = k.owner('Pat Person', 'W One');
  const m = await k.mcp(ws, { home });
  const dev = devRoot(home, 'pat-person');
  const deadPort = await freePort();
  const peerPub = crypto.generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x;
  store.setPeer(dev, 'ghost', { pub: peerPub, keyid: cx.keyid(peerPub), salt: hex(32), addresses: ['10.255.255.1', LOCAL], port: deadPort });
  const t0 = Date.now();
  const r = await m.call('inbox');
  assert.strictEqual(r.ok, true);
  assert.ok(Date.now() - t0 < 5000, 'answered in ' + (Date.now() - t0) + ' ms');
});

test('connect.js status shows mode, own address, port, listener, peers and the firewall state; never a key', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const ws = k.owner('Pat Person', 'W One');
  const m = await k.mcp(ws, { home });
  await m.call('peers');
  const dev = devRoot(home, 'pat-person');
  put(path.join(dev, 'firewall.json'), { at: new Date().toISOString(), state: 'open' });
  const env = { CLAUDE_PROJECT_DIR: ws, JOSERAH_CONNECT_HOME: home };
  const r = runTool('connect.js', ['status'], { cwd: ws, env, timeout: 20000 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /mode: owner/);
  const name = JSON.parse(fs.readFileSync(path.join(dev, 'config.json'), 'utf8')).name;
  assert.ok(r.stdout.includes(`address: pat-person/${name}/w-one`), r.stdout);
  assert.match(r.stdout, new RegExp('listener: running \\(pid ' + m.child.pid + '\\)'));
  assert.match(r.stdout, /outbox: 0/);
  assert.match(r.stdout, /firewall: open/);
  const priv = keyOf(dev).private;
  assert.ok(!(r.stdout + r.stderr).includes(priv));
  const ov = runTool('connect.js', ['setup', '--name', 'newname', '--port', '5999'], { cwd: ws, env, timeout: 20000 });
  assert.strictEqual(ov.status, 0, ov.stderr);
  const c = JSON.parse(fs.readFileSync(path.join(dev, 'config.json'), 'utf8'));
  assert.strictEqual(c.name, 'newname');
  assert.strictEqual(c.port, 5999);
  assert.ok(!fs.existsSync(path.join(ws, '.joserah', 'connect', 'config.json')), 'owner setup writes to the device folder');
  assert.strictEqual(device.resolve(ws, { home }).device, 'newname');
});

test('no tool result, log or status carries a private key', T, async (t) => {
  const k = kit(t);
  const home = k.tmp();
  const n = await freePort();
  const m = await k.mcp(k.owner('Pat Person', 'W One'), { home, port: n });
  const gws = k.wsDir({ ownerName: 'Gus Guest', workspaceName: 'Gw' });
  const m2 = await k.mcp(gws, { home: k.tmp(), port: n });
  for (const x of [m, m2]) for (const name of ['peers', 'who', 'pending', 'inbox', 'files']) await x.call(name);
  const privs = [keyOf(devRoot(home, 'pat-person')).private, JSON.parse(fs.readFileSync(path.join(gws, 'keys', 'connect.json'), 'utf8')).identity.private];
  for (const x of [m, m2]) for (const priv of privs) assert.ok(!(x.all.join(' ') + x.stderr()).includes(priv));
});

test('starting with an empty config sets the workspace up on its own (guest layout) and no port 4790 is used', T, async (t) => {
  const k = kit(t);
  const ws = k.wsDir({});
  const m = await k.mcp(ws, { home: k.tmp() });
  const r = await m.call('peers');
  assert.strictEqual(r.ok, true);
  const c = JSON.parse(fs.readFileSync(path.join(ws, '.joserah', 'connect', 'config.json'), 'utf8'));
  assert.ok(c.name);
  assert.notStrictEqual(c.port, 4790);
});

// ---- hook -----------------------------------------------------------------------------------------------

function runHook(cwd, home) {
  return spawnSync(process.execPath, [HOOK], { cwd, input: '{}', encoding: 'utf8', timeout: 20000, env: { ...process.env, JOSERAH_CONNECT_HOME: home } });
}
const lines = (arr) => arr.map((o) => JSON.stringify(o)).join('\n') + '\n';
const inMsg = (id, text) => ({ id, dir: 'in', text, at: new Date().toISOString() });

test('hook: delivers the session and the device inbox, offers by name, counts pairing requests', T, (t) => {
  const k = kit(t);
  const home = k.tmp();
  const ws = k.owner('Pat Person', 'W One');
  const dev = devRoot(home, 'pat-person');
  put(path.join(ws, '.joserah', 'connect', 'messages', 'peerone.jsonl'), lines([inMsg('1', MARKER), inMsg('2', MARKER)]));
  put(path.join(dev, 'messages', 'peerone.jsonl'), lines([inMsg('3', MARKER), inMsg('4', MARKER), inMsg('5', MARKER)]));
  put(path.join(ws, '.joserah', 'connect', 'read.json'), { 'shared:peerone': 1 });
  put(path.join(dev, 'offers.json'), [{ id: 'o1', peer: 'peerone', name: 'a.bin', size: 5, sha256: 'x', created: new Date().toISOString() }]);
  put(path.join(dev, 'pending.json'), [{ id: 'p1', username: 'zed', keyid: 'k', code: '123456', created: new Date().toISOString() }]);
  const r = runHook(ws, home);
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  const head = ctx.split('\n')[0];
  assert.ok(head.startsWith('[connect] '));
  assert.match(head, /4 new messages from peerone/, '2 of the session + 2 shared not yet read');
  assert.match(head, /1 file offer from peerone/);
  assert.match(head, /1 pairing request/);
  assert.strictEqual((ctx.match(new RegExp(MARKER, 'g')) || []).length, 4);
  assert.ok(ctx.includes('a.bin'));
  assert.ok(!ctx.includes('zed'), 'a pairing request is only counted');
  assert.ok(runHook(ws, home).stdout.startsWith('[connect] 1 pairing request waiting'),'the second turn: only the pairing request is left');
});

test('hook: a guest workspace never reads the home', T, (t) => {
  const k = kit(t);
  const home = k.tmp();
  const ws = k.wsDir({ ownerName: 'Pat Person', workspaceName: 'W One', trust: 'guest' });
  put(path.join(devRoot(home, 'pat-person'), 'messages', 'peerone.jsonl'), lines([inMsg('1', MARKER)]));
  put(path.join(ws, '.joserah', 'connect', 'messages', 'peertwo.jsonl'), lines([inMsg('2', MARKER)]));
  const out = runHook(ws, home).stdout;
  assert.match(out, /1 new message from peertwo/);
  assert.ok(!/peerone/.test(out));
});

test('hook: silent when nothing is waiting; the source starts nothing', T, (t) => {
  const k = kit(t);
  const home = k.tmp();
  const ws = k.owner('Pat Person', 'W One');
  assert.strictEqual(runHook(ws, home).stdout, '');
  put(path.join(devRoot(home, 'pat-person'), 'config.json'), { name: 'x' });
  assert.strictEqual(runHook(ws, home).stdout, '');
  assert.doesNotMatch(fs.readFileSync(HOOK, 'utf8'), /child_process|spawn|exec/);
});

// ---- firewall: asked once a week, the note only when the person has to act --------------------------------

test('firewall.once: runs ensure, remembers it for 7 days, notes only a .bat', T, async (t) => {
  const k = kit(t);
  const dev = devRoot(k.tmp(), 'pat-person');
  const asked = [];
  const bat = async (dir, port) => { asked.push([dir, port]); return { state: 'bat', bat: 'x.bat', say: 'run the bat' }; };
  const open = async () => ({ state: 'open' });
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const r1 = await firewall.once(dev, '/some/dir', 4790, { ensure: bat, now: () => t0 });
  assert.deepStrictEqual([r1.state, r1.note], ['bat', 'run the bat']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dev, 'firewall.json'), 'utf8')).state, 'bat');
  assert.strictEqual(await firewall.once(dev, '/some/dir', 4790, { ensure: bat, now: () => t0 + 6 * 86400000 }), null, 'not within 7 days');
  assert.strictEqual(asked.length, 1);
  const r3 = await firewall.once(dev, '/some/dir', 4790, { ensure: open, now: () => t0 + 8 * 86400000 });
  assert.deepStrictEqual([r3.state, r3.note], ['open', undefined]);
  assert.strictEqual(await firewall.once(dev, '/some/dir', 4790, { ensure: bat, now: () => t0 + 9 * 86400000, off: true }), null, 'off');
});

// ---- start-up races: several sessions of one person start at the same moment -------------------------------

test('the identity is made once when several processes ask for it at the same moment', T, async (t) => {
  const k = kit(t);
  const dev = devRoot(k.tmp(), 'pat-person');
  const go = Date.now() + 1500; // every process waits for the same moment, then asks
  const ids = await Promise.all([1, 2, 3, 4, 5, 6].map(() => new Promise((resolve, reject) => {
    const code = `while (Date.now() < ${go}); console.log(require(${JSON.stringify(path.join(C, 'crypto.js'))}).identity(${JSON.stringify(dev)}).keyid)`;
    const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    c.on('exit', (st) => (st === 0 ? resolve(out.trim()) : reject(new Error('identity process failed: ' + st))));
  })));
  assert.strictEqual(new Set(ids).size, 1, 'one key id for everybody: ' + ids.join(' '));
  assert.strictEqual(cx.keyid(keyOf(dev).public), ids[0]);
});

// ---- port choice against an old (v1) Connect listener --------------------------------------------------------

// A server on the same address family the listener uses, answering `answer(res)` to everything.
async function stubHolder(t, answer) {
  const srv = require('http').createServer((req, res) => { req.resume(); answer(res); });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen({ port: 0, host: '::', ipv6Only: false }, resolve); });
  t.after(() => new Promise((r) => { srv.close(r); srv.closeAllConnections(); }));
  return srv.address().port;
}
// exactly what v1's listener sends for a route it does not know: dispatch() -> send(res, 404, { error: 'not found' })
const v1Answer = (res) => {
  const body = Buffer.from(JSON.stringify({ error: 'not found' }));
  res.writeHead(404, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
};

test('probe: an old v1 listener (404 {error:"not found"} for /id) is told apart from a foreign service', T, async (t) => {
  const startup = require(path.join(C, 'startup.js'));
  const v1 = await stubHolder(t, v1Answer);
  const html = await stubHolder(t, (res) => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>Not Found</h1>'); });
  const otherJson = await stubHolder(t, (res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"nope"}'); });
  assert.strictEqual(await startup.probe(v1), 'v1');
  assert.strictEqual(await startup.probe(html), 'other');
  assert.strictEqual(await startup.probe(otherJson), 'other');
  assert.strictEqual(await startup.probe(await freePort()), null);
});

test('a v2 session does not move off a port an old v1 session holds: it waits to take over', T, async (t) => {
  const k = kit(t);
  const startup = require(path.join(C, 'startup.js'));
  const port = await stubHolder(t, v1Answer);
  const dev = devRoot(k.tmp(), 'pat-person');
  cfg.saveConfig(dev, { name: 'x', port, bind: undefined });
  const moved = [];
  const start = startup.chooser(dev, cx.identity(dev).keyid, (from, to) => moved.push([from, to]));
  await assert.rejects(start(dev, { port }), (e) => e.code === 'EADDRINUSE');
  assert.deepStrictEqual(moved, [], 'it stayed');
  assert.strictEqual(cfg.loadConfig(dev).port, port, 'the saved port was not changed');
  // a foreign service does make it move
  const html = await stubHolder(t, (res) => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('x'); });
  const s = await start(dev, { port: html });
  t.after(() => s.close());
  assert.strictEqual(moved.length, 1);
  assert.notStrictEqual(s.port, html);
});

// ---- read tools collect what waits for this machine at once -----------------------------------------------------

test('inbox and files collect on the very call, right after another tool call, with a dead peer in the list', T, async (t) => {
  const k = kit(t);
  const A = await device_(t, k, { person: 'Alpha Person', sessions: ['A One'], name: 'dev-a', smallFileMax: 50 });
  const homeB = k.tmp();
  const b = await k.mcp(k.owner('Beta Person', 'B One'), { home: homeB });
  const devB = devRoot(homeB, 'beta-person');
  cfg.saveConfig(devB, { ...cfg.loadConfig(devB), smallFileMax: 50 });
  const c = await b.call('connect', { ip: A.at });
  assert.strictEqual(c.ok, true, c.error);
  const ap = await api.approve(A.dev, api.pending(A.dev).pending[0].id);
  assert.strictEqual(ap.ok, true, ap.error);
  const aName = await waitFor(async () => Object.keys(store.readPeers(devB))[0]);
  // A cannot reach B (closed inbound); B's list also holds a dead peer, first in line
  const closed = await freePort();
  store.updatePeers(A.dev, (p) => { for (const r of Object.values(p)) { r.addresses = [LOCAL]; r.port = closed; } });
  store.updatePeers(devB, (p) => ({ ghost: { ...p[aName], keyid: 'abcd1234abcd1234', addresses: ['10.255.255.1', LOCAL], port: closed }, ...p }));
  const bAddress = api.peers(A.dev).peers[0].address;
  await b.call('pending'); // another tool call a moment ago: the 10 s throttle is now running
  const big = path.join(k.tmp(), 'big.bin'); fs.writeFileSync(big, crypto.randomBytes(300));
  const text = 'queued ' + hex(4);
  const s = await api.send(A.dev, bAddress, text);
  assert.strictEqual(s.queued, true, 'A queued it: ' + JSON.stringify(s));
  const f = await files.sendFile(A.dev, bAddress, big);
  assert.strictEqual(f.queued, true, 'A queued the offer: ' + JSON.stringify(f));
  const t0 = Date.now();
  const got = await b.call('inbox');
  const took = Date.now() - t0;
  assert.ok(got.messages.some((m) => m.text === text), 'the message is in inbox() on that very call: ' + JSON.stringify(got.messages.map((m) => m.text)));
  assert.ok(took < 4500, 'a dead peer holds a read tool call at most for its bound: ' + took + ' ms');
  const fl = await b.call('files');
  assert.ok(fl.offers.some((o) => o.name === 'big.bin'), 'the offer is in files() on that very call');
});
