'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool, PLUGIN_ROOT, fakeMarketplace } = require('./helpers');
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
// The two lines migrate adds when it records an unrecorded-but-matching
// AGENTS.md: inserted one after the other as the first property, so the sha
// ends up above the version. Computed from the template, never hardcoded.
const promptLib = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'prompt'));
function promptRecordLines(indent, eol) {
  const tpl = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  return `${indent}"promptSha256": "${promptLib.promptSha(tpl)}",${eol}` +
         `${indent}"promptVersion": ${promptLib.readPromptVersion(tpl)},${eol}`;
}

test('scan includes knowledge notes and excludes imports/, raw/, directives and keys', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/people/ada-lovelace.md', '# Ada\n');
  write(dir, '.joserah/knowledge/raw/source.md', '# immutable\n');
  write(dir, 'imports/source.md', '# immutable\n');
  write(dir, '.joserah/directives.md', '# rules\n');
  const { files } = scanWorkspace(dir);
  assert.ok(files.includes('.joserah/knowledge/people/ada-lovelace.md'));
  assert.ok(!files.some((f) => f.startsWith('.joserah/knowledge/raw/')), 'raw/ excluded');
  assert.ok(!files.some((f) => f.startsWith('imports/')), 'imports/ excluded');
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
  // Three inserted lines, each in the file's own 4-space style: the prompt
  // record (the scaffolded AGENTS.md matched the current prompt but this
  // hand-written config did not record it) and formatVersion.
  assert.strictEqual(
    after,
    '{\n' +
    promptRecordLines('    ', '\n') +
    '    "formatVersion": 2,\n' +
    '    "workspace": "w",\n' +
    '    "hosts": ["../akkaya"],\n' +
    '    "kind": "home"\n' +
    '}\n',
    'byte-identical apart from the inserted formatVersion and prompt-record lines'
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
    '{\r\n' + promptRecordLines('  ', '\r\n') + '  "formatVersion": 2,\r\n  "workspace": "w",\r\n  "kind": "home"\r\n}\r\n'
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
  assert.strictEqual(after, '{\n' + promptRecordLines('  ', '\n') + '  "formatVersion": 2,\n  "workspace": "w",\n  "kind": "home"\n}');
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

// R17: a workspace scaffolded before this plan never got JOSERAH-ROLE.md or
// .joserah/agent.md — scaffold.js is the only thing that has ever written
// them, and this workspace predates it. Simulated here by scaffolding fresh
// (so it is otherwise a valid workspace) and then deleting exactly the two
// files a pre-v2 workspace never received.
function stripPreV2Files(dir) {
  fs.unlinkSync(path.join(dir, 'JOSERAH-ROLE.md'));
  fs.unlinkSync(path.join(dir, '.joserah', 'agent.md'));
}

test('R17: migrate installs JOSERAH-ROLE.md when a pre-v2 workspace never got one', (t) => {
  const dir = ws(t);
  stripPreV2Files(dir);
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const rolePath = path.join(dir, 'JOSERAH-ROLE.md');
  assert.ok(fs.existsSync(rolePath), 'JOSERAH-ROLE.md installed by migrate');
  const template = fs.readFileSync(
    path.join(PLUGIN_ROOT, 'templates', 'roles', 'joserah-client.md'), 'utf8');
  assert.strictEqual(fs.readFileSync(rolePath, 'utf8'), template, 'copied verbatim from the "home" kind\'s role template');
});

test('R17: migrate installs .joserah/agent.md when a pre-v2 workspace never got one', (t) => {
  const dir = ws(t);
  stripPreV2Files(dir);
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const agentPath = path.join(dir, '.joserah', 'agent.md');
  assert.ok(fs.existsSync(agentPath), '.joserah/agent.md installed by migrate');
  const template = fs.readFileSync(
    path.join(PLUGIN_ROOT, 'templates', '.joserah', 'agent.md'), 'utf8');
  assert.strictEqual(fs.readFileSync(agentPath, 'utf8'), template, 'copied verbatim, empty of owner rules');
});

test('R17: migrate reports both installs as "created", distinct from "changed"', (t) => {
  const dir = ws(t);
  stripPreV2Files(dir);
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.created), 'created is reported as its own field');
  assert.ok(out.created.includes('JOSERAH-ROLE.md'));
  assert.ok(out.created.includes('.joserah/agent.md'));
});

