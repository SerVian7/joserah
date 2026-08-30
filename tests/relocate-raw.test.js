'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

function legacyWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  // recreate the pre-relocation layout scaffold no longer produces:
  const old = path.join(dir, '.joserah', 'knowledge', 'raw', 'imports');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'source.md'), '# immutable source\n');
  // a wiki note that cites it with a relative link:
  const wiki = path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities');
  fs.mkdirSync(wiki, { recursive: true });
  fs.writeFileSync(path.join(wiki, 'thing.md'),
    '# Thing\n\nSource: [source](../../raw/imports/source.md)\n');
  return dir;
}

test('relocates knowledge/raw to the root and rewrites citing links', (t) => {
  const dir = legacyWs(t);
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'raw', 'imports', 'source.md')), 'moved to root');
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'old dir gone');
  const note = fs.readFileSync(path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities', 'thing.md'), 'utf8');
  assert.match(note, /\(\.\.\/\.\.\/\.\.\/\.\.\/raw\/imports\/source\.md\)/, 'link climbs to the root');
  const links = runTool('verify-links.js', [dir]);
  assert.strictEqual(links.status, 0, 'no broken links after relocation: ' + links.stdout);
});

test('preserves an owner-edited README.md under the old raw/ instead of discarding it', (t) => {
  const dir = legacyWs(t);
  // The old location may carry its own README.md from the pre-migration
  // template. scaffold.js already wrote the *current* template's README.md
  // at the root (see legacyWs/scaffold.js). Simulate an owner who annotated
  // the old one, so its bytes differ from what is now at the root.
  const oldReadme = path.join(dir, '.joserah', 'knowledge', 'raw', 'README.md');
  fs.writeFileSync(oldReadme, '# raw/ — IMMUTABLE\n\nOwner note: do not touch, ever.\n');
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.strictEqual(summary.preservedReadme, 'raw/README.old.md');
  const preserved = fs.readFileSync(path.join(dir, 'raw', 'README.old.md'), 'utf8');
  assert.match(preserved, /Owner note: do not touch, ever\./, 'owner content survives, not deleted');
  // The root's own (current-template) README.md is untouched by the merge.
  assert.ok(fs.existsSync(path.join(dir, 'raw', 'README.md')), 'root README.md still present');
});

test('is a no-op when there is nothing to relocate, exit 0', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /"moved":\s*false/);
});

test('refuses when the root already has a non-empty raw/ of its own', (t) => {
  const dir = legacyWs(t);
  // scaffold.js already put raw/README.md here (Tasks 1-3); add real owner
  // content alongside it to create a genuine collision.
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw', 'existing.md'), 'x\n');
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.ok(fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'nothing was moved');
});

test('--dry-run reports and changes nothing', (t) => {
  const dir = legacyWs(t);
  const r = runTool('relocate-raw.js', [dir, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'still in place');
});
