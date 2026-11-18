'use strict';
// Joserah Connect file transfer: small direct push, large offer/accept/refuse, safety. Loopback only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const nodeHttp = require('http');
const path = require('path');
const crypto = require('crypto');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');

const C = path.join(PLUGIN_ROOT, 'tools', 'connect');
const cfg = require(path.join(C, 'config.js'));
const store = require(path.join(C, 'store.js'));
const cx = require(path.join(C, 'crypto.js'));
const http = require(path.join(C, 'http.js'));
const listener = require(path.join(C, 'listener.js'));
const api = require(path.join(C, 'api.js'));
const files = require(path.join(C, 'files.js')); // registers the /f route and the sealed file types

const T = { timeout: 20000 };
const LOCAL = '127.0.0.1';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hex = (n) => crypto.randomBytes(n).toString('hex');

async function instance(t, name) {
  const root = tmpdir(t);
  cfg.saveConfig(root, { name, port: 0, bind: [LOCAL] });
  const servers = await listener.startListener(root, { bind: [LOCAL], port: 0 });
  t.after(() => servers.close());
  return { root, port: servers.port, at: LOCAL + ':' + servers.port };
}

// A.root knows B as "bob"; B.root knows A as "alice".
async function paired(t) {
  const A = await instance(t, 'alice');
  const B = await instance(t, 'bob');
  const r = await api.connect(A.root, B.at, 'alice');
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual((await api.approve(B.root, r.id)).ok, true);
  return { A, B };
}

const dirOf = (root, peer) => path.join(store.connectDir(root), 'files', peer);
const listDir = (root, peer) => { try { return fs.readdirSync(dirOf(root, peer)).sort(); } catch { return []; } };
const notices = (root, peer) => store.readMessages(root, peer).filter((m) => m.kind === 'notice').map((m) => m.text);
const setSmallMax = (root, n) => cfg.saveConfig(root, { ...cfg.loadConfig(root), smallFileMax: n });
function tmpFile(t, name, content) {
  const p = path.join(tmpdir(t), name);
  fs.writeFileSync(p, content);
  return p;
}

// Build a /f body the way the sender does, from A to "bob"; `chunks` are plaintext pieces.
function body(A, hdr, chunks) {
  const keys = cx.linkKeys(A.root, store.readPeers(A.root).bob);
  const w = cx.frameWriter(keys.send, cx.identity(A.root).keyid);
  return Buffer.concat([w.header(hdr), ...chunks.map((c, i) => w.chunk(c, i === chunks.length - 1))]);
}
const header = (name, data) => ({ id: hex(8), name, size: data.length, sha256: sha(data) });
const push = (A, buf) => http.sendToPeer(A.root, 'bob', null, { path: '/f', body: buf });

