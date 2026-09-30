'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

// A workspace marker is all the tool needs; values here are fake.
function ws(t) {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{}');
  return dir;
}
const store = (dir) => path.join(dir, 'keys', 'secrets.json');
const run = (dir, args, input) => runTool('secret.js', args, { cwd: dir, input });

test('secret: set creates the store, list/has/get read it, nothing echoes the value', (t) => {
  const dir = ws(t);
  const set = run(dir, ['--set', 'acme.api.token'], 'fake-value-1\n');
  assert.strictEqual(set.status, 0, set.stderr);
  assert.strictEqual(set.stdout.trim(), 'saved: acme.api.token');
  const doc = JSON.parse(fs.readFileSync(store(dir), 'utf8'));
  assert.ok(doc._readme);
  assert.strictEqual(doc.secrets['acme.api.token'], 'fake-value-1');

  run(dir, ['--set', 'acme.db.password'], 'fake-value-2');
  const list = run(dir, ['--list']);
  assert.deepStrictEqual(list.stdout.trim().split(/\r?\n/), ['acme.api.token', 'acme.db.password']);
  assert.doesNotMatch(list.stdout, /fake-value/);

  assert.strictEqual(run(dir, ['--has', 'acme.api.token']).status, 0);
  const miss = run(dir, ['--has', 'acme.nope']);
  assert.strictEqual(miss.status, 2);
  assert.doesNotMatch(miss.stdout + miss.stderr, /fake-value/);

  assert.strictEqual(run(dir, ['acme.api.token']).stdout, 'fake-value-1');
  const nf = run(dir, ['acme.api.tokn']);
  assert.strictEqual(nf.status, 2);
  assert.match(nf.stderr, /acme\.api\.token/);
  assert.doesNotMatch(nf.stderr, /fake-value/);
});

test('secret: overwrite needs --force and keeps a .bak', (t) => {
  const dir = ws(t);
  run(dir, ['--set', 'a.b.pin'], 'old');
  const refused = run(dir, ['--set', 'a.b.pin'], 'new');
  assert.strictEqual(refused.status, 1);
  assert.strictEqual(run(dir, ['a.b.pin']).stdout, 'old');
  assert.strictEqual(run(dir, ['--set', 'a.b.pin', '--force'], 'new').status, 0);
  assert.strictEqual(run(dir, ['a.b.pin']).stdout, 'new');
  assert.strictEqual(JSON.parse(fs.readFileSync(store(dir) + '.bak', 'utf8')).secrets['a.b.pin'], 'old');
  assert.ok(!fs.existsSync(store(dir) + '.tmp'));
});

test('secret: bad names and empty stdin are refused', (t) => {
  const dir = ws(t);
  for (const name of ['nodot', 'Upper.case', 'a..b', 'a.b c', '.a.b']) {
    assert.strictEqual(run(dir, ['--set', name], 'v').status, 1, name);
  }
  assert.strictEqual(run(dir, ['--set', 'a.b'], '').status, 1);
  assert.ok(!fs.existsSync(store(dir)));
});

test('secret: a BOM in the store is tolerated; no workspace is exit 3', (t) => {
  const dir = ws(t);
  fs.mkdirSync(path.join(dir, 'keys'));
  fs.writeFileSync(store(dir), '﻿' + JSON.stringify({ _readme: 'x', secrets: { 'x.y.user': 'u' } }));
  assert.strictEqual(run(dir, ['x.y.user']).stdout, 'u');
  assert.strictEqual(run(path.join(dir, 'keys'), ['x.y.user']).stdout, 'u', 'found from a subdirectory');
  assert.strictEqual(run(tmpdir(t), ['--list']).status, 3);
});

