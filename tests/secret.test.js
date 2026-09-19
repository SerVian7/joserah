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