// Content, not bytes: migrate's pre-existing note loop (frontmatter,
// Relations) runs over every scanned .md file regardless of path, JOSERAH-
// ROLE.md and agent.md included — that is unrelated to R17 and already true
// of this tool before this change. What R17 owns is narrower: the create-if-
// absent step must never fire, and never touch the file, when one is already
// there — so the owner's own text must survive somewhere in the result.
test('R17: an existing JOSERAH-ROLE.md or agent.md is never replaced by migrate\'s installer', (t) => {
  const dir = ws(t);
  stripPreV2Files(dir);
  fs.writeFileSync(path.join(dir, 'JOSERAH-ROLE.md'), 'owner-edited role\n');
  fs.writeFileSync(path.join(dir, '.joserah', 'agent.md'), 'owner-written overlay\n');
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(dir, 'JOSERAH-ROLE.md'), 'utf8').endsWith('owner-edited role\n'));
  assert.ok(fs.readFileSync(path.join(dir, '.joserah', 'agent.md'), 'utf8').endsWith('owner-written overlay\n'));
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.created.length, 0, 'nothing reported as created when both already exist');
});

test('R17: --dry-run reports what it would create but writes nothing', (t) => {
  const dir = ws(t);
  stripPreV2Files(dir);
  const r = runTool('migrate.js', [dir, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.created.includes('JOSERAH-ROLE.md'));
  assert.ok(out.created.includes('.joserah/agent.md'));
  assert.ok(!fs.existsSync(path.join(dir, 'JOSERAH-ROLE.md')), 'dry run created nothing on disk');
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'agent.md')), 'dry run created nothing on disk');
});

test('R17: idempotent — a second real run creates nothing further', (t) => {
  const dir = ws(t);
  stripPreV2Files(dir);
  runTool('migrate.js', [dir]);
  const r2 = runTool('migrate.js', [dir]);
  assert.strictEqual(r2.status, 0, r2.stderr);
  const out2 = JSON.parse(r2.stdout);
  assert.strictEqual(out2.created.length, 0, 'second run creates nothing — both files already present');
});

test('R17: role installed by migrate follows the workspace\'s own kind, not a hardcoded default', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.kind = 'shared';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  stripPreV2Files(dir);
  runTool('migrate.js', [dir]);
  const rolePath = path.join(dir, 'JOSERAH-ROLE.md');
  const template = fs.readFileSync(
    path.join(PLUGIN_ROOT, 'templates', 'roles', 'joserah-server.md'), 'utf8');
  assert.strictEqual(fs.readFileSync(rolePath, 'utf8'), template, 'kind "shared" maps to the "server" role, per roleFor');
});

// R19: JOSERAH-ROLE.md and .joserah/agent.md are plugin-owned and doctor-
// compared byte-for-byte (JOSERAH-ROLE.md against its role template); a
// fresh workspace's AGENTS.md is the fixed system prompt, byte-identical
// everywhere by design. None of the three is the owner's prose, so a second
// migrate run over a workspace that already has all three must leave every
// byte of them exactly as scaffold (or R17's installer) left it.
test('R19: a second migrate run does not touch AGENTS.md, JOSERAH-ROLE.md or .joserah/agent.md', (t) => {
  const dir = ws(t);
  const rel = ['AGENTS.md', 'JOSERAH-ROLE.md', path.join('.joserah', 'agent.md')];
  const before = rel.map((r) => fs.readFileSync(path.join(dir, r), 'utf8'));
  runTool('migrate.js', [dir]);
  const r2 = runTool('migrate.js', [dir]);
  assert.strictEqual(r2.status, 0, r2.stderr);
  const out2 = JSON.parse(r2.stdout);
  assert.strictEqual(out2.changed, 0, 'second run reports nothing changed');
  rel.forEach((r, i) => {
    assert.strictEqual(fs.readFileSync(path.join(dir, r), 'utf8'), before[i],
      `${r} is byte-identical after two migrate runs`);
  });
});

