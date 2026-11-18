'use strict';
// Joserah Connect core v2: X25519 pairing with a comparison code, sealed messages, replay checks,
// address fallback, no secrets out, no wake. Two instances = two temp workspaces on 127.0.0.1:0.
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
const cx = require(path.join(C, 'crypto.js'));
const http = require(path.join(C, 'http.js'));
const listener = require(path.join(C, 'listener.js'));
const api = require(path.join(C, 'api.js'));

const T = { timeout: 20000 };
const LOCAL = '127.0.0.1';
const hex = (n) => crypto.randomBytes(n).toString('hex');
const b64 = (b) => Buffer.from(b).toString('base64url');

async function instance(t, name, extra = {}) {
  const root = tmpdir(t);
  cfg.saveConfig(root, { name, port: 0, bind: [LOCAL] });
  const servers = await listener.startListener(root, { bind: [LOCAL], port: 0, ...extra });
  t.after(() => servers.close());
  return { root, servers, port: servers.port, at: LOCAL + ':' + servers.port };
}

async function pairRequest(t, as = 'alice') {
  const A = await instance(t, as);
  const B = await instance(t, 'bob');
  const r = await api.connect(A.root, B.at, as);
  assert.strictEqual(r.ok, true, r.error);
  return { A, B, id: r.id, code: r.code };
}

async function paired(t) {
  const x = await pairRequest(t);
  const r = await api.approve(x.B.root, x.id);
  assert.strictEqual(r.ok, true, r.error);
  return x;
}

// A recording forwarder in front of `port`; `mutate(req path, reply json)` may rewrite a json reply.
function proxy(t, port, mutate) {
  const seen = [];
  const srv = nodeHttp.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ path: req.url, body: body.toString('utf8') });
      const up = nodeHttp.request({ hostname: LOCAL, port, method: req.method, path: req.url, headers: { ...req.headers, connection: 'close' }, agent: false }, (ur) => {
        const out = [];
        ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          let data = Buffer.concat(out);
          if (mutate) { try { const j = mutate(req.url, JSON.parse(data.toString())); if (j) data = Buffer.from(JSON.stringify(j)); } catch { /* not json */ } }
          res.writeHead(ur.statusCode, { 'content-type': 'application/json', 'content-length': data.length });
          res.end(data);
        });
      });
      up.end(body);
    });
  });
  return new Promise((resolve) => srv.listen(0, LOCAL, () => {
    t.after(() => new Promise((r) => { srv.close(r); srv.closeAllConnections(); }));
    resolve({ port: srv.address().port, seen });
  }));
}

