'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

test('measure-stage reports would-be-staged size without writing objects', (t) => {
  const dir = tmpdir(t);
  const g = (a) => require('child_process').spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  if (g(['--version']).status !== 0) return t.skip('git unavailable');
  g(['init']);
  fs.writeFileSync(path.join(dir, 'small.md'), 'note\n');
  fs.writeFileSync(path.join(dir, 'big.bin'), Buffer.alloc(11 * 1048576));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.bin\n');
  fs.writeFileSync(path.join(dir, 'ignored.bin'), Buffer.alloc(1048576));
  const r = runTool('measure-stage.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.files, 3); // small.md, big.bin, .gitignore — ignored.bin honoured
  assert.strictEqual(out.over10MB.length, 1);
  assert.match(out.over10MB[0].path, /big\.bin/);
  assert.ok(out.nonText >= 1);
  // nothing was staged and no blob was written:
  const objects = path.join(dir, '.git', 'objects');
  const loose = fs.readdirSync(objects).filter((d) => /^[0-9a-f]{2}$/.test(d));
  assert.strictEqual(loose.length, 0, 'no objects written by measuring');
});

test('measure-stage exits 1 outside a repository', (t) => {
  const dir = tmpdir(t);
  const r = runTool('measure-stage.js', [dir]);
  assert.strictEqual(r.status, 1);
});