test('scaffold installs the local secret.js and an empty store', (t) => {
  const dir = path.join(tmpdir(t), 'w');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const doc = JSON.parse(fs.readFileSync(store(dir), 'utf8'));
  assert.deepStrictEqual(doc.secrets, {});
  const local = path.join(dir, '.joserah', 'tools', 'secret.js');
  assert.ok(fs.existsSync(local));
  // The local copy resolves its own workspace wherever it is called from.
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [local, '--set', 'w.x.token'], { cwd: tmpdir(t), input: 'v', encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(store(dir), 'utf8')).secrets['w.x.token'], 'v');
});

const index = (dir) => fs.readFileSync(path.join(dir, '.joserah', 'vault-index.md'), 'utf8');

test('secret: --index writes a names-only index, grouped by scope, no values', (t) => {
  const dir = ws(t);
  run(dir, ['--set', 'corlu.cam1.host'], 'fake-10.0.0.5');
  run(dir, ['--set', 'acme.api.api-token'], 'fake-SECRET-1234');
  fs.rmSync(path.join(dir, '.joserah', 'vault-index.md'), { force: true });
  const r = run(dir, ['--index']);
  assert.strictEqual(r.status, 0, r.stderr);
  const idx = index(dir);
  assert.match(idx, /^# Vault index/);
  assert.match(idx, /## acme\n\n- acme\.api\.api-token\n/);
  assert.match(idx, /## corlu\n\n- corlu\.cam1\.host\n/);
  assert.ok(idx.indexOf('## acme') < idx.indexOf('## corlu'), 'sorted');
  assert.doesNotMatch(idx + r.stdout + r.stderr, /fake-/);
});

test('secret: --set keeps the index current; --index on no store writes an empty one', (t) => {
  const dir = ws(t);
  assert.strictEqual(run(dir, ['--index']).status, 0);
  assert.doesNotMatch(index(dir), /^- /m);
  run(dir, ['--set', 'x.y.pin'], 'fake-1');
  assert.match(index(dir), /- x\.y\.pin/);
});

test('secret: --import flattens nested JSON into dotted names, never prints a value', (t) => {
  const dir = ws(t);
  const src = path.join(dir, 'old.json');
  fs.writeFileSync(src, JSON.stringify({ Corlu: { cam1: { user: 'fake-admin', password: 'fake p w' } }, 'Main Router': { api_key: 'fake-rk' } }));
  const r = run(dir, ['--import', src]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(run(dir, ['corlu.cam1.password']).stdout, 'fake p w');
  assert.strictEqual(run(dir, ['corlu.cam1.user']).stdout, 'fake-admin');
  assert.strictEqual(run(dir, ['main-router.api-key']).stdout, 'fake-rk');
  assert.match(r.stdout, /imported corlu\.cam1\.user/);
  assert.match(r.stdout, /3 imported, 0 unchanged, 0 skipped/);
  assert.doesNotMatch(r.stdout + r.stderr, /fake/);
  assert.match(index(dir), /- corlu\.cam1\.password/);
  assert.ok(fs.existsSync(src), 'source kept without --delete');
});

test('secret: --import reads .env exactly — export, quotes, spaces; an empty value is listed, not stored', (t) => {
  const dir = ws(t);
  const src = path.join(dir, 'app.env');
  fs.writeFileSync(src, '# comment\r\nexport DB_PASS="fake va lue"\r\nAPI_TOKEN=fake-tok # note\r\nEMPTY=\r\nQUOTED=\'fake #kept\'\r\n');
  const r = run(dir, ['--import', src, '--prefix', 'acme']);
  assert.strictEqual(r.status, 1);
  assert.strictEqual(run(dir, ['acme.env.db-pass']).stdout, 'fake va lue');
  assert.strictEqual(run(dir, ['acme.env.api-token']).stdout, 'fake-tok');
  assert.strictEqual(run(dir, ['acme.env.quoted']).stdout, 'fake #kept');
  assert.match(r.stdout, /skipped acme\.env\.empty: empty/);
  assert.strictEqual(run(dir, ['--has', 'acme.env.empty']).status, 2);
  assert.doesNotMatch(r.stdout + r.stderr, /fake/);
});

test('secret: --import never overwrites — a different value is a listed conflict, exit 1, --delete refused', (t) => {
  const dir = ws(t);
  run(dir, ['--set', 'corlu.cam1.user'], 'fake-old');
  run(dir, ['--set', 'corlu.cam1.pin'], 'fake-same');
  const src = path.join(dir, 'old.json');
  fs.writeFileSync(src, JSON.stringify({ corlu: { cam1: { user: 'fake-new', pin: 'fake-same', host: 'fake-h' } } }));
  const r = run(dir, ['--import', src, '--delete']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /skipped corlu\.cam1\.user: exists with a different value/);
  assert.match(r.stdout, /1 imported, 1 unchanged, 1 skipped/);
  assert.strictEqual(run(dir, ['corlu.cam1.user']).stdout, 'fake-old');
  assert.ok(fs.existsSync(src), 'a partial import keeps its source');
  assert.doesNotMatch(r.stdout + r.stderr, /fake/);
  // Fully successful now that the conflict is resolved: --delete removes the source.
  run(dir, ['--set', 'corlu.cam1.user', '--force'], 'fake-new');
  assert.strictEqual(run(dir, ['--import', src, '--delete']).status, 0);
  assert.ok(!fs.existsSync(src));
});

test('secret: --import refuses the store itself', (t) => {
  const dir = ws(t);
  run(dir, ['--set', 'a.b.pin'], 'fake-1');
  assert.strictEqual(run(dir, ['--import', store(dir), '--delete']).status, 1);
  assert.ok(fs.existsSync(store(dir)));
});

test('secret: --rename moves a name without showing the value; refuses a taken or bad name', (t) => {
  const dir = ws(t);
  run(dir, ['--set', 'env.db-pass'], 'fake-1');
  run(dir, ['--set', 'acme.db.user'], 'fake-2');
  const r = run(dir, ['--rename', 'env.db-pass', 'acme.db.password']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /fake/);
  assert.strictEqual(run(dir, ['acme.db.password']).stdout, 'fake-1');
  assert.strictEqual(run(dir, ['--has', 'env.db-pass']).status, 2);
  assert.match(index(dir), /- acme\.db\.password/);
  assert.doesNotMatch(index(dir), /env\.db-pass/);
  assert.strictEqual(run(dir, ['--rename', 'acme.db.password', 'acme.db.user']).status, 1, 'taken');
  assert.strictEqual(run(dir, ['--rename', 'acme.db.password', 'Bad Name']).status, 1, 'invalid');
  assert.strictEqual(run(dir, ['--rename', 'nope.x', 'acme.db.other']).status, 2, 'missing');
  assert.strictEqual(run(dir, ['acme.db.user']).stdout, 'fake-2');
});

// 0.15.1 (ctrl server): a collector's record array was flattened by index into
// 382 names like `0.value` and `0.found-in.3`.
test('secret: --import reads a record array by record, metadata left out, duplicates numbered', (t) => {
  const dir = ws(t);
  const src = path.join(dir, 'collected.json');
  fs.writeFileSync(src, JSON.stringify([
    { name: 'Ctrl root', system: 'Ctrl Server', kind: 'password', username: 'fake-root', value: 'fake-p1', collected: '2026-09-01', 'found-in': ['a.md', 'b.md'] },
    { name: 'Ctrl root 2', system: 'Ctrl Server', kind: 'Password', value: 'fake-p2', 'found-in': [] },
    { name: 'Sheets', system: 'Sheets', kind: 'API Key', value: 'fake-k', note: 'fake-n' },
  ]));
  assert.match(run(dir, ['--import', src]).stderr, /record array — its names need --prefix/);
  const r = run(dir, ['--import', src, '--prefix', 'zg']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(run(dir, ['--list']).stdout.trim().split(/\r?\n/),
    ['zg.ctrl-server.password', 'zg.ctrl-server.password-2', 'zg.ctrl-server.user', 'zg.sheets.api-token', 'zg.sheets.note']);
  assert.match(r.stdout, /duplicate zg\.ctrl-server\.password -> zg\.ctrl-server\.password-2/);
  assert.strictEqual(run(dir, ['zg.ctrl-server.password-2']).stdout, 'fake-p2');
  assert.strictEqual(run(dir, ['zg.ctrl-server.user']).stdout, 'fake-root');
  assert.strictEqual(run(dir, ['zg.sheets.api-token']).stdout, 'fake-k');
  assert.doesNotMatch(r.stdout + r.stderr, /fake/);
});

test('secret: --import --replace counts and refuses without --yes, empties the store with it', (t) => {
  const dir = ws(t);
  run(dir, ['--set', 'old.one.pin'], 'fake-1');
  run(dir, ['--set', 'old.two.pin'], 'fake-2');
  const src = path.join(dir, 'new.json');
  fs.writeFileSync(src, JSON.stringify({ acme: { db: { password: 'fake-3' } } }));
  const no = run(dir, ['--import', src, '--replace']);
  assert.strictEqual(no.status, 1);
  assert.match(no.stderr, /would delete all 2 name\(s\).*--yes/);
  assert.strictEqual(run(dir, ['--has', 'old.one.pin']).status, 0, 'nothing deleted without --yes');
  const yes = run(dir, ['--import', src, '--replace', '--yes']);
  assert.strictEqual(yes.status, 0, yes.stderr);
  assert.deepStrictEqual(run(dir, ['--list']).stdout.trim().split(/\r?\n/), ['acme.db.password']);
});

test('secret: --import refuses what is not a vault and leaves it alone', (t) => {
  const dir = ws(t);
  const sa = path.join(dir, 'google-sa.json');
  fs.writeFileSync(sa, JSON.stringify({ type: 'service_account', project_id: 'fake', private_key: 'fake-key', client_email: 'fake@x' }));
  const r = run(dir, ['--import', sa, '--prefix', 'g']);
  assert.strictEqual(r.status, 4);
  assert.match(r.stderr, /not a vault: google-sa\.json \(a service-account key\)/);
  const other = path.join(dir, 'list.json');
  fs.writeFileSync(other, JSON.stringify({ hosts: ['a', 'b'] }));
  assert.strictEqual(run(dir, ['--import', other]).status, 4);
  assert.ok(!fs.existsSync(store(dir)), 'no store written');
});

// 0.15.1 (owner, 2026-09-30): saving a secret is one line the owner runs; with
// nothing piped, --set asks for the value with echo off. A real console cannot
// be driven headlessly, so a preload stands one in: stdin claims to be a TTY
// and readline answers the question with what the owner "typed".
test('secret: --set with a terminal asks for the value, echoes nothing, stores it', (t) => {
  const dir = ws(t);
  const fake = path.join(dir, 'fake-tty.js');
  fs.writeFileSync(fake, [
    "Object.defineProperty(process.stdin, 'isTTY', { value: true });",
    "const rl = require('readline');",
    "rl.createInterface = () => ({ question(q, cb) { process.stderr.write('ASKED:' + q); cb(process.env.FAKE_TYPED); }, close() {} });",
  ].join('\n'));
  const { spawnSync } = require('child_process');
  const { PLUGIN_ROOT } = require('./helpers');
  const go = (typed) => spawnSync(process.execPath, ['-r', fake, path.join(PLUGIN_ROOT, 'tools', 'secret.js'), '--set', 'acme.db.password'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, FAKE_TYPED: typed } });
  const empty = go('');
  assert.strictEqual(empty.status, 1);
  assert.ok(!fs.existsSync(store(dir)), 'an empty value is refused');
  const r = go('fake-typed-pw');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /ASKED:Value for acme\.db\.password: /);
  assert.strictEqual(r.stdout.trim(), 'saved: acme.db.password');
  assert.doesNotMatch(r.stdout + r.stderr, /fake-typed/);
  assert.strictEqual(run(dir, ['acme.db.password']).stdout, 'fake-typed-pw');
  assert.match(index(dir), /- acme\.db\.password/);
});