test('R19: JOSERAH-ROLE.md still matches its role template after two migrate runs', (t) => {
  const dir = ws(t);
  runTool('migrate.js', [dir]);
  runTool('migrate.js', [dir]);
  const rolePath = path.join(dir, 'JOSERAH-ROLE.md');
  const template = fs.readFileSync(
    path.join(PLUGIN_ROOT, 'templates', 'roles', 'joserah-client.md'), 'utf8');
  assert.strictEqual(fs.readFileSync(rolePath, 'utf8'), template,
    'still byte-identical to the template doctor compares it against');
});

test('R19: scanWorkspace excludes the workspace-root AGENTS.md, root JOSERAH-ROLE.md and .joserah/agent.md', (t) => {
  const dir = ws(t);
  const { files } = scanWorkspace(dir);
  assert.ok(!files.includes('AGENTS.md'), 'root AGENTS.md excluded from scan');
  assert.ok(!files.includes('JOSERAH-ROLE.md'), 'root JOSERAH-ROLE.md excluded from scan');
  assert.ok(!files.includes('.joserah/agent.md'), '.joserah/agent.md excluded from scan');
});

test('R19: exclusion is anchored to the workspace root, not a bare filename match at any depth', (t) => {
  const dir = ws(t);
  write(dir, 'projects/some-repo/AGENTS.md', '# A nested repo\'s own AGENTS.md\n\nUnrelated to the workspace root one.\n');
  const { files } = scanWorkspace(dir);
  // projects/ is already excluded by directory rule — this proves the new
  // root-anchored exclusion isn't why it's missing, by checking a path that
  // directory-skips alone would NOT catch: a same-named file directly under
  // a knowledge folder, one level deep, which must still be scanned normally.
  write(dir, '.joserah/knowledge/wiki/AGENTS.md', '# Not the root one\n\nThis is an ordinary note that happens to share a filename.\n');
  const { files: files2 } = scanWorkspace(dir);
  assert.ok(files2.includes('.joserah/knowledge/wiki/AGENTS.md'),
    'a same-named file that is not at the workspace root is scanned like any other note');
});

// --- CRITICAL 1 ------------------------------------------------------------
// .joserah/feedback/ was scanned as ordinary owner prose. A feedback note has
// `type:` but no `title:`, and no H1 at all (only `##` headings), so
// ensureFrontmatter spliced in a title taken from titleFor's filename
// fallback — and the filename is the one string in the whole pipeline that
// renderFeedbackNote never scans, while feedback.js uploads the file verbatim
// to a public issue tracker. The Relations pass was a second way through the
// same door.

const nfmt = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'note-format'));

test('CRITICAL 1: a feedback note is out of the migration scan entirely', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/feedback/prompt/2026-08-30-sevgi-akkaya-mail-loop.md',
    '---\ntype: feedback\narea: prompt\n---\n\n## Symptom\n\nSomething.\n');
  const { files } = scanWorkspace(dir);
  assert.ok(!files.some((f) => f.startsWith('.joserah/feedback/')),
    'nothing under .joserah/feedback/ is offered to the migration');
});

test('CRITICAL 1: a rendered feedback note is byte-identical after a migration run', (t) => {
  const dir = ws(t);
  // An entity whose title appears in the note's own prose, so the Relations
  // pass has something to append if it is ever let near this file.
  write(dir, '.joserah/knowledge/wiki/entities/toolchain.md', '# Toolchain\n\nThe build chain.\n');
  const note = nfmt.renderFeedbackNote({
    area: 'prompt', created: '2026-08-30',
    symptom: 'the toolchain restated a rule it had already been given, twice in one session.',
    cause: 'the rule is injected in two layers and neither knows the other ran.',
    suggestion: 'inject the layer once and let the later layer reference it.',
  }, []);
  const rel = '.joserah/feedback/prompt/2026-08-30-sevgi-akkaya-mail-loop.md';
  write(dir, rel, note);
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(dir, rel), 'utf8'), note,
    'the bytes feedback.js would publish are exactly the bytes renderFeedbackNote produced');
});

