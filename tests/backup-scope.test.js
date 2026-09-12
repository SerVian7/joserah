'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool } = require('./helpers');

function git(dir, ...a) { return spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }); }

function repoWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'a@b.c');
  git(dir, 'config', 'user.name', 'A B');
  return dir;
}

test('--route zip says source material is IN and credentials are OUT', (t) => {
  const r = runTool('backup-scope.js', [repoWs(t), '--route', 'zip', '--json']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.excluded.keys, ['keys', '.joserah/keys']);
  assert.ok(out.included.some((s) => /imports/.test(s)), 'the zip route carries source material');
});

test('--route repo says source material is OUT', (t) => {
  const out = JSON.parse(runTool('backup-scope.js', [repoWs(t), '--route', 'repo', '--json']).stdout);
  assert.ok(out.excluded.sourceMaterial.includes('imports'));
});

test('--check gitignore passes a fresh scaffold and names a line that was removed', (t) => {
  const dir = repoWs(t);
  assert.strictEqual(runTool('backup-scope.js', [dir, '--check', 'gitignore']).status, 0);
  const gi = path.join(dir, '.gitignore');
  fs.writeFileSync(gi, fs.readFileSync(gi, 'utf8').replace(/^imports\/$/m, ''));
  const r = runTool('backup-scope.js', [dir, '--check', 'gitignore']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /imports\//);
});

test('--check history is clean on a fresh scaffold', (t) => {
  const dir = repoWs(t);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'first');
  assert.strictEqual(runTool('backup-scope.js', [dir, '--check', 'history']).status, 0);
});

test('--check history catches tracked source material in the legacy location', (t) => {
  const dir = repoWs(t);
  const legacy = path.join(dir, '.joserah', 'knowledge', 'raw');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'statement.md'), 'x\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'first');
  const r = runTool('backup-scope.js', [dir, '--check', 'history']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /\.joserah\/knowledge\/raw\/statement\.md/);
});

// The reason the history probe exists at all: once the files are moved out,
// ls-files goes quiet forever while every past commit still serves them.
test('--check history still fails after the files are deleted, because the commits remain', (t) => {
  const dir = repoWs(t);
  const legacy = path.join(dir, '.joserah', 'knowledge', 'raw');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'statement.md'), 'x\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'first');
  fs.rmSync(legacy, { recursive: true });
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'remove');
  assert.strictEqual(git(dir, 'ls-files', '--', '.joserah/knowledge/raw/').stdout.trim(), '',
    'ls-files is quiet — this is the blind spot');
  const r = runTool('backup-scope.js', [dir, '--check', 'history']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /history/i);
});

test('--check history covers root raw/ and imports/ too, and exempts the two documentation files', (t) => {
  const dir = repoWs(t);
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'AGENTS.md'), 'doc\n');
  git(dir, 'add', '-f', 'projects/AGENTS.md'); git(dir, 'commit', '-qm', 'doc only');
  assert.strictEqual(runTool('backup-scope.js', [dir, '--check', 'history']).status, 0,
    'projects/AGENTS.md is documentation and is exempt');
  for (const rel of ['raw/a.md', 'imports/a.md']) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x\n');
    git(dir, 'add', '-f', rel.split('/').join('/')); git(dir, 'commit', '-qm', 'oops');
    assert.strictEqual(runTool('backup-scope.js', [dir, '--check', 'history']).status, 1, rel);
    git(dir, 'rm', '-q', '--cached', rel); git(dir, 'commit', '-qm', 'untrack');
  }
});

test('--check history cannot pass when it could not run', (t) => {
  const dir = path.join(tmpdir(t), 'ws');           // scaffolded, never git init'ed
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const r = runTool('backup-scope.js', [dir, '--check', 'history']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /cannot check/i);
});

test('--changed-since counts files touched after the instant and skips the junk trees', (t) => {
  const dir = repoWs(t);
  const since = new Date().toISOString();
  fs.writeFileSync(path.join(dir, '.joserah', 'learned.md'),
    fs.readFileSync(path.join(dir, '.joserah', 'learned.md'), 'utf8') + '\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'a.js'), 'x\n');
  const r = runTool('backup-scope.js', [dir, '--changed-since', since]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(Number(r.stdout.trim()), 1);
});

// The second of the refactor's two deliberate narrowings, named so a reader
// sees it rather than discovering it. The count used to be an inline
// `node -e` one-liner in skills/backup/SKILL.md skipping five names
// ('.git', 'node_modules', 'projects', 'docker-stack', 'keys'); it now takes
// WALK_SKIP_NAMES from lib/untouchable.js, which adds '.venv' and
// '.superpowers'. Both additions are disposable scratch, never the owner's
// work, so a freshness count that included them only ever overstated it.
test('--changed-since skips exactly WALK_SKIP_NAMES — the narrowing that added .venv and .superpowers', (t) => {
  const u = require('../tools/lib/untouchable');
  assert.ok(u.WALK_SKIP_NAMES.includes('.venv') && u.WALK_SKIP_NAMES.includes('.superpowers'),
    'the narrowing is in the library');
  const dir = repoWs(t);
  const since = new Date().toISOString();
  for (const name of u.WALK_SKIP_NAMES) {
    fs.mkdirSync(path.join(dir, name, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'deep', 'a.txt'), 'x\n');
  }
  // ... and the same names nested, because these are names at any depth.
  fs.mkdirSync(path.join(dir, '.joserah', 'knowledge', '.venv'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'knowledge', '.venv', 'a.txt'), 'x\n');
  const r = runTool('backup-scope.js', [dir, '--changed-since', since]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(Number(r.stdout.trim()), 0,
    'nothing under a WALK_SKIP_NAMES directory is the owner\'s work');
});

test('--changed-since refuses an instant it cannot parse rather than counting from zero', (t) => {
  const r = runTool('backup-scope.js', [repoWs(t), '--changed-since', 'last tuesday']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /cannot check/i);
});
