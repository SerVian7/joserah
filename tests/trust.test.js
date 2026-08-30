'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
const pd = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));

test('denyFor owner returns exactly the base set', () => {
  const result = pd.denyFor('owner');
  assert.deepStrictEqual(result, pd.PERMISSION_DENY);
  assert.notStrictEqual(result, pd.PERMISSION_DENY, 'returns a copy, not the original');
});

test('denyFor owner copy is independent of the original', () => {
  const result = pd.denyFor('owner');
  result.push('mutated');
  assert.strictEqual(pd.PERMISSION_DENY.length, 9, 'original unchanged after mutation');
});

test('denyFor guest adds machine-control rules on top of the base set', () => {
  const rules = pd.denyFor('guest');
  for (const base of pd.PERMISSION_DENY) assert.ok(rules.includes(base), `keeps ${base}`);
  assert.ok(rules.some((r) => /shutdown/.test(r)), 'denies shutdown');
  assert.ok(rules.some((r) => /taskkill/.test(r)), 'denies taskkill');
  assert.ok(rules.some((r) => /docker/.test(r)), 'denies docker');
});

test('denyFor guest walls off each declared host path for read, edit and write', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['d:/atay'] });
  assert.ok(rules.includes('Read(//d/atay/**)'));
  assert.ok(rules.includes('Edit(//d/atay/**)'));
  assert.ok(rules.includes('Write(//d/atay/**)'));
});

test('denyFor rejects an unknown trust level rather than guessing', () => {
  assert.throws(() => pd.denyFor('sandboxed'), /unknown trust level/i);
});

test('toRulePath normalizes Windows paths with trailing slashes', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['d:/atay/'] });
  assert.ok(rules.includes('Read(//d/atay/**)'));
  assert.ok(rules.includes('Edit(//d/atay/**)'));
  assert.ok(rules.includes('Write(//d/atay/**)'));
});

test('toRulePath handles POSIX absolute paths for non-Windows hosts', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['/home/ubuntu'] });
  assert.ok(rules.includes('Read(//home/ubuntu/**)'));
  assert.ok(rules.includes('Edit(//home/ubuntu/**)'));
  assert.ok(rules.includes('Write(//home/ubuntu/**)'));
});

const fs = require('fs');
const { tmpdir, runTool } = require('./helpers');

test('scaffold defaults to owner trust and records formatVersion 2', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.trust, 'owner');
  assert.strictEqual(cfg.formatVersion, 2);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepStrictEqual(s.permissions.deny, pd.PERMISSION_DENY);
});

test('scaffold --trust guest records it and writes the guest deny set', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js',
    ['--target', dir, '--workspace', 'w', '--trust', 'guest', '--host-path', 'd:/atay']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.trust, 'guest');
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.permissions.deny.includes('Read(//d/atay/**)'));
  assert.ok(s.permissions.deny.some((r2) => /shutdown/.test(r2)));
});

test('scaffold --assistant records the assistant name', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--assistant', 'Rıfkı']);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.assistantName, 'Rıfkı');
});

test('scaffold no longer writes CLAUDE.md', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md is written');
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')), 'CLAUDE.md is not');
});

test('scaffold rejects an unknown trust level instead of guessing', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--trust', 'sandboxed']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /trust/i);
});