// --- CRITICAL 2 ------------------------------------------------------------
// migrate read every note as 'utf8' regardless of what its bytes actually
// were. A UTF-8 BOM defeats FM_RE's ^--- anchor (so a block lands in front of
// the mark, and on a v2 note a second block demotes the owner's real one); a
// UTF-16 note — PowerShell 5.1's default for `>` — decodes to replacement
// characters and is written back as mojibake, destroying every character
// above U+007F for good.

const BOM8 = Buffer.from([0xEF, 0xBB, 0xBF]);

function writeBytes(dir, rel, buf) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return p;
}

test('CRITICAL 2: a plain UTF-8 note (no BOM) still migrates', (t) => {
  const dir = ws(t);
  const rel = '.joserah/knowledge/people/ada-lovelace.md';
  writeBytes(dir, rel, Buffer.from('# Ada Lovelace\n\nNotes.\n', 'utf8'));
  const r = runTool('migrate.js', [dir]);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.skipped, [], 'nothing refused');
  assert.match(fs.readFileSync(path.join(dir, rel), 'utf8'), /^---\ntitle: Ada Lovelace\n/);
});

test('CRITICAL 2: a UTF-8 BOM note is left untouched and reported as skipped', (t) => {
  const dir = ws(t);
  const rel = '.joserah/knowledge/people/ada-lovelace.md';
  const bytes = Buffer.concat([BOM8, Buffer.from('# Ada Lovelace\n\nNotes.\n', 'utf8')]);
  const p = writeBytes(dir, rel, bytes);
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(fs.readFileSync(p).equals(bytes), 'every byte as the owner left it');
  assert.ok(out.skipped.some((s) => s.file === rel && /BOM/i.test(s.reason)),
    'the refusal is reported, not silent: ' + JSON.stringify(out.skipped));
});

test('CRITICAL 2: a UTF-16LE note comes out byte-identical and reported, never mojibake', (t) => {
  const dir = ws(t);
  const rel = '.joserah/desk/daily/2026/2026-08-30.md';
  const bytes = Buffer.concat([
    Buffer.from([0xFF, 0xFE]),
    Buffer.from('# Günlük\n\nDurmuş ile görüşüldü.\n', 'utf16le'),
  ]);
  const p = writeBytes(dir, rel, bytes);
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(fs.readFileSync(p).equals(bytes),
    'bytes identical — the Turkish characters are unrecoverable if this ever writes');
  assert.ok(out.skipped.some((s) => s.file === rel && /UTF-16/i.test(s.reason)),
    'reported as skipped: ' + JSON.stringify(out.skipped));
});

test('CRITICAL 2: a BOM note already on v2 does not get a second frontmatter block', (t) => {
  const dir = ws(t);
  const rel = '.joserah/knowledge/people/ada-lovelace.md';
  const body = '---\ntitle: Ada Lovelace\ntype: person\n---\n\n# Ada Lovelace\n\nNotes.\n';
  const bytes = Buffer.concat([BOM8, Buffer.from(body, 'utf8')]);
  const p = writeBytes(dir, rel, bytes);
  runTool('migrate.js', [dir]);
  const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  assert.strictEqual((text.match(/^---$/gm) || []).length, 2,
    'exactly one frontmatter block, the owner\'s own');
  assert.ok(fs.readFileSync(p).equals(bytes), 'untouched');
});

// --- IMPORTANT 5 -----------------------------------------------------------
test('IMPORTANT 5: .joserah/user/ is a drop folder, not the assistant\'s to rewrite', (t) => {
  const dir = ws(t);
  const rel = '.joserah/user/cv.md';
  const body = '# Curriculum vitae\n\nWhat the owner dropped here.\n';
  write(dir, rel, body);
  const { files } = scanWorkspace(dir);
  assert.ok(!files.some((f) => f.startsWith('.joserah/user/')), 'user/ excluded from the scan');
  runTool('migrate.js', [dir]);
  assert.strictEqual(fs.readFileSync(path.join(dir, rel), 'utf8'), body, 'byte-identical');
});

