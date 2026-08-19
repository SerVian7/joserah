'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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

test('secret-scan reports every same-pattern secret on a shared line, not just the first', (t) => {
  const d = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(d, { recursive: true });
  const s1 = 'sk-' + 'a1b2c3d4'.repeat(3);
  const s2 = 'sk-' + 'e5f6a7b8'.repeat(3);
  fs.writeFileSync(path.join(d, 'two.md'), `first ${s1} second ${s2}\n`);
  const r = runTool('secret-scan.js', [d]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /2 credential-shaped strings found/);
  const hitLines = r.stdout.split('\n').filter((l) => l.startsWith('two.md:1'));
  assert.strictEqual(hitLines.length, 2, 'both secrets on the line are reported, not just the first');
  assert.ok(!r.stdout.includes(s1) && !r.stdout.includes(s2), 'neither secret is echoed whole');
});

test('secret-scan does not report clean on a fresh git init with an unstaged secret', (t) => {
  // Regression for the bug where `git ls-files` on a just-initialized repo
  // succeeds with empty stdout (nothing staged yet), and an empty-but-truthy
  // tracked-file list short-circuited the fallback filesystem walk — so the
  // scan examined zero files and still printed "clean". This is exactly the
  // state the backup skill's safety gate is in immediately after `git init`
  // and before `git add`.
  const d = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: d });
  const secret = 'sk-' + 'a1b2c3d4'.repeat(3);
  fs.writeFileSync(path.join(d, 'note.md'), `api key: ${secret}\n`);
  const r = runTool('secret-scan.js', [d]);
  assert.strictEqual(r.status, 1, 'an untracked planted secret must be found even when the git index is empty');
  assert.match(r.stdout, /note\.md:1/);
  assert.ok(!r.stdout.includes(secret), 'secret never echoed whole');
});

test('secret-scan does not report a clean tree when a listed file cannot be read', (t) => {
  const d = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: d });
  const ghost = path.join(d, 'ghost.md');
  fs.writeFileSync(ghost, 'nothing suspicious here\n');
  spawnSync('git', ['add', 'ghost.md'], { cwd: d });
  fs.unlinkSync(ghost); // still tracked in the git index, but gone from disk
  const r = runTool('secret-scan.js', [d]);
  assert.strictEqual(r.status, 2, 'an unreadable tracked file must not report exit 0');
  assert.match(r.stderr, /ghost\.md/);
  assert.ok(!r.stdout.includes('No credential-shaped content found'), 'must not claim clean');
});
