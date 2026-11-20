'use strict';
// Joserah Connect W1: the store is safe under several processes (file lock + atomic write), and a
// listener that finds its port taken keeps trying until the port frees.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const nodeHttp = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');

const C = path.join(PLUGIN_ROOT, 'tools', 'connect');
const store = require(path.join(C, 'store.js'));
const cfg = require(path.join(C, 'config.js'));
const T = { timeout: 20000 };
const LOCAL = '127.0.0.1';

// Run a script in a child node process; resolves { code, out }.
function child(script, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', script], { env: { ...process.env, JC_C: C, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill(), 15000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err }); });
  });
}

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};

test('updateJson from several processes loses no update', T, async (t) => {
  const file = path.join(tmpdir(t), 'count.json');
  const script = `
    const s = require(process.env.JC_C + '/store.js');
    for (let i = 0; i < 50; i++) s.updateJson(process.env.JC_FILE, { n: 0 }, (d) => ({ n: d.n + 1 }));
  `;
  const runs = await Promise.all([1, 2, 3, 4].map(() => child(script, { JC_FILE: file })));
  for (const r of runs) assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(store.readJson(file, null).n, 200);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['count.json']); // no lock or tmp left behind
});

test('checkReplay: two processes on the same iv, exactly one true', T, async (t) => {
  const root = tmpdir(t);
  const script = `
    const s = require(process.env.JC_C + '/store.js');
    const go = Number(process.env.JC_GO);
    while (Date.now() < go) { /* start together */ }
    const now = Date.now();
    const got = [];
    for (let i = 0; i < 20; i++) got.push(s.checkReplay(process.env.JC_ROOT, 'abcd', 'iv' + i, now, now));
    console.log(JSON.stringify(got));
  `;
  const go = String(Date.now() + 1500);
  const runs = await Promise.all([1, 2, 3].map(() => child(script, { JC_ROOT: root, JC_GO: go })));
  for (const r of runs) assert.strictEqual(r.code, 0, r.err);
  const all = runs.map((r) => JSON.parse(r.out));
  for (let i = 0; i < 20; i++) assert.strictEqual(all.filter((a) => a[i]).length, 1, 'iv' + i);
});

test('updateJson is atomic: a throwing fn leaves the file and the lock alone', (t) => {
  const file = path.join(tmpdir(t), 'a.json');
  store.updateJson(file, {}, () => ({ ok: 1 }));
  assert.throws(() => store.updateJson(file, {}, () => { throw new Error('nope'); }), /nope/);
  assert.deepStrictEqual(store.readJson(file, null), { ok: 1 });
  assert.ok(!fs.existsSync(file + '.lock'));
  store.updateJson(file, {}, () => store.KEEP);
  assert.deepStrictEqual(store.readJson(file, null), { ok: 1 });
});

test('writeJson from several processes at once never fails and leaves no tmp file', T, async (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'w.json');
  const script = `
    const s = require(process.env.JC_C + '/store.js');
    for (let i = 0; i < 100; i++) s.writeJson(process.env.JC_FILE, { i, pid: process.pid });
  `;
  const runs = await Promise.all([1, 2, 3].map(() => child(script, { JC_FILE: file })));
  for (const r of runs) assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(fs.readdirSync(dir), ['w.json']);
  assert.strictEqual(store.readJson(file, null).i, 99);
});

test('updateList prunes expired entries inside the lock', (t) => {
  const root = tmpdir(t);
  const old = new Date(Date.now() - store.TTL_MS - 1000).toISOString();
  store.writeList(root, 'pending', [{ id: 'old', created: old }, { id: 'new', created: new Date().toISOString() }]);
  let seen;
  store.updateList(root, 'pending', (l) => { seen = l.map((e) => e.id); return [...l, { id: 'add', created: new Date().toISOString() }]; });
  assert.deepStrictEqual(seen, ['new']);
  assert.deepStrictEqual(store.readList(root, 'pending').map((e) => e.id), ['new', 'add']);
});

const lock = () => require(path.join(C, 'lock.js'));