// A recording forwarder in front of `port` (binary safe): { port, seen:[{path, headers, req, res}] }.
function proxy(t, port) {
  const seen = [];
  const srv = nodeHttp.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rb = Buffer.concat(chunks);
      const up = nodeHttp.request({ hostname: LOCAL, port, method: req.method, path: req.url, headers: { ...req.headers, connection: 'close' }, agent: false }, (ur) => {
        const out = [];
        ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          const data = Buffer.concat(out);
          seen.push({ path: req.url, headers: req.headers, req: rb, res: data });
          res.writeHead(ur.statusCode, { 'content-type': ur.headers['content-type'] || 'application/json', 'content-length': data.length });
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
const viaProxy = (root, peer, port) => {
  const peers = store.readPeers(root);
  peers[peer].port = port;
  store.writeJson(path.join(store.connectDir(root), 'peers.json'), peers);
};

test('files.js: no child_process, no password or token', () => {
  const src = fs.readFileSync(path.join(C, 'files.js'), 'utf8');
  assert.ok(!/child_process/.test(src));
  assert.ok(!/password|bearer|token/i.test(src));
  for (const f of ['sendFile', 'files', 'acceptFile', 'refuseFile']) assert.strictEqual(typeof files[f], 'function', f);
});

test('small file arrives byte-identical, with a notice; an empty file too', T, async (t) => {
  const { A, B } = await paired(t);
  const data = crypto.randomBytes(150 * 1024 + 7); // three chunks
  const r = await files.sendFile(A.root, 'bob', tmpFile(t, 'hello.bin', data));
  assert.strictEqual(r.ok, true, r.error);
  const got = path.join(dirOf(B.root, 'alice'), 'hello.bin');
  assert.strictEqual(sha(fs.readFileSync(got)), sha(data));
  assert.ok(notices(B.root, 'alice').some((x) => x.startsWith('file received: hello.bin, ')));
  assert.strictEqual((await files.sendFile(A.root, 'bob', tmpFile(t, 'empty.txt', ''))).ok, true);
  assert.strictEqual(fs.readFileSync(path.join(dirOf(B.root, 'alice'), 'empty.txt')).length, 0);
  const list = files.files(B.root);
  assert.deepStrictEqual(list.received.map((x) => [x.peer, x.name, x.size]).sort(), [['alice', 'empty.txt', 0], ['alice', 'hello.bin', data.length]]);
  assert.deepStrictEqual(list.offers, []);
  assert.strictEqual((await files.sendFile(A.root, 'bob', path.join(tmpdir(t), 'nope.txt'))).ok, false);
  assert.strictEqual((await files.sendFile(A.root, 'nobody', tmpFile(t, 'x.txt', 'x'))).ok, false);
});

test('names are sanitized, stay inside the folder, and never overwrite', T, async (t) => {
  const { A, B } = await paired(t);
  const data = Buffer.from('content');
  for (const n of ['../../evil.txt', 'a\\b.txt', '.hidden', 'x<>:"|?*y.txt', 'CON', 'dup.txt', 'dup.txt']) {
    const r = await push(A, body(A, header(n, data), [data]));
    assert.strictEqual(r.status, 200, n);
  }
  assert.deepStrictEqual(listDir(B.root, 'alice'), ['_CON', 'b.txt', 'dup (1).txt', 'dup.txt', 'evil.txt', 'hidden', 'xy.txt'].sort());
  assert.ok(listDir(B.root, 'alice').every((n) => !n.startsWith('.')));
  assert.ok(!fs.existsSync(path.join(store.connectDir(B.root), 'evil.txt')));
  assert.ok(!fs.existsSync(path.join(B.root, 'evil.txt')));
  const keep = path.join(dirOf(B.root, 'alice'), 'dup.txt');
  fs.writeFileSync(keep, 'mine');
  await push(A, body(A, header('dup.txt', data), [data]));
  assert.strictEqual(fs.readFileSync(keep, 'utf8'), 'mine');
  assert.ok(listDir(B.root, 'alice').includes('dup (2).txt'));
});

test('large file: an offer first, nothing moves until accept; delivered notice follows', T, async (t) => {
  const { A, B } = await paired(t);
  setSmallMax(A.root, 1024);
  const data = crypto.randomBytes(200 * 1024);
  const r = await files.sendFile(A.root, 'bob', tmpFile(t, 'big.bin', data));
  assert.deepStrictEqual([r.ok, r.waiting], [true, true]);
  const { offers, received } = files.files(B.root);
  assert.strictEqual(offers.length, 1);
  assert.deepStrictEqual([offers[0].peer, offers[0].name, offers[0].size, offers[0].sha256], ['alice', 'big.bin', data.length, sha(data)]);
  assert.deepStrictEqual(received, []);
  assert.ok(notices(B.root, 'alice').some((x) => x.startsWith('alice wants to send big.bin, ')));
  assert.strictEqual(store.readList(A.root, 'sending').length, 1);
  assert.deepStrictEqual(listDir(B.root, 'alice'), []);

  const a = await files.acceptFile(B.root, offers[0].id);
  assert.strictEqual(a.ok, true, a.error);
  assert.strictEqual(sha(fs.readFileSync(path.join(dirOf(B.root, 'alice'), 'big.bin'))), sha(data));
  assert.deepStrictEqual(listDir(B.root, 'alice'), ['big.bin']);
  assert.ok(notices(B.root, 'alice').some((x) => x.startsWith('file received: big.bin')));
  assert.ok(notices(A.root, 'bob').includes('big.bin delivered'));
  assert.deepStrictEqual(store.readList(A.root, 'sending'), []);
  assert.deepStrictEqual(files.files(B.root).offers, []);
  assert.strictEqual((await files.acceptFile(B.root, offers[0].id)).ok, false);
});

test('refuse: the sender is told, no file, nothing left', T, async (t) => {
  const { A, B } = await paired(t);
  setSmallMax(A.root, 10);
  await files.sendFile(A.root, 'bob', tmpFile(t, 'no.txt', 'not wanted at all'));
  const [o] = files.files(B.root).offers;
  assert.strictEqual((await files.refuseFile(B.root, o.id)).ok, true);
  assert.ok(notices(A.root, 'bob').includes('no.txt refused'));
  assert.deepStrictEqual(store.readList(A.root, 'sending'), []);
  assert.deepStrictEqual(files.files(B.root).offers, []);
  assert.deepStrictEqual(listDir(B.root, 'alice'), []);
});

test('expired offers cannot be accepted and the sender does not serve them', T, async (t) => {
  const { A, B } = await paired(t);
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const id = hex(8);
  const dir = store.connectDir(B.root);
  store.writeJson(path.join(dir, 'offers.json'), [{ id, peer: 'alice', name: 'old.txt', size: 3, sha256: sha('abc'), created: old }]);
  assert.deepStrictEqual(files.files(B.root).offers, []);
  assert.strictEqual((await files.acceptFile(B.root, id)).ok, false);

  const p = tmpFile(t, 'old.txt', 'abc');
  const mk = (peer, created) => ({ id: hex(8), peer, path: p, name: 'old.txt', size: 3, sha256: sha('abc'), created });
  const [stale, other, fresh] = [mk('bob', old), mk('carol', new Date().toISOString()), mk('bob', new Date().toISOString())];
  store.writeJson(path.join(store.connectDir(A.root), 'sending.json'), [stale, other, fresh]);
  const pull = (e) => http.sendToPeer(B.root, 'alice', { type: 'file-pull', id: e.id }, { stream: true });
  const drain = async (r) => { const c = []; for await (const b of r.stream) c.push(b); return Buffer.concat(c); };
  for (const e of [stale, other, { id: hex(8) }]) {
    const r = await pull(e);
    assert.strictEqual(r.status, 404);
    await drain(r);
  }
  const ok = await pull(fresh);
  assert.strictEqual(ok.status, 200);
  assert.ok((await drain(ok)).length > 0);
});

test('a file that changes after the offer is not delivered', T, async (t) => {
  const { A, B } = await paired(t);
  setSmallMax(A.root, 10);
  const p = tmpFile(t, 'moving.bin', crypto.randomBytes(100 * 1024));
  await files.sendFile(A.root, 'bob', p);
  fs.writeFileSync(p, crypto.randomBytes(100 * 1024)); // same size, other bytes
  const [o] = files.files(B.root).offers;
  assert.strictEqual((await files.acceptFile(B.root, o.id)).ok, false);
  assert.deepStrictEqual(listDir(B.root, 'alice'), []);
  assert.ok(notices(A.root, 'bob').includes('moving.bin failed the check and was deleted'));
  assert.deepStrictEqual(store.readList(A.root, 'sending'), []);
});

test('a flipped byte or a wrong hash answers 422 and leaves nothing behind', T, async (t) => {
  const { A, B } = await paired(t);
  const data = crypto.randomBytes(130 * 1024);
  const chunks = [data.subarray(0, 65536), data.subarray(65536)];
  const hdr = header('t.bin', data);
  const mk = (h = hdr) => body(A, h, chunks); // a fresh header iv each time: a reused one is a replay (401)
  const flip = (at) => { const b = mk(); b[at < 0 ? b.length + at : at] ^= 1; return b; };
  assert.strictEqual((await push(A, flip(-100))).status, 422); // inside the last chunk
  assert.strictEqual((await push(A, flip(300))).status, 422); // inside the first chunk
  assert.strictEqual((await push(A, mk({ ...hdr, sha256: sha('other') }))).status, 422);
  assert.strictEqual((await push(A, mk({ ...hdr, size: 10 }))).status, 422); // more than announced
  const whole = mk();
  assert.strictEqual((await push(A, whole.subarray(0, whole.length - 50))).status, 422); // cut short
  assert.deepStrictEqual(listDir(B.root, 'alice'), []);
  assert.strictEqual(files.files(B.root).received.length, 0);
});

test('the wire carries neither the content nor the file name; a replayed stream is refused', T, async (t) => {
  const { A, B } = await paired(t);
  const px = await proxy(t, B.port);
  viaProxy(A.root, 'bob', px.port);
  const secret = Buffer.from('TOP-SECRET-CONTENT-'.repeat(50));
  const r = await files.sendFile(A.root, 'bob', tmpFile(t, 'my-private-name.txt', secret));
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(px.seen.length, 1);
  const wire = Buffer.concat([px.seen[0].req, px.seen[0].res]);
  assert.ok(!wire.includes('TOP-SECRET'));
  assert.ok(!wire.includes('my-private-name'));
  assert.ok(!wire.includes(sha(secret)));
  const before = listDir(B.root, 'alice');
  // replay the captured stream byte for byte
  const rep = await http.request({ address: LOCAL, port: B.port, method: 'POST', path: '/f', body: px.seen[0].req, headers: px.seen[0].headers });
  assert.strictEqual(rep.status, 401);
  assert.deepStrictEqual(listDir(B.root, 'alice'), before);
});

test('the pull stream is sealed too (large file)', T, async (t) => {
  const { A, B } = await paired(t);
  setSmallMax(A.root, 10);
  const px = await proxy(t, A.port);
  viaProxy(B.root, 'alice', px.port);
  const secret = Buffer.from('ANOTHER-SECRET-'.repeat(80));
  await files.sendFile(A.root, 'bob', tmpFile(t, 'big-name.txt', secret));
  const [o] = files.files(B.root).offers;
  assert.strictEqual((await files.acceptFile(B.root, o.id)).ok, true);
  const wire = Buffer.concat(px.seen.flatMap((s) => [s.req, s.res]));
  assert.ok(px.seen.some((s) => s.res.length > secret.length));
  assert.ok(!wire.includes('ANOTHER-SECRET'));
  assert.ok(!wire.includes('big-name'));
});

test('an unknown sender on /f gets 401', T, async (t) => {
  const { B } = await paired(t);
  const data = Buffer.from('x');
  const lone = tmpdir(t); // an identity nobody paired with
  const w = cx.frameWriter(crypto.randomBytes(32), cx.identity(lone).keyid);
  const buf = Buffer.concat([w.header(header('x.txt', data)), w.chunk(data, true)]);
  for (const h of [{ 'x-connect-from': cx.identity(lone).keyid }, { 'x-connect-from': 'zz' }, {}]) {
    const r = await http.request({ address: LOCAL, port: B.port, method: 'POST', path: '/f', body: buf, headers: h });
    assert.strictEqual(r.status, 401, JSON.stringify(h));
  }
  assert.deepStrictEqual(listDir(B.root, 'alice'), []);
});

test('the receiver enforces its own smallFileMax on a direct push (no offer, no yes: 413)', T, async (t) => {
  const { A, B } = await paired(t);
  setSmallMax(B.root, 10); // receiver tiny, sender default: the sender pushes directly
  const data = Buffer.from('well over ten bytes of content');
  const r = await files.sendFile(A.root, 'bob', tmpFile(t, 'sneaky.txt', data));
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
  assert.strictEqual((await push(A, body(A, header('raw.txt', data), [data]))).status, 413);
  assert.deepStrictEqual(listDir(B.root, 'alice'), []);
  const small = Buffer.from('tiny');
  assert.strictEqual((await files.sendFile(A.root, 'bob', tmpFile(t, 'ok.txt', small))).ok, true); // at or under the limit still arrives
});
