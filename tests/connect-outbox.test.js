'use strict';
// Joserah Connect v2, W3: delivery without an open inbound port. B has NO listener (closed inbound); A has one.
// A queues, B collects over its own outbound connection. Loopback only, temp roots, port 0.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const nodeHttp = require('http');
const path = require('path');
const crypto = require('crypto');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');

const C = path.join(PLUGIN_ROOT, 'tools', 'connect');
const cfg = require(path.join(C, 'config.js'));
const store = require(path.join(C, 'store.js'));
const http = require(path.join(C, 'http.js'));
const listener = require(path.join(C, 'listener.js'));
const api = require(path.join(C, 'api.js'));
const files = require(path.join(C, 'files.js'));
const outbox = require(path.join(C, 'outbox.js'));

// no LAN addresses in a pair request: an address that is filtered (not refused) would cost a 3 s connect timeout each
require('os').networkInterfaces = () => ({});

const T = { timeout: 40000 };
const LOCAL = '127.0.0.1';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const outboxFile = (root) => path.join(store.connectDir(root), 'outbox.json');
const queued = (root, peer) => (store.readJson(outboxFile(root), {})[peer] || []);
const state = () => ({ pairHits: new Map(), now: Date.now });
const dirOf = (root, peer) => path.join(store.connectDir(root), 'files', peer);
const setSmallMax = (root, n) => cfg.saveConfig(root, { ...cfg.loadConfig(root), smallFileMax: n });
const tmpFile = (t, name, content) => { const p = path.join(tmpdir(t), name); fs.writeFileSync(p, content); return p; };
const inboxTexts = (root) => api.inbox(root).messages.filter((m) => m.kind === 'message').map((m) => m.text);
const logIds = (root, peer) => store.readMessages(root, peer).filter((m) => m.dir === 'in' && m.kind === 'message').map((m) => m.id);

function closedPort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, LOCAL, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

// listen:false = a machine whose inbound port is closed (it only ever calls out).
async function instance(t, name, { listen = true } = {}) {
  const root = tmpdir(t);
  if (!listen) {
    cfg.saveConfig(root, { name, port: await closedPort(), bind: [LOCAL] });
    return { root };
  }
  cfg.saveConfig(root, { name, port: 0, bind: [LOCAL] });
  const servers = await listener.startListener(root, { bind: [LOCAL], port: 0 });
  t.after(() => servers.close());
  return { root, port: servers.port, at: LOCAL + ':' + servers.port };
}

// B (closed inbound, known to A as "bob") asks A ("alice"); A approves; the accept waits in A's outbox.
async function pairedClosed(t) {
  const A = await instance(t, 'alice');
  const B = await instance(t, 'bob', { listen: false });
  const r = await api.connect(B.root, A.at, 'bob');
  assert.strictEqual(r.ok, true, r.error);
  const ap = await api.approve(A.root, r.id);
  assert.strictEqual(ap.ok, true, ap.error);
  assert.strictEqual(ap.queued, true);
  assert.strictEqual(queued(A.root, 'bob').length, 1);
  assert.deepStrictEqual(store.readPeers(B.root), {});
  const f = await outbox.fetchAll(B.root);
  assert.strictEqual(f.ok, true);
  assert.ok(store.readPeers(B.root).alice, 'B has A as a peer after one fetch');
  assert.deepStrictEqual(queued(A.root, 'bob'), []);
  store.setPeer(A.root, 'bob', { ...store.readPeers(A.root).bob, addresses: [LOCAL] }); // skip the unreachable LAN addresses
  return { A, B };
}

