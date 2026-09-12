'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');
const u = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'untouchable'));

// The six files that read their path knowledge from the library, and the
// specifier each must require it by: the five that each carried their own copy
// until 2026-09-13, plus tools/backup-scope.js, which was written against the
// library the same day and never had one. The point of the guard is that nobody
// keeps a copy — so a new consumer belongs in this list the moment it exists.
const CONSUMERS = [
  ['tools/verify-links.js', './lib/untouchable'],
  ['tools/lib/workspace-scan.js', './untouchable'],
  ['tools/secret-scan.js', './lib/untouchable'],
  ['tools/doctor.js', './lib/untouchable'],
  ['tools/archive.js', './lib/untouchable'],
  ['tools/backup-scope.js', './lib/untouchable'],
];

const RESERVED = ['keys', '.joserah/keys', 'projects', 'docker-stack', 'imports', 'raw',
  '.joserah/knowledge/raw', 'node_modules', '.git', '.venv', '.superpowers', 'dist', 'build',
  'site-packages', '.claude', '.joserah/user', '.joserah/feedback', '.joserah/tools',
  '.joserah/last-time-inject'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Two reserved names quoted next to each other, separated only by a comma, is
// an inline list. `path.join(root, 'keys')` and a sentence about `imports/`
// are not. Every one of the five files had exactly this shape before today.
const INLINE_LIST = new RegExp(
  `['"](?:${RESERVED.map(esc).join('|')})['"]\\s*,\\s*['"](?:${RESERVED.map(esc).join('|')})['"]`);

test('no untouchable-path consumer keeps its own list; each requires the library', () => {
  for (const [rel, spec] of CONSUMERS) {
    const src = fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8');
    assert.ok(src.includes(`require('${spec}')`), `${rel} must require ${spec}`);
    const m = src.match(INLINE_LIST);
    assert.strictEqual(m, null, `${rel} carries an inline path list again: ${m && m[0]}`);
  }
});

// Pins today's behaviour, set by set. Two entries differ from what the five
// files held on 2026-09-12 and both are deliberate, named here so a reader
// sees the change instead of discovering it: MIGRATION_SKIP_REL gains
// '.joserah/keys', and WALK_SKIP_NAMES (doctor's list) is now also used by
// backup-scope's changed-since count, which used to skip three fewer names.
const sorted = (a) => [...a].sort();
test('each consumer set is exactly the set that consumer used to carry', () => {
  assert.deepStrictEqual(sorted(u.LINK_SCAN_SKIP_REL), sorted([
    'keys', '.joserah/keys', 'projects', 'docker-stack', 'imports', 'raw', '.joserah/knowledge/raw']));
  assert.deepStrictEqual(sorted(u.LINK_SCAN_SKIP_NAMES), sorted([
    '.git', 'node_modules', '.venv', 'site-packages', 'dist', 'build', '.superpowers']));
  assert.deepStrictEqual(sorted(u.MIGRATION_SKIP_REL), sorted([
    'keys', '.joserah/keys', 'projects', 'docker-stack', '.claude', '.joserah/knowledge/raw',
    'imports', 'raw', '.joserah/user', '.joserah/feedback', '.joserah/tools',
    '.joserah/last-time-inject']));
  assert.deepStrictEqual(sorted(u.MIGRATION_SKIP_NAMES), sorted([
    '.git', 'node_modules', '.venv', 'dist', 'build', '.superpowers']));
  assert.deepStrictEqual(sorted(u.SECRET_SCAN_SKIP_REL), sorted([
    'keys', '.joserah/keys', 'projects', 'docker-stack', 'imports', 'raw',
    'node_modules', '.git', '.venv', '.superpowers', 'dist', 'build']));
  assert.deepStrictEqual(sorted(u.WALK_SKIP_NAMES), sorted([
    '.git', 'node_modules', 'projects', 'docker-stack', 'keys', '.venv', '.superpowers']));
  assert.deepStrictEqual(sorted(u.ARCHIVE_EXCLUDE_ROOT_REL), sorted(['projects', 'docker-stack']));
  assert.deepStrictEqual(sorted(u.ARCHIVE_SKIP_NAMES), sorted([
    'node_modules', '.git', '.venv', '.superpowers']));
  assert.deepStrictEqual(sorted(u.ARCHIVE_KEYS_PREFIXES), sorted(['keys', '.joserah/keys']));
});

test('the archive set carries no source-material path — the zip route keeps imports/', () => {
  for (const p of u.SOURCE_MATERIAL_REL) {
    assert.ok(!u.ARCHIVE_EXCLUDE_ROOT_REL.includes(p), `archive must not exclude ${p}`);
    assert.ok(!u.ARCHIVE_SKIP_NAMES.includes(p), `archive must not exclude ${p}`);
  }
});

test('the secret scan still reads .joserah/knowledge/raw — nothing ever gitignored it', () => {
  assert.ok(!u.SECRET_SCAN_SKIP_REL.includes('.joserah/knowledge/raw'));
  assert.ok(u.SOURCE_MATERIAL_REL.includes('.joserah/knowledge/raw'));
});

test('isUnder matches a path or anything under it, either separator, either case', () => {
  assert.strictEqual(u.isUnder('keys', ['keys']), true);
  assert.strictEqual(u.isUnder('Keys/token.txt', ['keys']), true);
  assert.strictEqual(u.isUnder('.joserah\\keys\\a.md', ['.joserah/keys']), true);
  assert.strictEqual(u.isUnder('keysmith/a.md', ['keys']), false);
  assert.strictEqual(u.isUnder('knowledge/projects/a.md', ['projects']), false);
});

test('a scaffolded workspace gets the library beside its own link checker, and it runs', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const lib = path.join(dir, '.joserah', 'tools', 'lib', 'untouchable.js');
  assert.ok(fs.existsSync(lib), '.joserah/tools/lib/untouchable.js');
  assert.strictEqual(
    fs.readFileSync(lib, 'utf8'),
    fs.readFileSync(path.join(PLUGIN_ROOT, 'tools', 'lib', 'untouchable.js'), 'utf8'));
  const r = spawnSync(process.execPath,
    [path.join(dir, '.joserah', 'tools', 'verify-links.js'), dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('doctor reports the workspace copy stale when the library beside it drifts', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.appendFileSync(path.join(dir, '.joserah', 'tools', 'lib', 'untouchable.js'), '\n// drift\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /^FAIL {2}local verify-links\.js current.*untouchable\.js/m);
});
