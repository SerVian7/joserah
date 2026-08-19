'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

function ws(t, files) {
  const d = path.join(tmpdir(t), 'ws');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(d, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return d;
}

test('I6: a % in a link target does not crash the checker', (t) => {
  const d = ws(t, { 'a.md': '[cache](%USERPROFILE%/.claude)\n' });
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 1, 'reported broken, not crashed');
  assert.match(r.stdout, /%USERPROFILE%/);
  assert.doesNotMatch(r.stderr, /URIError/);
});

test('I10: markdown under .joserah/knowledge/raw is not scanned', (t) => {
  const d = ws(t, { '.joserah/knowledge/raw/imports/x.md': '[gone](nope.md)\n', 'ok.md': 'hi\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0);
});

test('M16: link targets containing spaces are checked', (t) => {
  const d = ws(t, { 'a.md': '[n](My Notes.md)\n', 'My Notes.md': 'x\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0);
  const d2 = ws(t, { 'a.md': '[n](No Such File.md)\n' });
  assert.strictEqual(runTool('verify-links.js', [d2]).status, 1);
});

test('M17: case-mismatched target is broken even on Windows', (t) => {
  const d = ws(t, { 'a.md': '[n](Notes.md)\n', 'notes.md': 'x\n' });
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /Notes\.md/);
});

test('backslash separators in a target are reported broken', (t) => {
  const d = ws(t, { 'a.md': '[n](.joserah\\note.md)\n', '.joserah/note.md': 'x\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 1);
});

test('a broken link inside .superpowers/ scratch is skipped, but the same broken link in the workspace proper still fails', (t) => {
  const d = ws(t, {
    '.superpowers/2026-08-19-plan/review.md': '[gone](nope.md)\n',
    'ok.md': 'hi\n',
  });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0, '.superpowers/ scratch is not scanned');

  const d2 = ws(t, { 'a.md': '[gone](nope.md)\n' });
  assert.strictEqual(runTool('verify-links.js', [d2]).status, 1, 'a real broken link outside .superpowers/ still fails');
});