const peerList = (root) => api.peers(root).peers.map((p) => p.name).sort();
const logLines = (root, peer) => {
  try { return fs.readFileSync(path.join(root, '.joserah', 'connect', 'messages', peer + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
};
const post = (port, p, json, headers) => http.request({ address: LOCAL, port, method: 'POST', path: p, json, headers });

// Seal a request the way a client does, from `fromRoot` to the peer named `peerName`.
function sealed(fromRoot, peerName, obj) {
  const rec = store.readPeers(fromRoot)[peerName];
  const keys = cx.linkKeys(fromRoot, rec);
  return cx.sealRequest(fromRoot, keys, obj);
}

test('checkBind accepts valid IPs only; hostnames and garbage refused', () => {
  for (const a of ['127.0.0.1', '100.101.102.103', '192.168.1.20', '10.0.0.5', '::1']) assert.strictEqual(cfg.checkBind(a).ok, true, a);
  for (const a of ['example.com', 'localhost', '', 'garbage', '1.2.3', '1.2.3.4.5', '999.1.1.1', undefined, null, 5]) {
    const r = cfg.checkBind(a);
    assert.strictEqual(r.ok, false, String(a));
    assert.ok(r.reason);
  }
});

test('startListener refuses a bad bind list and reports the real port', T, async (t) => {
  const root = tmpdir(t);
  await assert.rejects(listener.startListener(root, { bind: ['example.com'], port: 0 }));
  await assert.rejects(listener.startListener(root, { bind: [LOCAL, 'nope'], port: 0 }));
  const A = await instance(t, 'alice');
  assert.notStrictEqual(A.port, 0);
  assert.strictEqual(cfg.loadConfig(A.root).port, A.port);
});

test('startListener with no bind listens on every interface', T, async (t) => {
  const root = tmpdir(t);
  cfg.saveConfig(root, { name: 'alice', port: 0 });
  const servers = await listener.startListener(root, { port: 0 });
  t.after(() => servers.close());
  const a = servers[0].address().address;
  assert.ok(a === '::' || a === '0.0.0.0', a);
  const r = await post(servers.port, '/m', { from: 'x' });
  assert.ok(r.status >= 400);
});

test('no password, token or child_process in the core modules', () => {
  for (const f of ['crypto.js', 'config.js', 'store.js', 'http.js', 'listener.js', 'api.js']) {
    const src = fs.readFileSync(path.join(C, f), 'utf8');
    assert.ok(!/password|bearer|token/i.test(src), f + ' mentions a password or token');
    assert.ok(!/child_process/.test(src), f + ' uses child_process');
  }
  assert.strictEqual(cfg.setPassword, undefined);
  assert.strictEqual(cfg.checkPassword, undefined);
});

test('pairing: both sides see the same code; nothing is a peer until approved', T, async (t) => {
  const { A, B, id, code } = await pairRequest(t);
  assert.match(code, /^\d{6}$/);
  assert.deepStrictEqual(peerList(A.root), []);
  assert.deepStrictEqual(peerList(B.root), []);
  const p = api.pending(B.root).pending;
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].id, id);
  assert.strictEqual(p[0].username, 'alice');
  assert.strictEqual(p[0].code, code);
  assert.match(p[0].keyid, /^[0-9a-f]{16}$/);
  assert.strictEqual(p[0].keyid, cx.identity(A.root).keyid);
  const r = await api.approve(B.root, id);
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(peerList(B.root), ['alice']);
  assert.deepStrictEqual(peerList(A.root), ['bob']);
  assert.strictEqual(api.pending(B.root).pending.length, 0);
  assert.strictEqual(store.readList(A.root, 'outgoing').length, 0);
  assert.strictEqual(store.readPeers(A.root).bob.keyid, cx.identity(B.root).keyid);
});

test('pairing: refuse leaves nothing stored, A is told', T, async (t) => {
  const { A, B, id } = await pairRequest(t);
  const r = await api.refuse(B.root, id);
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(peerList(A.root), []);
  assert.deepStrictEqual(peerList(B.root), []);
  assert.strictEqual(api.pending(B.root).pending.length, 0);
  assert.strictEqual(store.readList(A.root, 'outgoing').length, 0);
  assert.ok(api.inbox(A.root).messages.some((m) => m.kind === 'notice'));
});

test('pairing: bad username refused, same name twice 409', T, async (t) => {
  const { A, B } = await paired(t);
  assert.strictEqual((await api.connect(A.root, B.at, 'Not Valid!')).ok, false);
  const again = await api.connect(A.root, B.at, 'alice');
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.status, 409);
  assert.strictEqual(store.readList(A.root, 'outgoing').length, 0);
});

test('tampered key exchange: nonce or key swapped in transit -> codes differ, nothing is paired', T, async (t) => {
  for (const swap of ['nonce', 'pub']) {
    const A = await instance(t, 'alice');
    const B = await instance(t, 'bob');
    const px = await proxy(t, B.port, (p, j) => (p === '/pair' && j.pub ? { ...j, [swap]: b64(crypto.randomBytes(32)) } : null));
    const r = await api.connect(A.root, LOCAL + ':' + px.port, 'alice');
    if (!r.ok) { assert.ok(swap === 'pub'); continue; }
    const mine = api.pending(B.root).pending[0];
    assert.notStrictEqual(mine.code, r.code, swap);
    // B approves anyway: A cannot open the sealed accept, so A stores nothing
    const ap = await api.approve(B.root, mine.id);
    assert.strictEqual(ap.ok, true);
    assert.deepStrictEqual(peerList(A.root), [], swap);
  }
});

