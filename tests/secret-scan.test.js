'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

test('secret-scan finds a pasted key in markdown and masks it in output', (t) => {
  const d = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(d, { recursive: true });
  const secret = 'sk-' + 'a1b2c3d4'.repeat(3);
  fs.writeFileSync(path.join(d, 'note.md'), `api key: ${secret}\n`);
  const r = runTool('secret-scan.js', [d]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /note\.md:1/);
  assert.ok(!r.stdout.includes(secret), 'secret never echoed whole');
});

test('secret-scan skips keys/ and exits 0 on a clean tree', (t) => {
  const d = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(path.join(d, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(d, 'keys', 'x.json'), '{"token":"sk-' + 'z'.repeat(24) + '"}');
  fs.writeFileSync(path.join(d, 'ok.md'), 'nothing here\n');
  assert.strictEqual(runTool('secret-scan.js', [d]).status, 0);
});