// A tiny forwarder in front of A that can rewrite A's answer: for tampering and for pretending to be a v1 server.
function middle(t, port, rewrite) {
  const seen = [];
  const srv = nodeHttp.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rb = Buffer.concat(chunks);
      seen.push(req.url);
      const up = nodeHttp.request({ hostname: LOCAL, port, method: req.method, path: req.url, headers: { ...req.headers, connection: 'close' }, agent: false }, (ur) => {
        const out = [];
        ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          const data = rewrite(rb, Buffer.concat(out), ur.statusCode);
          res.writeHead(ur.statusCode, { 'content-type': 'application/json', 'content-length': data.length });
          res.end(data);
        });
      });
      up.end(rb);
    });
  });
  return new Promise((resolve) => srv.listen(0, LOCAL, () => {
    t.after(() => new Promise((r) => { srv.close(r); srv.closeAllConnections(); }));
    resolve({ port: srv.address().port, seen });
  }));
}
const repoint = (root, peer, port) => store.setPeer(root, peer, { ...store.readPeers(root)[peer], addresses: [LOCAL], port });

test('outbox.js: no child_process', () => {
  assert.ok(!/child_process/.test(fs.readFileSync(path.join(C, 'outbox.js'), 'utf8')));
});

test('pairing to a requester with a closed inbound port completes by its own fetch', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  assert.strictEqual(store.readPeers(B.root).alice.keyid, require(path.join(C, 'crypto.js')).identity(A.root).keyid);
  assert.deepStrictEqual(store.readList(B.root, 'outgoing'), []);
  // and it works as a normal pair afterwards: B can send to A directly
  const s = await api.send(B.root, 'alice', 'hello from the closed side');
  assert.strictEqual(s.ok, true, s.error);
  assert.notStrictEqual(s.queued, true);
  assert.deepStrictEqual(inboxTexts(A.root), ['hello from the closed side']);
});

test('a send to an unreachable peer is queued, collected by its fetch, acked; a second fetch brings nothing', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  const s = await api.send(A.root, 'bob', 'while you were away');
  assert.strictEqual(s.ok, true, s.error);
  assert.strictEqual(s.queued, true);
  assert.ok(/collect/.test(s.note), s.note);
  assert.strictEqual(queued(A.root, 'bob').length, 1);
  assert.deepStrictEqual(inboxTexts(B.root), []);
  const f = await outbox.fetchAll(B.root);
  assert.strictEqual(f.ok, true);
  assert.deepStrictEqual(inboxTexts(B.root), ['while you were away']);
  assert.deepStrictEqual(queued(A.root, 'bob'), []);
  await outbox.fetchAll(B.root);
  assert.deepStrictEqual(inboxTexts(B.root), []);
  assert.strictEqual(logIds(B.root, 'alice').length, 1);
  // a reply from B to that message goes out directly
  const id = logIds(B.root, 'alice')[0];
  assert.strictEqual((await api.reply(B.root, id, 'got it')).ok, true);
  assert.deepStrictEqual(inboxTexts(A.root), ['got it']);
});

test('a lost ack: the item comes again and is dropped as a duplicate', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  await api.send(A.root, 'bob', 'once only');
  const snapshot = fs.readFileSync(outboxFile(A.root), 'utf8');
  await outbox.fetchAll(B.root);
  assert.deepStrictEqual(queued(A.root, 'bob'), []);
  fs.writeFileSync(outboxFile(A.root), snapshot); // as if the ack never arrived
  assert.strictEqual(queued(A.root, 'bob').length, 1);
  const f = await outbox.fetchAll(B.root);
  assert.strictEqual(f.ok, true);
  assert.strictEqual(logIds(B.root, 'alice').length, 1);
  assert.deepStrictEqual(queued(A.root, 'bob'), []);
  assert.strictEqual(store.readMessages(B.root, 'alice').filter((m) => m.id === logIds(B.root, 'alice')[0]).length, 1);
});