// --- a note with no trailing newline ---------------------------------------
test('migrate does not glue an appended Relations block onto the note\'s last prose line', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/people/ada-lovelace.md', '# Ada Lovelace\n\nNotes.\n');
  const rel = '.joserah/desk/inbox/scratch.md';
  write(dir, rel, '# Scratch\n\nSpoke to Ada Lovelace today.');
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const text = fs.readFileSync(path.join(dir, rel), 'utf8');
  assert.match(text, /Spoke to Ada Lovelace today\.\n\n## Relations\n/,
    'the owner\'s last line stays a line of its own');
});

test('migrate creates a missing .joserah/directives.md from the template with the workspace name filled in', (t) => {
  const dir = ws(t);
  fs.unlinkSync(path.join(dir, '.joserah', 'directives.md'));
  const dry = JSON.parse(runTool('migrate.js', [dir, '--dry-run']).stdout);
  assert.ok(dry.created.includes('.joserah/directives.md'));
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'directives.md')), 'dry-run must not write');

  const out = JSON.parse(runTool('migrate.js', [dir]).stdout);
  assert.ok(out.created.includes('.joserah/directives.md'));
  const text = fs.readFileSync(path.join(dir, '.joserah', 'directives.md'), 'utf8');
  assert.match(text, /^# Directives — w$/m);
  assert.doesNotMatch(text, /{{[A-Z_]+}}/);
});

test('migrate never touches an existing directives.md', (t) => {
  const dir = ws(t);
  const p = path.join(dir, '.joserah', 'directives.md');
  fs.writeFileSync(p, '# mine\n\nowner rules\n');
  runTool('migrate.js', [dir]);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '# mine\n\nowner rules\n');
});

test('migrate installs a missing AGENTS.md and records it', (t) => {
  const dir = ws(t);
  fs.unlinkSync(path.join(dir, 'AGENTS.md'));
  const out = JSON.parse(runTool('migrate.js', [dir]).stdout);
  assert.strictEqual(out.prompt.action, 'install');
  assert.ok(out.created.includes('AGENTS.md'));
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
});

test('migrate brings a pristine-but-behind AGENTS.md to the newer source', (t) => {
  const dir = ws(t);
  const configDir = fakeMarketplace(t, 42);
  const out = JSON.parse(runTool('migrate.js', [dir], { env: { CLAUDE_CONFIG_DIR: configDir } }).stdout);
  assert.strictEqual(out.prompt.action, 'install');
  assert.strictEqual(out.prompt.available, 42);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /prompt-version 42/);
});

test('migrate records a pre-versioning AGENTS.md that matches, and refuses one that differs', (t) => {
  const dir = ws(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  delete cfg.promptVersion; delete cfg.promptSha256;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  assert.strictEqual(JSON.parse(runTool('migrate.js', [dir]).stdout).prompt.action, 'record');
  assert.ok(Number.isInteger(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).promptVersion));

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md — Core AI Folder\n\nold generation\n');
  const r = runTool('migrate.js', [dir]);
  assert.strictEqual(r.status, 0, 'migrate still exits 0 — the refusal is reported, not fatal');
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.prompt.action, 'refused');
  assert.match(out.prompt.reason, /refresh-prompt\.js .*--force/);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /Core AI Folder/);
});

test('migrate leaves a hand-edited AGENTS.md alone and says so', (t) => {
  const dir = ws(t);
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nmy own rule\n');
  const out = JSON.parse(runTool('migrate.js', [dir], { env: { CLAUDE_CONFIG_DIR: fakeMarketplace(t, 42) } }).stdout);
  assert.strictEqual(out.prompt.state, 'hand-edited');
  assert.strictEqual(out.prompt.action, 'refused');
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /my own rule/);
});
