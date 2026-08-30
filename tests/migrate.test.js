'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');
const { scanWorkspace } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'workspace-scan'));

function ws(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  return dir;
}
function write(dir, rel, text) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

test('scan includes knowledge notes and excludes raw/, directives and keys', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/people/ada-lovelace.md', '# Ada\n');
  write(dir, '.joserah/knowledge/raw/source.md', '# immutable\n');
  write(dir, '.joserah/directives.md', '# rules\n');
  const { files } = scanWorkspace(dir);
  assert.ok(files.includes('.joserah/knowledge/people/ada-lovelace.md'));
  assert.ok(!files.some((f) => f.startsWith('.joserah/knowledge/raw/')), 'raw/ excluded');
  assert.ok(!files.includes('.joserah/directives.md'), 'directives excluded');
  assert.ok(!files.some((f) => f.startsWith('keys/')), 'keys/ excluded');
});

test('scan stops at a nested workspace and reports it as a boundary', (t) => {
  const dir = ws(t);
  const guest = path.join(dir, 'guestws');
  runTool('scaffold.js', ['--target', guest, '--workspace', 'guest']);
  write(dir, 'guestws/.joserah/knowledge/people/sevgi.md', '# Sevgi\n');
  const { files, boundaries } = scanWorkspace(dir);
  assert.ok(!files.some((f) => f.startsWith('guestws/')), 'nothing inside the nested workspace');
  assert.deepStrictEqual(boundaries, ['guestws']);
});

test('migrate --dry-run reports without writing', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/people/ada-lovelace.md', '# Ada Lovelace\n\nNotes.\n');
  const r = runTool('migrate.js', [dir, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.changed > 0);
  const text = fs.readFileSync(path.join(dir, '.joserah/knowledge/people/ada-lovelace.md'), 'utf8');
  assert.strictEqual(text, '# Ada Lovelace\n\nNotes.\n', 'dry run wrote nothing');
});

test('migrate adds frontmatter, keeps the body byte-identical, and types by folder', (t) => {
  const dir = ws(t);
  const rel = '.joserah/knowledge/people/ada-lovelace.md';
  const body = '# Ada Lovelace\n\nNotes about Ada.\n';
  write(dir, rel, body);
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const text = fs.readFileSync(path.join(dir, rel), 'utf8');
  assert.match(text, /^---\n/);
  assert.match(text, /title: Ada Lovelace/);
  assert.match(text, /type: person/);
  assert.ok(text.endsWith(body), 'original body preserved byte-for-byte at the end');
});

test('migrate is idempotent: a second run changes nothing', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/people/ada-lovelace.md', '# Ada Lovelace\n\nNotes.\n');
  runTool('migrate.js', [dir]);
  const after1 = fs.readFileSync(path.join(dir, '.joserah/knowledge/people/ada-lovelace.md'), 'utf8');
  const r2 = runTool('migrate.js', [dir]);
  const out2 = JSON.parse(r2.stdout);
  assert.strictEqual(out2.changed, 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.joserah/knowledge/people/ada-lovelace.md'), 'utf8'), after1);
});

test('migrate sets formatVersion and removes CLAUDE.md', (t) => {
  const dir = ws(t);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'see AGENTS.md\n');
  const r = runTool('migrate.js', [dir]);
  const out = JSON.parse(r.stdout);
  assert.ok(out.removed.includes('CLAUDE.md'));
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.formatVersion, 2);
});

test('migrate refuses a directory that is not a workspace', (t) => {
  const dir = path.join(tmpdir(t), 'plain');
  fs.mkdirSync(dir, { recursive: true });
  const r = runTool('migrate.js', [dir]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /not a Joserah workspace/i);
});

test('migrate appends a Relations block for entities mentioned in prose', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/wiki/entities/spine.md', '# Spine\n\nA client.\n');
  const journal = '# 2026-08-30\n\nFixed the Spine switch fabric today.\n';
  write(dir, '.joserah/desk/daily/2026/2026-08-30.md', journal);
  runTool('migrate.js', [dir]);
  const text = fs.readFileSync(path.join(dir, '.joserah/desk/daily/2026/2026-08-30.md'), 'utf8');
  assert.ok(text.includes(journal), 'original prose is still there, untouched');
  assert.match(text, /## Relations/);
  assert.match(text, /- mentions \[\[Spine\]\]/);
});