test('reveal not matching its commit -> 400 and the entry is dropped', T, async (t) => {
  const B = await instance(t, 'bob');
  const nA = crypto.randomBytes(32);
  const pubA = cx.identity((await instance(t, 'alice')).root).pub;
  const id = hex(8);
  const r1 = await post(B.port, '/pair', { id, username: 'alice', commit: cx.commit(pubA, nA) });
  assert.strictEqual(r1.status, 200);
  assert.ok(r1.json.pub && r1.json.nonce && r1.json.name === 'bob');
  const r2 = await post(B.port, '/pair/reveal', { id, pub: b64(pubA), nonce: b64(crypto.randomBytes(32)), addresses: [], port: 1234 });
  assert.strictEqual(r2.status, 400);
  assert.strictEqual(api.pending(B.root).pending.length, 0);
  assert.strictEqual(store.readList(B.root, 'pending').length, 0);
  // and a matching reveal is accepted
  const id2 = hex(8);
  await post(B.port, '/pair', { id: id2, username: 'alice', commit: cx.commit(pubA, nA) });
  const ok = await post(B.port, '/pair/reveal', { id: id2, pub: b64(pubA), nonce: b64(nA), addresses: [], port: 1234 });
  assert.strictEqual(ok.status, 202);
});

test('pairing: a pending request older than 10 minutes is gone', T, async (t) => {
  const { B, id } = await pairRequest(t);
  const file = path.join(B.root, '.joserah', 'connect', 'pending.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  list[0].created = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(list));
  assert.strictEqual(api.pending(B.root).pending.length, 0);
  assert.strictEqual((await api.approve(B.root, id)).ok, false);
  assert.deepStrictEqual(peerList(B.root), []);
});

test('pairing: 5 requests per IP, the 6th is 429; the window passes', T, async (t) => {
  let clock = Date.now();
  const B = await instance(t, 'bob', { now: () => clock });
  const req = () => post(B.port, '/pair', { id: hex(8), username: 'alice', commit: hex(32) });
  for (let i = 0; i < 5; i++) assert.strictEqual((await req()).status, 200);
  assert.strictEqual((await req()).status, 429);
  clock += 11 * 60 * 1000;
  assert.strictEqual((await req()).status, 200);
});

test('pairing: at most 10 pending/half-open entries, the 11th is 429', T, async (t) => {
  const B = await instance(t, 'bob');
  store.writeList(B.root, 'pending', Array.from({ length: 10 }, () => ({ id: hex(8), username: 'x', created: new Date().toISOString(), open: true })));
  const r = await post(B.port, '/pair', { id: hex(8), username: 'alice', commit: hex(32) });
  assert.strictEqual(r.status, 429);
});

test('send / inbox / reply / unreadSummary', T, async (t) => {
  const { A, B } = await paired(t);
  const s1 = await api.send(A.root, 'bob', 'hello bob');
  const s2 = await api.send(A.root, 'bob', 'second');
  assert.strictEqual(s1.ok, true, s1.error);
  assert.strictEqual(s2.ok, true, s2.error);
  assert.strictEqual(api.unreadSummary(B.root).messages.alice, 2);
  assert.strictEqual(api.unreadSummary(A.root).total, 0);
  const i1 = api.inbox(B.root);
  assert.deepStrictEqual(i1.messages.map((m) => m.text), ['hello bob', 'second']);
  assert.strictEqual(i1.messages[0].peer, 'alice');
  assert.strictEqual(i1.messages[0].id, s1.id);
  assert.deepStrictEqual(api.inbox(B.root).messages, []);
  assert.strictEqual(api.unreadSummary(B.root).total, 0);
  const rep = await api.reply(B.root, s1.id, 'hi alice');
  assert.strictEqual(rep.ok, true, rep.error);
  const got = api.inbox(A.root).messages;
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].peer, 'bob');
  assert.strictEqual(got[0].reply_to, s1.id);
  assert.ok(logLines(A.root, 'bob').some((m) => m.dir === 'out' && m.text === 'hello bob'));
  assert.strictEqual((await api.reply(B.root, 'f'.repeat(16), 'x')).ok, false);
  assert.strictEqual((await api.send(A.root, 'nobody', 'x')).ok, false);
  assert.strictEqual((await api.send(A.root, 'bob', 'x'.repeat(64 * 1024 + 1))).ok, false);
});