test('a captured fetched envelope replayed is rejected; a tampered one is rejected and not acked', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  await api.send(A.root, 'bob', 'replay me');
  const got = await http.sendToPeer(B.root, 'alice', { type: 'fetch' });
  assert.strictEqual(got.status, 200);
  const [env] = got.json.items;
  assert.strictEqual((await listener.handleSealed(B.root, state(), env, null)).status, 200);
  assert.deepStrictEqual(inboxTexts(B.root), ['replay me']);
  assert.strictEqual((await listener.handleSealed(B.root, state(), env, null)).status, 401);
  assert.deepStrictEqual(inboxTexts(B.root), []);

  // tampered in transit: nothing is stored, nothing is acked, the item stays queued
  const bad = await middle(t, A.port, (rq, rs) => {
    let j; try { j = JSON.parse(rs.toString()); } catch { return rs; }
    if (j.items) j.items = j.items.map((e) => ({ ...e, ct: (e.ct[0] === 'A' ? 'B' : 'A') + e.ct.slice(1) }));
    return Buffer.from(JSON.stringify(j));
  });
  repoint(B.root, 'alice', bad.port);
  const f = await outbox.fetchAll(B.root);
  assert.strictEqual(f.ok, true);
  assert.deepStrictEqual(inboxTexts(B.root), []);
  assert.strictEqual(queued(A.root, 'bob').length, 1);
});

test('more than one answer holds: 60 queued messages all arrive, in order', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  for (let i = 0; i < 60; i++) assert.strictEqual((await api.send(A.root, 'bob', 'm' + i)).queued, true);
  await outbox.fetchAll(B.root);
  assert.deepStrictEqual(inboxTexts(B.root), Array.from({ length: 60 }, (_, i) => 'm' + i));
  assert.deepStrictEqual(queued(A.root, 'bob'), []);
});

test('queue limits: 500 per peer, items older than 7 days dropped', T, async (t) => {
  const { A } = await pairedClosed(t);
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  store.writeJson(outboxFile(A.root), { bob: [{ oid: 'a'.repeat(16), obj: { type: 'message' }, created: old }] });
  for (let i = 0; i < 502; i++) outbox.queue(A.root, 'bob', { type: 'message', id: 'b'.repeat(16), text: 'x' });
  const list = queued(A.root, 'bob');
  assert.strictEqual(list.length, 500);
  assert.ok(!list.some((x) => x.oid === 'a'.repeat(16)));
});

test('a small file for an unreachable peer is queued and pulled by the receiver on fetch', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  const data = crypto.randomBytes(120 * 1024);
  const r = await files.sendFile(A.root, 'bob', tmpFile(t, 'later.bin', data));
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.queued, true);
  assert.strictEqual(store.readList(A.root, 'sending').length, 1);
  assert.strictEqual(queued(A.root, 'bob').length, 1);
  await outbox.fetchAll(B.root);
  assert.strictEqual(sha(fs.readFileSync(path.join(dirOf(B.root, 'alice'), 'later.bin'))), sha(data));
  assert.deepStrictEqual(store.readList(B.root, 'offers'), []);
  assert.deepStrictEqual(store.readList(A.root, 'sending'), []);
  assert.deepStrictEqual(queued(A.root, 'bob'), []);
});

test('a large file for an unreachable peer stays an offer until accept_file', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  setSmallMax(B.root, 10); // the receiver decides what is small
  const data = crypto.randomBytes(100 * 1024);
  const r = await files.sendFile(A.root, 'bob', tmpFile(t, 'big.bin', data));
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.queued, true);
  await outbox.fetchAll(B.root);
  const [o] = files.files(B.root).offers;
  assert.ok(o && o.name === 'big.bin');
  assert.ok(!fs.existsSync(path.join(dirOf(B.root, 'alice'), 'big.bin')), 'nothing pulled yet');
  const got = await files.acceptFile(B.root, o.id);
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(sha(fs.readFileSync(path.join(dirOf(B.root, 'alice'), 'big.bin'))), sha(data));
  assert.deepStrictEqual(store.readList(A.root, 'sending'), []);
});

test('a peer that answers "unknown type" (an old version) is skipped quietly', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  await api.send(A.root, 'bob', 'kept');
  const stub = nodeHttp.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"unknown type"}'); }); });
  await new Promise((r) => stub.listen(0, LOCAL, r));
  t.after(() => new Promise((r) => { stub.close(r); stub.closeAllConnections(); }));
  repoint(B.root, 'alice', stub.address().port);
  const f = await outbox.fetchAll(B.root);
  assert.strictEqual(f.ok, true);
  assert.deepStrictEqual(inboxTexts(B.root), []);
});

