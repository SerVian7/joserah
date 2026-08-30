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

test('config.json: formatVersion is stamped with a targeted edit, not a re-serialise', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  // Deliberately awkward, hand-written formatting: an inline array where
  // scaffold would have wrapped it onto its own lines, 4-space indentation
  // where scaffold uses 2, and no formatVersion key at all yet. None of that
  // is migrate's to fix.
  const awkward =
    '{\n' +
    '    "workspace": "w",\n' +
    '    "hosts": ["../akkaya"],\n' +
    '    "kind": "home"\n' +
    '}\n';
  fs.writeFileSync(cfgPath, awkward, 'utf8');
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.strictEqual(
    after,
    '{\n' +
    '    "formatVersion": 2,\n' +
    '    "workspace": "w",\n' +
    '    "hosts": ["../akkaya"],\n' +
    '    "kind": "home"\n' +
    '}\n',
    'byte-identical apart from the single inserted formatVersion line'
  );
});

test('config.json: already at the current formatVersion is not written at all', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const before = fs.readFileSync(cfgPath, 'utf8'); // scaffold already stamps formatVersion: 2
  const beforeMtime = fs.statSync(cfgPath).mtimeMs;
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.strictEqual(after, before, 'not a single byte changed');
  assert.strictEqual(fs.statSync(cfgPath).mtimeMs, beforeMtime, 'file was never opened for writing');
});

test('config.json: CRLF file keeps CRLF after formatVersion is inserted', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const crlf = '{\r\n  "workspace": "w",\r\n  "kind": "home"\r\n}\r\n';
  fs.writeFileSync(cfgPath, crlf, 'utf8');
  runTool('migrate.js', [dir]);
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.strictEqual(
    after,
    '{\r\n  "formatVersion": 2,\r\n  "workspace": "w",\r\n  "kind": "home"\r\n}\r\n'
  );
  assert.doesNotMatch(after, /[^\r]\n|^\n/, 'no lone LF anywhere in the file');
});

test('config.json: no trailing newline is preserved as no trailing newline', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const noTrailing = '{\n  "workspace": "w",\n  "kind": "home"\n}';
  fs.writeFileSync(cfgPath, noTrailing, 'utf8');
  runTool('migrate.js', [dir]);
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.strictEqual(after, '{\n  "formatVersion": 2,\n  "workspace": "w",\n  "kind": "home"\n}');
});

test('config.json: a second run over an already-stamped awkward config is byte-identical', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const awkward = '{\n    "workspace": "w",\n    "hosts": ["../akkaya"]\n}\n';
  fs.writeFileSync(cfgPath, awkward, 'utf8');
  runTool('migrate.js', [dir]);
  const after1 = fs.readFileSync(cfgPath, 'utf8');
  const after1Mtime = fs.statSync(cfgPath).mtimeMs;
  runTool('migrate.js', [dir]);
  assert.strictEqual(fs.readFileSync(cfgPath, 'utf8'), after1, 'second run made no further change');
  assert.strictEqual(fs.statSync(cfgPath).mtimeMs, after1Mtime, 'second run did not even open the file for writing');
});

test('config.json: --dry-run never writes even when formatVersion is stale', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const stale = '{\n  "workspace": "w",\n  "formatVersion": 1\n}\n';
  fs.writeFileSync(cfgPath, stale, 'utf8');
  runTool('migrate.js', [dir, '--dry-run']);
  assert.strictEqual(fs.readFileSync(cfgPath, 'utf8'), stale, 'dry run wrote nothing to config.json');
});

test('config.json: invalid JSON is left completely untouched rather than mangled', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const broken = '{ "workspace": "w", oops }\n';
  fs.writeFileSync(cfgPath, broken, 'utf8');
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(cfgPath, 'utf8'), broken, 'malformed config left byte-for-byte as-is');
});
