'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

test('scaffold creates root keys/AGENTS.md and keys-rooted gitignore', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'keys', 'AGENTS.md')), 'keys/AGENTS.md at root');
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'keys')), 'no legacy keys dir');
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /^keys\/\*$/m);
  assert.match(gi, /^!keys\/AGENTS\.md$/m);
});

test('permission-deny lib exports 9 rules on ./keys/**', () => {
  const { PERMISSION_DENY } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));
  assert.strictEqual(PERMISSION_DENY.length, 9);
  for (const rule of PERMISSION_DENY) assert.match(rule, /\.\/keys\/\*\*/);
});

test('I1: fresh scaffold writes .claude/settings.json with all deny rules', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const { PERMISSION_DENY } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));
  assert.deepStrictEqual(s.permissions.deny, PERMISSION_DENY);
});

test('K3: --settings-only on a workspace without .claude/ writes the file, exit 0', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const r = runTool('scaffold.js', ['--settings-only', '--target', dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')));
});

test('M15: config.json with a BOM is still readable by identity-only', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  fs.writeFileSync(cfgPath, '\uFEFF' + fs.readFileSync(cfgPath, 'utf8'));
  const r = runTool('scaffold.js', ['--identity-only', '--target', dir, '--owner', 'O', '--language', 'en']);
  assert.strictEqual(r.status, 0, r.stderr);
});
