'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');

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

test('root raw/ is never scanned — vendor docs full of api_key=… are not the owner\'s notes', (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, 'raw', 'vendor-manual.md'), 'password: s3cr3t-9real-value\n');
  const r = runTool('secret-scan.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
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

test('placeholder values are not findings', (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, 'note.md'), [
    'api_key=bbbbbb',            // repeated single character
    'Password: <SIFRE>',         // angle-bracket placeholder
    'token = ${API_TOKEN}',      // env-var reference
    'secret: [api_key]',         // bracketed field name
    'password=YOUR_PASSWORD_HERE',
    'passwd: changeme',
  ].join('\n') + '\n');
  const r = runTool('secret-scan.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('a real credential value still trips the scan', (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, 'note.md'), 'password: k9$Tr0uv-real\n');
  const r = runTool('secret-scan.js', [dir]);
  assert.strictEqual(r.status, 1);
});

test('prose starting with the word Basic is not a basic-auth hit', () => {
  const { SPECIFIC } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'redactions'));
  const line = 'Basic Configuration overview for the router';
  const hit = SPECIFIC.some(([re]) => { re.lastIndex = 0; return re.test(line); });
  assert.strictEqual(hit, false);
});

test('a real bearer token is still redacted', () => {
  const { redact } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'redactions'));
  assert.match(redact('Bearer x8f3-KQ9zW2mP0aH1').text, /\[redacted\]/);
});

test('--staged scans only what is staged', (t) => {
  const dir = tmpdir(t);
  const g = (a) => require('child_process').spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  if (g(['--version']).status !== 0) return t.skip('git unavailable');
  fs.mkdirSync(path.join(dir, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{}');
  g(['init']);
  fs.writeFileSync(path.join(dir, 'staged.md'), 'password: k9$Tr0uv-real\n');
  fs.writeFileSync(path.join(dir, 'unstaged.md'), 'password: a7!Wq2xx-real\n');
  g(['add', 'staged.md']);
  const r = runTool('secret-scan.js', [dir, '--staged']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /staged\.md/);
  assert.ok(!/unstaged\.md/.test(r.stdout), 'unstaged file not scanned');
});

test('--staged outside a git repository exits 2, never clean', (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{}');
  const r = runTool('secret-scan.js', [dir, '--staged'], { env: {} });
  assert.strictEqual(r.status, 2);
});