test('a stale lock (old, or its owner dead) is broken', (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 's.json');
  const old = new Date(Date.now() - 60000);
  fs.writeFileSync(file + '.lock', String(process.pid) + ' x');
  fs.utimesSync(file + '.lock', old, old);
  assert.strictEqual(lock().withLock(file, () => 'got it'), 'got it'); // too old
  // a fresh lock whose pid is certainly gone
  fs.writeFileSync(file + '.lock', '2147483000 y');
  assert.strictEqual(lock().withLock(file, () => 'again'), 'again');
  assert.ok(!fs.existsSync(file + '.lock'));
});

test('a lock held beyond the bound throws and does not hang', T, (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'h.json');
  fs.writeFileSync(file + '.lock', String(process.pid) + ' live'); // fresh, owner alive
  const { withLock } = lock();
  const t0 = Date.now();
  assert.throws(() => withLock(file, () => 1, { waitMs: 300 }), /lock/i);
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(fs.existsSync(file + '.lock')); // the live holder's lock is untouched
});

test('withLock is re-entrant inside one process and releases on a throw', (t) => {
  const file = path.join(tmpdir(t), 'r.json');
  const { withLock } = lock();
  assert.strictEqual(withLock(file, () => withLock(file, () => 7)), 7);
  assert.throws(() => withLock(file, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(file + '.lock'));
});

function request(port, p = '/nothing') {
  return new Promise((resolve, reject) => {
    nodeHttp.get({ host: LOCAL, port, path: p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
}

test('keeper: takes over a port when it frees, serves, and stop() frees it', T, async (t) => {
  const { keepListening } = require(path.join(C, 'keeper.js'));
  const root = tmpdir(t);
  cfg.saveConfig(root, { name: 'host', port: 0 });
  const dummy = net.createServer();
  await new Promise((r) => dummy.listen(0, LOCAL, r));
  const port = dummy.address().port;
  const errors = []; let took = 0;
  const k = keepListening(root, { port, bind: [LOCAL], retryMs: 50, maxRetryMs: 200, onError: (e) => errors.push(e.code), onListening: () => { took++; } });
  t.after(() => k.stop());
  assert.ok(await until(() => errors.length >= 2), 'keeps retrying while the port is taken');
  assert.strictEqual(k.listening, false);
  await new Promise((r) => dummy.close(r));
  assert.ok(await until(() => k.listening), 'listening once the port is free');
  assert.strictEqual(took, 1);
  assert.deepStrictEqual([...new Set(errors)], ['EADDRINUSE']);
  assert.strictEqual(await request(port), 404); // a real request reaches the listener's router
  const rec = store.readJson(path.join(store.connectDir(root), 'listener.json'), {});
  assert.strictEqual(rec.pid, process.pid);
  assert.strictEqual(rec.port, port);
  await k.stop();
  assert.strictEqual(k.listening, false);
  assert.deepStrictEqual(store.readJson(path.join(store.connectDir(root), 'listener.json'), {}), {});
  // the port is free again
  await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, LOCAL, () => s.close(resolve)); });
});

test('keeper: stop() while the port is still taken ends the retries', T, async (t) => {
  const { keepListening } = require(path.join(C, 'keeper.js'));
  const root = tmpdir(t);
  cfg.saveConfig(root, { name: 'host', port: 0 });
  const dummy = net.createServer();
  await new Promise((r) => dummy.listen(0, LOCAL, r));
  t.after(() => dummy.close());
  let n = 0;
  const k = keepListening(root, { port: dummy.address().port, bind: [LOCAL], retryMs: 30, maxRetryMs: 30, onError: () => { n++; } });
  assert.ok(await until(() => n >= 1));
  await k.stop();
  const at = n;
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(n, at);
});

test('keeper: another error is reported and retried', T, async (t) => {
  const { keepListening } = require(path.join(C, 'keeper.js'));
  const root = tmpdir(t);
  let calls = 0; const errs = [];
  const fake = async () => { calls++; if (calls < 3) throw Object.assign(new Error('odd'), { code: 'EODD' }); const s = [{ close: async () => {} }]; s.port = 1; s.close = async () => {}; return s; };
  const k = keepListening(root, { retryMs: 20, maxRetryMs: 20, startListener: fake, onError: (e) => errs.push(e.code) });
  t.after(() => k.stop());
  assert.ok(await until(() => k.listening));
  assert.deepStrictEqual(errs, ['EODD', 'EODD']);
});