test('migrate does not duplicate a relation that already exists', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/wiki/entities/spine.md', '# Spine\n\nA client.\n');
  write(dir, '.joserah/desk/daily/2026/2026-08-30.md',
    '# 2026-08-30\n\nSpine work.\n\n## Relations\n\n- worked_on [[Spine]]\n');
  runTool('migrate.js', [dir]);
  const text = fs.readFileSync(path.join(dir, '.joserah/desk/daily/2026/2026-08-30.md'), 'utf8');
  assert.strictEqual((text.match(/\[\[Spine\]\]/g) || []).length, 1);
});

test('migrate does not relate an entity note to itself', (t) => {
  const dir = ws(t);
  const rel = '.joserah/knowledge/wiki/entities/spine.md';
  write(dir, rel, '# Spine\n\nSpine is a client.\n');
  runTool('migrate.js', [dir]);
  const text = fs.readFileSync(path.join(dir, rel), 'utf8');
  assert.doesNotMatch(text, /- mentions \[\[Spine\]\]/);
});

test('R3: a wikilink-shaped mention inside a code fence produces no relation', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/wiki/entities/spine.md', '# Spine\n\nA client.\n');
  const journal = '# 2026-08-30\n\n```\n[[Spine]] switch fabric config\n```\n\nUnrelated notes today.\n';
  write(dir, '.joserah/desk/daily/2026/2026-08-30.md', journal);
  runTool('migrate.js', [dir]);
  const text = fs.readFileSync(path.join(dir, '.joserah/desk/daily/2026/2026-08-30.md'), 'utf8');
  assert.doesNotMatch(text, /## Relations/, 'a [[wikilink]]-shaped mention inside a fenced code block is not a relation');
});

test('migrate run twice produces a byte-identical file once Relations are appended', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/wiki/entities/spine.md', '# Spine\n\nA client.\n');
  write(dir, '.joserah/desk/daily/2026/2026-08-30.md', '# 2026-08-30\n\nFixed the Spine switch fabric today.\n');
  const journalPath = path.join(dir, '.joserah/desk/daily/2026/2026-08-30.md');
  runTool('migrate.js', [dir]);
  const after1 = fs.readFileSync(journalPath, 'utf8');
  const r2 = runTool('migrate.js', [dir]);
  const out2 = JSON.parse(r2.stdout);
  assert.strictEqual(out2.changed, 0, 'nothing left to change on the second run');
  assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), after1, 'second run is byte-identical');
});

test('CRLF: an appended Relations block matches the note\'s own CRLF line endings', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/wiki/entities/spine.md', '# Spine\r\n\r\nA client.\r\n');
  const journalPath = write(dir, '.joserah/desk/daily/2026/2026-08-30.md',
    '# 2026-08-30\r\n\r\nFixed the Spine switch fabric today.\r\n');
  runTool('migrate.js', [dir]);
  const text = fs.readFileSync(journalPath, 'utf8');
  assert.match(text, /## Relations/);
  assert.match(text, /- mentions \[\[Spine\]\]/);
  // No lone LF (an LF not preceded by CR) anywhere in the whole file — the
  // frontmatter AND the appended Relations block must both match the CRLF
  // the note's own prose already uses.
  assert.doesNotMatch(text, /[^\r]\n|^\n/, 'no lone LF anywhere in the file');
});

test('R8: scan excludes .claude/ so agent and command definitions are not treated as notes', (t) => {
  const dir = ws(t);
  write(dir, '.claude/agents/reviewer.md', '# Reviewer\n\nAn agent definition, not a note.\n');
  const { files } = scanWorkspace(dir);
  assert.ok(!files.some((f) => f.startsWith('.claude/')), '.claude/ excluded from scan');
});