test('sealed /m: replay, flipped bit, unknown sender, stale ts, oversize', T, async (t) => {
  const { A, B } = await paired(t);
  const px = await proxy(t, B.port);
  // use the real client path through a recording proxy, then replay the captured bytes
  const rec = store.readPeers(A.root).bob;
  store.setPeer(A.root, 'bob', { ...rec, addresses: [LOCAL], port: px.port });
  const s = await api.send(A.root, 'bob', 'secret plaintext 12345');
  assert.strictEqual(s.ok, true, s.error);
  const wire = px.seen.find((x) => x.path === '/m');
  assert.ok(wire, 'captured a /m request');
  assert.ok(!wire.body.includes('secret plaintext'), 'plaintext on the wire');
  assert.ok(!wire.body.includes('12345'));
  assert.strictEqual(logLines(B.root, 'alice').length, 1);
  const replay = await post(B.port, '/m', JSON.parse(wire.body));
  assert.strictEqual(replay.status, 401);
  assert.strictEqual(logLines(B.root, 'alice').length, 1, 'stored once');

  const msg = (extra) => ({ type: 'message', id: hex(8), text: 'sneak', ...extra });
  const env = sealed(A.root, 'bob', msg());
  const ct = Buffer.from(env.ct, 'base64url'); ct[3] ^= 1;
  assert.strictEqual((await post(B.port, '/m', { ...env, ct: b64(ct) })).status, 401);
  assert.strictEqual((await post(B.port, '/m', { ...sealed(A.root, 'bob', msg()), from: hex(8) })).status, 401);
  assert.strictEqual((await post(B.port, '/m', sealed(A.root, 'bob', msg({ ts: Date.now() - 11 * 60 * 1000 })))).status, 401);
  assert.strictEqual((await post(B.port, '/m', sealed(A.root, 'bob', msg({ ts: Date.now() + 11 * 60 * 1000 })))).status, 401);
  assert.strictEqual(logLines(B.root, 'alice').length, 1);
  assert.strictEqual((await post(B.port, '/m', sealed(A.root, 'bob', msg({ text: 'x'.repeat(64 * 1024 + 1) })))).status, 413);
  assert.strictEqual((await post(B.port, '/m', sealed(A.root, 'bob', msg({ text: 'x'.repeat(64 * 1024) })))).status, 200);
  assert.strictEqual(logLines(B.root, 'alice').length, 2);
  // a fresh valid one is fine, and a message sealed with the wrong direction key is not
  const rk = cx.linkKeys(A.root, store.readPeers(A.root).bob);
  const wrong = cx.seal(rk.recv, { type: 'message', ts: Date.now(), id: hex(8), text: 'x' }, 'jc1 m ' + cx.identity(A.root).keyid);
  assert.strictEqual((await post(B.port, '/m', { from: cx.identity(A.root).keyid, ...wrong })).status, 401);
});

