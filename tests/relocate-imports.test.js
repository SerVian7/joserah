'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

function wsWithRootRaw(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.rmSync(path.join(dir, 'imports'), { recursive: true }); // pre-rename workspace has raw/, not imports/
  fs.mkdirSync(path.join(dir, 'raw', 'imports', '2026-09-09-x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw', 'imports', '2026-09-09-x', 'source.md'), '# immutable source\n');
  fs.mkdirSync(path.join(dir, 'raw', 'finance'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw', 'finance', 'statement.txt'), 'x\n');
  fs.writeFileSync(path.join(dir, 'raw', 'README.md'), '# raw/ — IMMUTABLE\n\nold template\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').replace(/^imports\/$/m, 'raw/'));
  const wiki = path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities');
  fs.mkdirSync(wiki, { recursive: true });
  fs.writeFileSync(path.join(wiki, 'thing.md'),
    '# Thing\n\nSource: [source](../../../../raw/imports/2026-09-09-x/source.md) and [bank](../../../../raw/finance/statement.txt)\n');
  return dir;
}

test('relocate-imports moves raw/ to imports/, flattens raw/imports/*, rewrites links', (t) => {
  const dir = wsWithRootRaw(t);
  const r = runTool('relocate-imports.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.moved, true);
  assert.strictEqual(out.linksRewritten, 2);
  assert.ok(fs.existsSync(path.join(dir, 'imports', '2026-09-09-x', 'source.md')), 'flattened');
  assert.ok(fs.existsSync(path.join(dir, 'imports', 'finance', 'statement.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'raw')), 'raw/ gone');
  const note = fs.readFileSync(path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities', 'thing.md'), 'utf8');
  assert.match(note, /\]\(\.\.\/\.\.\/\.\.\/\.\.\/imports\/2026-09-09-x\/source\.md\)/);
  assert.match(note, /\]\(\.\.\/\.\.\/\.\.\/\.\.\/imports\/finance\/statement\.txt\)/);
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /^imports\/$/m);
  assert.doesNotMatch(gi, /^raw\/$/m);
  assert.strictEqual(runTool('verify-links.js', [dir]).status, 0, 'links resolve after the move');
});

test('relocate-imports is a no-op when there is no root raw/', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const r = runTool('relocate-imports.js', [dir]);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout.trim()), { moved: false, linksRewritten: 0, notesTouched: 0, flattened: 0 });
});

test('relocate-imports refuses when imports/ already holds owner content', (t) => {
  const dir = wsWithRootRaw(t);
  fs.mkdirSync(path.join(dir, 'imports', '2026-01-01-existing'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'imports', '2026-01-01-existing', 'a.md'), 'x\n');
  const r = runTool('relocate-imports.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not empty/);
});

test('--dry-run changes nothing', (t) => {
  const dir = wsWithRootRaw(t);
  const r = runTool('relocate-imports.js', [dir, '--dry-run']);
  assert.strictEqual(r.status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'raw', 'finance', 'statement.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'imports')));
});
