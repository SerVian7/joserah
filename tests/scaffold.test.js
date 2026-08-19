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
