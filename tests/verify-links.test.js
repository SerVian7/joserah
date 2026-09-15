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

test('root raw/ is not scanned — relocate-raw.js moves the legacy dir here and its stale links must not fail the gate', (t) => {
  const d = ws(t, { 'raw/imports/x.md': '[gone](nope.md)\n', 'ok.md': 'hi\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0);
});

test('a wiki citation into raw/ is not broken when raw/ is absent (a clone before import, or before a machine ever ran /joserah:import)', (t) => {
  const d = ws(t, {
    '.joserah/knowledge/wiki/topics/x.md': '[source](../../../../raw/imports/2026-08-30/statement.pdf)\n',
  });
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('a wiki citation into the pre-migration .joserah/knowledge/raw is not broken when that tree is absent', (t) => {
  const d = ws(t, {
    '.joserah/knowledge/wiki/topics/x.md': '[source](../../raw/statement.pdf)\n',
  });
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('a genuinely mistyped raw/ citation is still caught when raw/ IS present', (t) => {
  const d = ws(t, {
    '.joserah/knowledge/wiki/topics/x.md': '[source](../../../../raw/imports/2026-08-30/statement.pdf)\n',
    'raw/imports/2026-08-30/other-file.md': 'x\n',
  });
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /statement\.pdf/);
});

test('root imports/ is not scanned — imported snapshots carry historical links', (t) => {
  const d = ws(t, { 'imports/2026-09-09-x/note.md': '[gone](nope.md)\n', 'ok.md': 'hi\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0);
});

test('a wiki citation into imports/ is not broken when imports/ is absent (a clone before any import)', (t) => {
  const d = ws(t, {
    '.joserah/knowledge/wiki/topics/x.md': '[source](../../../../imports/2026-09-09-x/statement.pdf)\n',
  });
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('a mistyped imports/ citation is still caught when imports/ IS present', (t) => {
  const d = ws(t, {
    '.joserah/knowledge/wiki/topics/x.md': '[source](../../../../imports/2026-09-09-x/statement.pdf)\n',
    'imports/2026-09-09-x/other-file.md': 'x\n',
  });
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /statement\.pdf/);
});

// Regression: --root-shell-only writing imports/README.md (added so a restored
// workspace gets the folder's explanation) materialises imports/ on disk, which
// used to flip a bare fs.existsSync check back to "present" and re-break
// every citation into it — undoing the fix above on exactly the restore
// route skills/backup/SKILL.md's own restore step exercises (doctor →
// --root-shell-only → re-run doctor). This walks that actual order.
test('--root-shell-only writing imports/README.md does not re-break an imports/ citation on restore', (t) => {
  const d = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', d, '--workspace', 'w']);
  fs.mkdirSync(path.join(d, '.joserah', 'knowledge', 'wiki', 'topics'), { recursive: true });
  fs.writeFileSync(path.join(d, '.joserah', 'knowledge', 'wiki', 'topics', 'x.md'),
    '# X\n\n[source](../../../../imports/statement.pdf)\n');
  // simulate a restore that never carried imports/ at all:
  fs.rmSync(path.join(d, 'imports'), { recursive: true, force: true });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0, 'clean before --root-shell-only');

  const rso = runTool('scaffold.js', ['--root-shell-only', '--target', d]);
  assert.strictEqual(rso.status, 0, rso.stderr);
  assert.ok(fs.existsSync(path.join(d, 'imports', 'README.md')), 'precondition: imports/README.md now exists');

  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 0, r.stdout + ' — an imports/ holding only its own template README.md must still count as absent');
});

// The same tolerance on the legacy root raw/, which the scaffold no longer
// writes: a workspace that has not run relocate-imports.js still has one, and
// a raw/ holding nothing but its own old template README.md carries no source
// material, so every citation into it must stay green.
test('a legacy raw/ holding only its own README.md still counts as absent', (t) => {
  const d = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', d, '--workspace', 'w']);
  fs.mkdirSync(path.join(d, '.joserah', 'knowledge', 'wiki', 'topics'), { recursive: true });
  fs.writeFileSync(path.join(d, '.joserah', 'knowledge', 'wiki', 'topics', 'x.md'),
    '# X\n\n[source](../../../../raw/imports/statement.pdf)\n');
  fs.mkdirSync(path.join(d, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(d, 'raw', 'README.md'), '# raw/ — IMMUTABLE\n');

  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 0, r.stdout + ' — a raw/ holding only its own template README.md must still count as absent');
});

test('a raw/ holding real content alongside the template README.md still catches a mistyped citation', (t) => {
  const d = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', d, '--workspace', 'w']);
  fs.mkdirSync(path.join(d, '.joserah', 'knowledge', 'wiki', 'topics'), { recursive: true });
  fs.writeFileSync(path.join(d, '.joserah', 'knowledge', 'wiki', 'topics', 'x.md'),
    '# X\n\n[source](../../../../raw/imports/statement.pdf)\n');
  // the legacy raw/ with its own README.md; add real content beside it
  // without the file the citation actually names:
  fs.mkdirSync(path.join(d, 'raw', 'imports'), { recursive: true });
  fs.writeFileSync(path.join(d, 'raw', 'README.md'), '# raw/ — IMMUTABLE\n');
  fs.writeFileSync(path.join(d, 'raw', 'imports', 'other-file.md'), 'x\n');
  const r = runTool('verify-links.js', [d]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /statement\.pdf/);
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

test('a wikilink with no matching note in the vault is reported broken', (t) => {
  const fs2 = require('fs');
  const path2 = require('path');
  const dir = path2.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs2.mkdirSync(path2.join(dir, '.joserah', 'knowledge', 'people'), { recursive: true });
  fs2.writeFileSync(path2.join(dir, '.joserah', 'knowledge', 'people', 'ada.md'),
    '# Ada\n\n- knows [[Nobody At All]]\n', 'utf8');
  const r = runTool('verify-links.js', [dir]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /Nobody At All/);
});

test('a wikilink that matches a note title resolves', (t) => {
  const fs2 = require('fs');
  const path2 = require('path');
  const dir = path2.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const people = path2.join(dir, '.joserah', 'knowledge', 'people');
  fs2.mkdirSync(people, { recursive: true });
  fs2.writeFileSync(path2.join(people, 'grace.md'), '# Grace Hopper\n', 'utf8');
  fs2.writeFileSync(path2.join(people, 'ada.md'), '# Ada\n\n- knows [[Grace Hopper]]\n', 'utf8');
  const r = runTool('verify-links.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
});

test('hidden directories other than .joserah/.claude are not scanned', (t) => {
  const d = ws(t, { '.codex/notes/x.md': '[gone](nope.md)\n', '.joserah/knowledge/wiki/a.md': 'ok\n', 'ok.md': 'hi\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0);
});

test('a broken link inside .joserah is still caught (hidden but kept)', (t) => {
  const d = ws(t, { '.joserah/knowledge/wiki/a.md': '[gone](nope.md)\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 1);
});

test('scanIgnore prefixes from config.json are not scanned', (t) => {
  const d = ws(t, {
    '.joserah/config.json': JSON.stringify({ scanIgnore: ['tmp', 'old-docs/archive'] }),
    'tmp/x.md': '[gone](nope.md)\n',
    'old-docs/archive/y.md': '[gone](nope.md)\n',
    'old-docs/live.md': 'fine\n',
  });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0);
});

test('a malformed config.json does not break the link check', (t) => {
  const d = ws(t, { '.joserah/config.json': '{not json', 'a.md': '[b](b.md)\n', 'b.md': '\n' });
  assert.strictEqual(runTool('verify-links.js', [d]).status, 0);
});
