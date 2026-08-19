'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

function make(dir, rel, content = 'x') {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function listZip(zip) {
  const r = runTool('archive.js', ['list', zip]);
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}

test('K1: keys exclusion is case-insensitive and covers the legacy path', (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, 'Keys/token.txt', 'secret');
  make(ws, '.joserah/Keys/old-token.txt', 'secret');
  make(ws, 'note.md');
  const r = runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  assert.strictEqual(r.status, 0, r.stderr);
  const names = listZip(path.join(d, 'o.zip'));
  assert.deepStrictEqual(names, ['note.md']);
});

test('I4: nested dir named projects IS archived; root projects/ is not', (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, '.joserah/knowledge/projects/note.md');
  make(ws, 'projects/real-checkout/file.md');
  runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  const names = listZip(path.join(d, 'o.zip'));
  assert.ok(names.includes('.joserah/knowledge/projects/note.md'));
  assert.ok(!names.some((n) => n.startsWith('projects/')));
});

test('I5+M5: symlinks are skipped and reported, not fatal', { skip: process.platform !== 'win32' && 'symlink test tuned for win32 junctions' }, (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, 'real/file.md');
  fs.mkdirSync(path.join(d, 'outside'));
  fs.symlinkSync(path.join(d, 'outside'), path.join(ws, 'link'), 'junction');
  const r = runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.skipped, ['link']);
});

test('M2: empty directories survive the round trip', (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, 'a/file.md');
  fs.mkdirSync(path.join(ws, 'empty'), { recursive: true });
  runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  const target = path.join(d, 'out');
  const r = runTool('archive.js', ['extract', path.join(d, 'o.zip'), target]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.statSync(path.join(target, 'empty')).isDirectory());
});