test('an unreachable fetch target does not throw; fetchAll reports it', T, async (t) => {
  const { B } = await pairedClosed(t);
  repoint(B.root, 'alice', await closedPort());
  const f = await outbox.fetchAll(B.root);
  assert.strictEqual(f.ok, false);
});

test('direct delivery is still used when the receiver is reachable (nothing is queued)', T, async (t) => {
  const A = await instance(t, 'alice');
  const B = await instance(t, 'bob');
  const r = await api.connect(A.root, B.at, 'alice');
  assert.strictEqual((await api.approve(B.root, r.id)).queued, undefined);
  const s = await api.send(A.root, 'bob', 'direct');
  assert.strictEqual(s.ok, true, s.error);
  assert.strictEqual(s.queued, undefined);
  assert.deepStrictEqual(queued(A.root, 'bob'), []);
  assert.deepStrictEqual(inboxTexts(B.root), ['direct']);
  const d = await outbox.deliver(A.root, 'bob', { type: 'message', id: 'c'.repeat(16), text: 'x' });
  assert.strictEqual(d.status, 200);
});

test('polling: backs off on failures (double up to the cap), back to the interval after a success; stop() ends it', T, async (t) => {
  const results = [{ ok: false }, { ok: false }, { ok: false }, { ok: false }, { ok: true }, { ok: true }];
  const delays = [];
  let runs = 0;
  const hold = setInterval(() => {}, 1000); // the poller's own timer is unref'd
  const done = new Promise((resolve) => {
    const p = outbox.startPolling('unused-root', {
      intervalMs: 10, maxMs: 40,
      run: async () => results[runs++] || { ok: true },
      onTick: (res, delay) => { delays.push(delay); if (delays.length === 6) { p.stop(); resolve(); } },
    });
  });
  await done;
  clearInterval(hold);
  assert.deepStrictEqual(delays, [20, 40, 40, 40, 10, 10]);
  const before = runs;
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(runs, before);
});

test('kick runs a fetch at most once per ten seconds', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  let hits = 0;
  const counter = await middle(t, A.port, (rq, rs) => { hits++; return rs; });
  repoint(B.root, 'alice', counter.port);
  await outbox.kick(B.root);
  await outbox.kick(B.root);
  await outbox.kick(B.root);
  assert.strictEqual(hits, 1);
});

test('a forced kick fetches again inside the ten seconds; a plain one after it still waits', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  let hits = 0;
  const counter = await middle(t, A.port, (rq, rs) => { hits++; return rs; });
  repoint(B.root, 'alice', counter.port);
  await outbox.kick(B.root);
  await outbox.kick(B.root, { force: true });
  assert.strictEqual(hits, 2);
  await outbox.kick(B.root);
  assert.strictEqual(hits, 2, 'a plain kick right after a forced one is throttled');
});

test('fetchAll asks every target at the same time: a slow dead peer does not hold a live one back', T, async (t) => {
  const { A, B } = await pairedClosed(t);
  // a peer whose connection never completes within the test: a listener that accepts and never answers
  const socks = [];
  const hang = net.createServer((s) => { socks.push(s); s.on('error', () => {}); });
  await new Promise((r) => hang.listen(0, LOCAL, r));
  t.after(() => new Promise((r) => { socks.forEach((x) => x.destroy()); hang.close(r); }));
  const stored = store.readPeers(B.root).alice;
  store.updatePeers(B.root, (p) => ({ ghost: { ...stored, keyid: 'abcd1234abcd1234', addresses: ['127.0.0.1'], port: hang.address().port }, ...p }));
  let seen = null;
  const watch = await middle(t, A.port, (rq, rs) => { seen = Date.now(); return rs; });
  repoint(B.root, 'alice', watch.port);
  const t0 = Date.now();
  const run = outbox.fetchAll(B.root, {});
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(seen && seen - t0 < 700, 'the live peer was asked at once, not after the ghost: ' + (seen && seen - t0));
  socks.forEach((x) => x.destroy());
  await run;
});
