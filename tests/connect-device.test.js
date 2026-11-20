'use strict';
// Joserah Connect v2: device identity, path addresses, v1 migration. Every test uses temp folders for
// the workspace and for a fake home; the real home is never touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');

const C = path.join(PLUGIN_ROOT, 'tools', 'connect');
const device = require(path.join(C, 'device.js'));
const address = require(path.join(C, 'address.js'));
const store = require(path.join(C, 'store.js'));

const T = { timeout: 20000 };

function ws(t, config, name = 'ws') {
  const root = path.join(tmpdir(t), name);
  fs.mkdirSync(path.join(root, '.joserah'), { recursive: true });
  if (config !== undefined) fs.writeFileSync(path.join(root, '.joserah', 'config.json'), JSON.stringify(config));
  return root;
}
const owner = (extra = {}) => ({ ownerName: 'Serkan Adem Atay', workspaceName: 'Atay Root', trust: 'owner', ...extra });
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const KEY = { identity: { private: 'PRIVATE-A', public: 'PUBLIC-A' } };
function listing(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(dir, p) + (e.isDirectory() ? '/' : ':' + fs.statSync(p).size));
      if (e.isDirectory()) walk(p);
    }
  })(dir);
  return out.sort();
}
function v1(root, { key = KEY, name = 'laptop' } = {}) {
  put(path.join(root, 'keys', 'connect.json'), key);
  const c = path.join(root, '.joserah', 'connect');
  put(path.join(c, 'config.json'), { name, port: 4791, bind: ['127.0.0.1'], smallFileMax: 123 });
  put(path.join(c, 'peers.json'), { 'atay-pc': { keyid: 'k1', addresses: ['1.2.3.4'], port: 4790 } });
  put(path.join(c, 'pending.json'), [{ id: 'p1' }]);
  put(path.join(c, 'messages', 'atay-pc.jsonl'), '{"id":"m1"}\n');
  put(path.join(c, 'read.json'), { 'atay-pc': 1 });
  return c;
}

test('slug', T, () => {
  assert.strictEqual(device.slug('Serkan Adem Atay'), 'serkan-adem-atay');
  assert.strictEqual(device.slug('Şükrü Öğüt'), 'sukru-ogut');
  assert.strictEqual(device.slug('ÇAĞRI İşıl'), 'cagri-isil');
  assert.strictEqual(device.slug('Zoë  Müller__x'), 'zoe-muller-x');
  assert.strictEqual(device.slug('  --a--b--  '), 'a-b');
  assert.strictEqual(device.slug(''), null);
  assert.strictEqual(device.slug('***'), null);
  assert.strictEqual(device.slug(undefined), null);
  const long = device.slug('a'.repeat(60));
  assert.strictEqual(long.length, 40);
  assert.ok(store.validPeerName(long));
  assert.strictEqual(device.slug('a'.repeat(39) + ' b'), 'a'.repeat(39));
});

test('resolve: owner, device and session names', T, (t) => {
  const home = tmpdir(t);
  const root = ws(t, owner());
  const r = device.resolve(root, { home, hostname: 'DESKTOP-ABC' });
  assert.deepStrictEqual(r, { mode: 'owner', person: 'serkan-adem-atay', device: 'desktop-abc', session: 'atay-root', deviceRoot: device.deviceDir(home, 'serkan-adem-atay'), wsRoot: root });
  assert.strictEqual(device.isDeviceRoot(r.deviceRoot), true);
  assert.strictEqual(device.isDeviceRoot(root), false);
  assert.deepStrictEqual(fs.readdirSync(home), [], 'resolve creates nothing');
});

test('resolve: session falls back to the folder name; v1 name wins over the hostname', T, (t) => {
  const home = tmpdir(t);
  const root = ws(t, owner({ workspaceName: '' }), 'My Folder');
  put(path.join(root, '.joserah', 'connect', 'config.json'), { name: 'laptop' });
  const r = device.resolve(root, { home, hostname: 'HOST' });
  assert.strictEqual(r.session, 'my-folder');
  assert.strictEqual(r.device, 'laptop');
});

test('resolve: device folder config names the device', T, (t) => {
  const home = tmpdir(t);
  const root = ws(t, owner());
  put(path.join(device.deviceDir(home, 'serkan-adem-atay'), 'config.json'), { name: 'atay-pc' });
  assert.strictEqual(device.resolve(root, { home, hostname: 'HOST' }).device, 'atay-pc');
});

test('resolve: missing or odd trust means guest and the home is never looked at', T, (t) => {
  const home = tmpdir(t);
  put(path.join(device.deviceDir(home, 'serkan-adem-atay'), 'config.json'), { name: 'from-home' });
  for (const trust of [undefined, 'Owner', 'root', 7, 'guest']) {
    const root = ws(t, owner({ trust }));
    const r = device.resolve(root, { home, hostname: 'HOST' });
    assert.strictEqual(r.mode, 'guest');
    assert.strictEqual(r.deviceRoot, root);
    assert.strictEqual(r.device, 'host', 'the guest never reads the home config');
    assert.ok(!r.deviceRoot.startsWith(home));
  }
  const noConfig = ws(t, undefined);
  assert.strictEqual(device.resolve(noConfig, { home, hostname: 'H' }).mode, 'guest');
});