test('address fallback: dead first address, then the live one; the working one is recorded', T, async (t) => {
  const { A, B } = await paired(t);
  const rec = store.readPeers(A.root).bob;
  store.setPeer(A.root, 'bob', { ...rec, addresses: ['127.0.0.2', '127.0.0.1'], port: B.port });
  const s = await api.send(A.root, 'bob', 'via the second address');
  assert.strictEqual(s.ok, true, s.error);
  assert.strictEqual(store.readPeers(A.root).bob.addresses[0], '127.0.0.1');
  assert.strictEqual(logLines(B.root, 'alice').length, 1);
});

test('disconnect removes the peer on both sides; old keys stop working', T, async (t) => {
  const { A, B } = await paired(t);
  const old = sealed(A.root, 'bob', { type: 'message', id: hex(8), text: 'late' });
  const r = await api.disconnect(A.root, 'bob');
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(peerList(A.root), []);
  assert.deepStrictEqual(peerList(B.root), []);
  assert.strictEqual((await post(B.port, '/m', old)).status, 401);
  assert.strictEqual((await api.disconnect(A.root, 'bob')).ok, false);
});

test('registerRoutes: sealed types and plain routes can be added; sender() resolves the peer', T, async (t) => {
  let got = null;
  listener.registerRoutes(({ route, sealed: addSealed, sender }) => {
    addSealed('ping-test', (ctx) => { got = { name: ctx.name, text: ctx.msg.text }; return { pong: true }; });
    route('POST', '/x/:what', (ctx) => ctx.send(200, { what: ctx.params.what, known: !!sender(ctx.root, ctx.req.headers['x-connect-from']) }));
  });
  const { A, B } = await paired(t);
  const r = await post(B.port, '/m', sealed(A.root, 'bob', { type: 'ping-test', text: 'hi' }));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(got, { name: 'alice', text: 'hi' });
  assert.deepStrictEqual(r.json, { pong: true });
  const x = await post(B.port, '/x/y', {}, { 'x-connect-from': cx.identity(A.root).keyid });
  assert.deepStrictEqual(x.json, { what: 'y', known: true });
  assert.strictEqual((await post(B.port, '/m', sealed(A.root, 'bob', { type: 'nothing-here' }))).status, 400);
});

test('frames: round trip, reorder, truncation and tamper are refused', () => {
  const key = crypto.randomBytes(32);
  const w = cx.frameWriter(key, 'abcd');
  const parts = [w.header({ id: 'f1', name: 'a.txt', size: 7 }), w.chunk(Buffer.from('abc'), false), w.chunk(Buffer.from('defg'), true)];
  const read = (bufs, end = true) => {
    const r = cx.frameReader(key, 'abcd');
    const items = bufs.flatMap((b) => r.push(b));
    if (end) r.end();
    return items;
  };
  const items = read([Buffer.concat(parts)]);
  assert.strictEqual(items[0].header.name, 'a.txt');
  assert.strictEqual(Buffer.concat(items.slice(1).map((i) => i.data)).toString(), 'abcdefg');
  assert.strictEqual(read(parts.map((p) => p)).length, 3); // frame by frame
  assert.throws(() => read([parts[0], parts[2], parts[1]]));
  assert.throws(() => read([parts[0], parts[1]]));      // cut before the last frame
  assert.throws(() => read([parts[0], parts[2]]));      // a chunk missing
  const bad = Buffer.from(parts[1]); bad[bad.length - 1] ^= 1;
  assert.throws(() => read([parts[0], bad, parts[2]]));
  assert.throws(() => read([Buffer.concat(parts), Buffer.from([0, 0, 0, 1, 9])]));
});

