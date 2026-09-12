'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');

function scaffolded(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  return dir;
}

// A workspace frozen at W0: source material still under .joserah/knowledge/raw,
// no imports/ at the root, and a wiki page citing the old location.
function atW0(t) {
  const dir = scaffolded(t);
  fs.rmSync(path.join(dir, 'imports'), { recursive: true });
  const old = path.join(dir, '.joserah', 'knowledge', 'raw', '2026-09-09-x');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'source.md'), '# immutable source\n');
  const wiki = path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities');
  fs.mkdirSync(wiki, { recursive: true });
  fs.writeFileSync(path.join(wiki, 'thing.md'),
    '# Thing\n\nSource: [source](../../raw/2026-09-09-x/source.md)\n');
  return dir;
}

// A workspace frozen at W1: raw/ at the root, nothing under .joserah/knowledge.
function atW1(t) {
  const dir = scaffolded(t);
  fs.rmSync(path.join(dir, 'imports'), { recursive: true });
  const old = path.join(dir, 'raw', '2026-09-09-x');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'source.md'), '# immutable source\n');
  const wiki = path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities');
  fs.mkdirSync(wiki, { recursive: true });
  fs.writeFileSync(path.join(wiki, 'thing.md'),
    '# Thing\n\nSource: [source](../../../../raw/2026-09-09-x/source.md)\n');
  return dir;
}

test('a workspace frozen at the oldest layout reaches imports/ in ONE command', (t) => {
  const dir = atW0(t);
  const r = runTool('relocate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.moved, true);
  assert.strictEqual(out.legs.length, 2);
  assert.ok(fs.existsSync(path.join(dir, 'imports', '2026-09-09-x', 'source.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'raw')), 'no root raw/ left behind');
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'no legacy tree left');
  const note = fs.readFileSync(path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities', 'thing.md'), 'utf8');
  assert.match(note, /\]\([^)]*imports\/2026-09-09-x\/source\.md\)/);
  assert.strictEqual(runTool('verify-links.js', [dir]).status, 0, 'links resolve after the chain');
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /^imports\/$/m);
  assert.doesNotMatch(gi, /^raw\/$/m);
});

test('a workspace frozen at the middle layout reaches imports/ with the same command', (t) => {
  const dir = atW1(t);
  const r = runTool('relocate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.moved, true);
  assert.ok(fs.existsSync(path.join(dir, 'imports', '2026-09-09-x', 'source.md')));
  assert.strictEqual(runTool('verify-links.js', [dir]).status, 0);
});

test('a workspace already at imports/ is a no-op, exit 0, and says nothing moved', (t) => {
  const dir = scaffolded(t);
  const r = runTool('relocate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.strictEqual(out.moved, false);
  assert.strictEqual(out.linksRewritten, 0);
});

test('--dry-run changes nothing and says which leg it cannot preview yet', (t) => {
  const dir = atW0(t);
  const r = runTool('relocate.js', [dir, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.dryRun, true);
  assert.ok(fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw', '2026-09-09-x', 'source.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'imports')));
  const second = out.legs[1];
  assert.strictEqual(second.tool, 'relocate-imports.js');
  assert.match(second.skipped, /after relocate-raw/);
});

test('a failing leg stops the chain, exit 1, and its own message is passed through', (t) => {
  const dir = atW1(t);
  fs.mkdirSync(path.join(dir, 'imports', '2026-01-01-existing'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'imports', '2026-01-01-existing', 'a.md'), 'x\n');
  const r = runTool('relocate.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not empty/);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.failedAt, 'relocate-imports.js');
});

test('relocate refuses a directory that is not a workspace', (t) => {
  const r = runTool('relocate.js', [tmpdir(t)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not a Joserah workspace/);
});

// The trap: relocate-raw.js reads templates/imports/README.md, a template that
// has already been renamed under it twice. A rename must break a test here,
// not a migration on someone's workspace.
test('both legs read the same source-material README template, and it exists', () => {
  const tpl = path.join(PLUGIN_ROOT, 'templates', 'imports', 'README.md');
  assert.ok(fs.existsSync(tpl), 'templates/imports/README.md');
  for (const leg of ['relocate-raw.js', 'relocate-imports.js']) {
    const src = fs.readFileSync(path.join(PLUGIN_ROOT, 'tools', leg), 'utf8');
    assert.match(src, /'templates',\s*'imports',\s*'README\.md'/,
      `${leg} must resolve the template as templates/imports/README.md`);
  }
});