test('two persons on one home get two device folders', T, (t) => {
  const home = tmpdir(t);
  const a = device.resolve(ws(t, owner(), 'a'), { home, hostname: 'H' });
  const b = device.resolve(ws(t, owner({ ownerName: 'Sevgi Akkaya' }), 'b'), { home, hostname: 'H' });
  assert.notStrictEqual(a.deviceRoot, b.deviceRoot);
  assert.strictEqual(b.person, 'sevgi-akkaya');
  assert.strictEqual(path.dirname(a.deviceRoot), path.dirname(b.deviceRoot));
  assert.throws(() => device.deviceDir(home, '../x'));
});

test('registerSession and sessionRoot: one device folder routes to every workspace', T, (t) => {
  const home = tmpdir(t);
  const w1 = ws(t, owner(), 'one');
  const w2 = ws(t, owner({ workspaceName: 'Second' }), 'two');
  const r1 = device.resolve(w1, { home, hostname: 'H' });
  const r2 = device.resolve(w2, { home, hostname: 'H' });
  assert.strictEqual(r1.deviceRoot, r2.deviceRoot);
  assert.strictEqual(device.registerSession(r1).registered, true);
  device.registerSession(r2);
  const map = JSON.parse(fs.readFileSync(path.join(r1.deviceRoot, 'sessions.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(map).sort(), ['atay-root', 'second']);
  assert.strictEqual(map.second.root, w2);
  assert.ok(Date.parse(map.second.updated));
  assert.strictEqual(device.sessionRoot(r1.deviceRoot, 'second'), w2);
  assert.strictEqual(device.sessionRoot(r1.deviceRoot, 'atay-root'), w1);
  assert.strictEqual(device.sessionRoot(r1.deviceRoot, 'nope'), null);
  assert.strictEqual(device.sessionRoot(r1.deviceRoot, '__proto__'), null);
  assert.strictEqual(device.sessionRoot(path.join(home, 'empty'), 'second'), null);
});

test('guest: resolve, migrate and registerSession leave a populated home untouched', T, (t) => {
  const home = tmpdir(t);
  const dd = device.deviceDir(home, 'serkan-adem-atay');
  put(path.join(dd, 'keys', 'connect.json'), { identity: { private: 'X', public: 'Y' } });
  put(path.join(dd, 'peers.json'), {});
  const before = listing(home);
  const root = ws(t, owner({ trust: 'guest' }));
  const c = v1(root);
  const r = device.resolve(root, { home, hostname: 'H' });
  const m = device.migrate(root, { home, hostname: 'H' });
  const s = device.registerSession(r);
  assert.deepStrictEqual(listing(home), before);
  assert.strictEqual(m.migrated, false);
  assert.strictEqual(s.registered, false);
  assert.ok(!JSON.stringify([r, m, s]).includes(home));
  assert.ok(fs.existsSync(path.join(root, 'keys', 'connect.json')), 'guest v1 state stays as it is');
  assert.ok(fs.existsSync(path.join(c, 'peers.json')));
  // an absent home folder stays absent
  const empty = path.join(tmpdir(t), 'no-home-yet');
  device.migrate(root, { home: empty });
  device.registerSession(device.resolve(root, { home: empty }));
  assert.ok(!fs.existsSync(empty));
});

test('migrate: key, peers, lists and config move; v1 copies stay as .v1-backup; messages stay', T, (t) => {
  const home = tmpdir(t);
  const root = ws(t, owner());
  const c = v1(root);
  const r = device.migrate(root, { home, hostname: 'H' });
  const dd = device.deviceDir(home, 'serkan-adem-atay');
  assert.strictEqual(r.migrated, true);
  assert.ok(!r.conflict);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dd, 'keys', 'connect.json'), 'utf8')), KEY);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dd, 'peers.json'), 'utf8')), { 'atay-pc': { keyid: 'k1', addresses: ['1.2.3.4'], port: 4790 } });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dd, 'pending.json'), 'utf8')), [{ id: 'p1' }]);
  const cfg = JSON.parse(fs.readFileSync(path.join(dd, 'config.json'), 'utf8'));
  assert.strictEqual(cfg.name, 'laptop');
  assert.strictEqual(cfg.port, 4791);
  assert.deepStrictEqual(cfg.bind, ['127.0.0.1']);
  assert.strictEqual(cfg.smallFileMax, 123);
  for (const f of ['peers.json', 'pending.json', 'config.json']) {
    assert.ok(fs.existsSync(path.join(c, f + '.v1-backup')), f);
    assert.ok(!fs.existsSync(path.join(c, f)), f);
  }
  assert.ok(fs.existsSync(path.join(root, 'keys', 'connect.json.v1-backup')));
  assert.ok(!fs.existsSync(path.join(root, 'keys', 'connect.json')));
  assert.ok(fs.existsSync(path.join(c, 'messages', 'atay-pc.jsonl')));
  assert.ok(fs.existsSync(path.join(c, 'read.json')));
  assert.ok(r.moved.includes('peers.json') && r.moved.includes('keys/connect.json'));
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  assert.strictEqual(device.resolve(root, { home, hostname: 'H' }).device, 'laptop');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(path.join(dd, 'keys', 'connect.json')).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(dd).mode & 0o777, 0o700);
  }
});