test('no secrets out: the private key stays in keys/connect.json only', T, async (t) => {
  const results = [];
  const rec = async (p) => { const r = await p; results.push(JSON.stringify(r)); return r; };
  const A = await instance(t, 'alice');
  const B = await instance(t, 'bob');
  const c = await rec(api.connect(A.root, B.at, 'alice'));
  results.push(JSON.stringify(api.pending(B.root)));
  await rec(api.approve(B.root, c.id));
  await rec(api.send(A.root, 'bob', 'hello'));
  results.push(JSON.stringify(api.inbox(B.root)), JSON.stringify(api.peers(A.root)), JSON.stringify(api.unreadSummary(B.root)));
  await rec(api.send(A.root, 'nobody', 'x'));
  await rec(api.connect(A.root, '127.0.0.1:1', 'alice'));
  const secrets = [];
  for (const R of [A, B]) {
    const k = JSON.parse(fs.readFileSync(path.join(R.root, 'keys', 'connect.json'), 'utf8'));
    secrets.push(k.identity.private);
    const d = cx.deriveKeys(cx.identity(R.root), cx.identity(R === A ? B.root : A.root).pub, Buffer.alloc(32));
    assert.ok(d.send && d.recv);
  }
  const keysOf = [A, B].flatMap((R) => { const p = store.readPeers(R.root); return Object.values(p).flatMap((x) => { const k = cx.linkKeys(R.root, x); return [k.send.toString('hex'), k.recv.toString('hex'), k.send.toString('base64url'), k.recv.toString('base64url')]; }); });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const R of [A, B]) {
    for (const f of walk(path.join(R.root, '.joserah'))) {
      const txt = fs.readFileSync(f, 'utf8');
      for (const s of [...secrets, ...keysOf]) assert.ok(!txt.includes(s), 'secret in a .joserah file');
    }
  }
  for (const r of results) for (const s of [...secrets, ...keysOf]) assert.ok(!r.includes(s), 'secret in an api result');
  assert.ok(secrets.every((s) => s && s.length > 20));
});

test('no wake: a received message is one line in a log and nothing else', T, async (t) => {
  const { A, B } = await paired(t);
  const dir = path.join(B.root, '.joserah', 'connect');
  await api.send(A.root, 'bob', 'wake up');
  assert.strictEqual(logLines(B.root, 'alice').length, 1);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'messages')), ['alice.jsonl']);
});

test('store helpers: sanitizeName, validPeerName, pruneByAge, notice lines, json', (t) => {
  assert.strictEqual(store.sanitizeName('../../etc/passwd'), 'passwd');
  assert.strictEqual(store.sanitizeName('C:\\x\\y\\..\\.hidden.txt'), 'hidden.txt');
  assert.strictEqual(store.sanitizeName('a<b>:c"d|e?f*.txt'), 'abcdef.txt');
  assert.strictEqual(store.sanitizeName('...'), 'file');
  assert.strictEqual(store.sanitizeName('x'.repeat(300)).length, 200);
  for (const n of ['yusuf', 'a.b_c-9']) assert.strictEqual(store.validPeerName(n), true);
  for (const n of ['', 'Yusuf', 'a b', '../x', 'x'.repeat(41), 'a/b', null]) assert.strictEqual(store.validPeerName(n), false, String(n));
  const now = Date.now();
  assert.strictEqual(store.pruneByAge([{ created: new Date(now - 11 * 60000).toISOString() }, { created: new Date(now - 60000).toISOString() }], now).length, 1);
  const root = tmpdir(t);
  const m = store.appendMessage(root, 'yusuf', { dir: 'in', text: 'file received: a.txt, 3', kind: 'notice' });
  assert.strictEqual(m.kind, 'notice');
  assert.throws(() => store.appendMessage(root, '../evil', { dir: 'in', text: 'x' }));
  const f = path.join(root, 'sub', 'x.json');
  store.writeJson(f, { a: 1 });
  assert.deepStrictEqual(store.readJson(f, null), { a: 1 });
  assert.strictEqual(fs.existsSync(f + '.tmp'), false);
  // seen-iv cache: fresh once, then refused; stale ts refused
  const iv = hex(12);
  assert.strictEqual(store.checkReplay(root, 'k1', iv, now, now), true);
  assert.strictEqual(store.checkReplay(root, 'k1', iv, now, now), false);
  assert.strictEqual(store.checkReplay(root, 'k1', hex(12), now - 11 * 60000, now), false);
});