test('migrate: second run is a no-op', T, (t) => {
  const home = tmpdir(t);
  const root = ws(t, owner());
  v1(root);
  device.migrate(root, { home });
  const before = [listing(home), listing(root)];
  const again = device.migrate(root, { home });
  assert.strictEqual(again.migrated, false);
  assert.ok(!again.conflict);
  assert.deepStrictEqual(again.moved, []);
  assert.deepStrictEqual([listing(home), listing(root)], before);
});

test('migrate: a different key already there changes nothing', T, (t) => {
  const home = tmpdir(t);
  const root = ws(t, owner());
  v1(root);
  const dd = device.deviceDir(home, 'serkan-adem-atay');
  put(path.join(dd, 'keys', 'connect.json'), { identity: { private: 'PRIVATE-B', public: 'PUBLIC-B' } });
  const before = [listing(home), listing(root)];
  const r = device.migrate(root, { home });
  assert.strictEqual(r.migrated, false);
  assert.strictEqual(r.conflict, true);
  assert.deepStrictEqual([listing(home), listing(root)], before);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});

test('migrate: the same key already there only retires the v1 copies', T, (t) => {
  const home = tmpdir(t);
  const root = ws(t, owner());
  v1(root);
  const dd = device.deviceDir(home, 'serkan-adem-atay');
  put(path.join(dd, 'keys', 'connect.json'), KEY);
  put(path.join(dd, 'peers.json'), { other: { keyid: 'k9' } });
  const r = device.migrate(root, { home });
  assert.strictEqual(r.migrated, true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dd, 'peers.json'), 'utf8')), { other: { keyid: 'k9' } }, 'device files are not overwritten');
  assert.ok(fs.existsSync(path.join(root, 'keys', 'connect.json.v1-backup')));
  assert.strictEqual(device.migrate(root, { home }).migrated, false);
});

test('migrate: a workspace with no v1 state is a no-op', T, (t) => {
  const home = tmpdir(t);
  const r = device.migrate(ws(t, owner()), { home });
  assert.strictEqual(r.migrated, false);
  assert.deepStrictEqual(fs.readdirSync(home), []);
});

test('address.parse', T, () => {
  assert.deepStrictEqual(address.parse('serkan'), { person: 'serkan', device: null, session: null });
  assert.deepStrictEqual(address.parse('serkan/laptop'), { person: 'serkan', device: 'laptop', session: null });
  assert.deepStrictEqual(address.parse('serkan/laptop/root'), { person: 'serkan', device: 'laptop', session: 'root' });
  for (const bad of ['', 'a/b/c/d', 'Serkan', 'a/B', '..', 'a/..', 'a/../b', '.', 'a//b', 'a/', '/a', 'a b', null, undefined, 5]) {
    assert.strictEqual(address.parse(bad), null, String(bad));
  }
});

const peers = {
  laptop: { person: 'serkan', device: 'laptop', keyid: 'k1' },
  'atay-pc': { keyid: 'k2' },
  office: { person: 'serkan', device: 'office', keyid: 'k3' },
  sevgi: { person: 'sevgi', device: 'laptop', keyid: 'k4' },
};

test('address.targets: one segment', T, () => {
  assert.deepStrictEqual(address.targets('laptop', peers), [{ peer: 'laptop', to: null }, { peer: 'sevgi', to: null }]);
  assert.deepStrictEqual(address.targets('atay-pc', peers), [{ peer: 'atay-pc', to: null }], 'a flat v1 name still resolves');
  assert.deepStrictEqual(address.targets('serkan', peers), [{ peer: 'laptop', to: null }, { peer: 'office', to: null }]);
  assert.deepStrictEqual(address.targets('nobody', peers), []);
});

test('address.targets: person/device and person/device/session', T, () => {
  assert.deepStrictEqual(address.targets('serkan/laptop', peers), [{ peer: 'laptop', to: null }]);
  assert.deepStrictEqual(address.targets('sevgi/laptop', peers), [{ peer: 'sevgi', to: null }]);
  assert.deepStrictEqual(address.targets('serkan/office/root', peers), [{ peer: 'office', to: 'root' }]);
  assert.deepStrictEqual(address.targets('serkan/atay-pc', peers), [{ peer: 'atay-pc', to: null }], 'a record with no person yet matches on key');
  assert.deepStrictEqual(address.targets('serkan/atay-pc/x', peers), [{ peer: 'atay-pc', to: 'x' }]);
  assert.deepStrictEqual(address.targets('sevgi/office', peers), []);
  assert.deepStrictEqual(address.targets('a/b/c/d', peers), []);
  assert.deepStrictEqual(address.targets('Bad', peers), []);
  assert.deepStrictEqual(address.targets('serkan', null), []);
});
