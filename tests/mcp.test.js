'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir } = require('./helpers');

const kb = require(path.join(PLUGIN_ROOT, 'mcp', 'lib', 'kb'));

// A workspace with one note of each kind that matters, plus one file in every
// place the server must never look. The exclusions are not this file's own
// list: they are what tools/lib/untouchable.js already says, reached through
// scanWorkspace. This fixture is how we prove the reuse actually happened.
function fixture(t) {
  const root = path.join(tmpdir(t), 'ws');
  const w = (rel, text) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  };
  w('.joserah/config.json', '{"workspace":"w"}\n');
  w('.joserah/knowledge/wiki/entities/meydan-kontrol.md',
    '---\ntitle: Meydan Kontrol\ntype: entity\nsnapshot: 2026-01-02\nsource: ops-handoff\n---\n\n' +
    '# Meydan Kontrol\n\nMerkezi kontrol paneli.\n- [fact] 31 registered modules\n\n' +
    '## Modules\n\nseventeen of type module\n');
  w('.joserah/knowledge/wiki/topics/backup.md',
    '---\ntitle: Backup\ntype: topic\n---\n\n# Backup\n\nnothing there has an automatic backup.\n');
  w('.joserah/personal/profile.md', '---\ntitle: Profile\ntype: person\n---\n\n# Profile\n\nowner note\n');
  w('.joserah/knowledge/no-frontmatter.md', '# Plain Note\n\nno frontmatter at all\n');
  // none of these may ever be listed, searched or read
  w('keys/AGENTS.md', '# keys\n');
  w('imports/dump.md', '# dump\n');
  w('.joserah/user/cv.md', '# cv\n');
  w('.joserah/feedback/note.md', '# feedback\n');
  w('projects/Owner/Proj/README.md', '# other repo\n');
  w('AGENTS.md', '# prompt\n');
  w('.joserah/directives.md', '# directives\n');
  return root;
}

test('kb_list returns every in-scope note, path-ascending, with its frontmatter', (t) => {
  const rows = kb.listNotes(fixture(t));
  assert.deepStrictEqual(rows.map((r) => r.path), [
    '.joserah/knowledge/no-frontmatter.md',
    '.joserah/knowledge/wiki/entities/meydan-kontrol.md',
    '.joserah/knowledge/wiki/topics/backup.md',
    '.joserah/personal/profile.md',
  ]);
  const zc = rows.find((r) => r.path.endsWith('meydan-kontrol.md'));
  assert.strictEqual(zc.title, 'Meydan Kontrol');
  assert.strictEqual(zc.type, 'entity');
  assert.match(zc.modified, /^\d{4}-\d{2}-\d{2}$/);
});

test('a note without frontmatter still gets a title and an empty type', (t) => {
  const row = kb.listNotes(fixture(t)).find((r) => r.path.endsWith('no-frontmatter.md'));
  assert.strictEqual(row.title, 'Plain Note');
  assert.strictEqual(row.type, '');
});

test('secrets, source material, other repos and the private folders are not notes', (t) => {
  const paths = kb.listNotes(fixture(t)).map((r) => r.path).join('\n');
  for (const forbidden of ['keys/', 'imports/', '.joserah/user/', '.joserah/feedback/',
    'projects/', 'AGENTS.md', 'directives.md']) {
    assert.ok(!paths.includes(forbidden), `${forbidden} reached the tool surface`);
  }
});

test('prefix and type narrow the listing', (t) => {
  const root = fixture(t);
  assert.deepStrictEqual(
    kb.listNotes(root, { prefix: '.joserah/knowledge/wiki/topics/' }).map((r) => r.path),
    ['.joserah/knowledge/wiki/topics/backup.md']);
  assert.deepStrictEqual(
    kb.listNotes(root, { type: 'person' }).map((r) => r.path),
    ['.joserah/personal/profile.md']);
});

test('a title hit outranks a frontmatter hit, which outranks a body hit', (t) => {
  const hits = kb.searchNotes(fixture(t), { query: 'backup' });
  // "backup" is this note's title AND a word in its body. The reported line is
  // the title's (line 2 of the file), not the body's — that is the ranking
  // working inside one note, where it is easiest to get wrong.
  assert.strictEqual(hits[0].path, '.joserah/knowledge/wiki/topics/backup.md');
  assert.strictEqual(hits[0].line, 2);
  assert.strictEqual(hits[0].title, 'Backup');
  assert.strictEqual(hits[0].type, 'topic');
});

test('equal scores are ordered by path, so two runs agree', (t) => {
  const root = fixture(t);
  // `type:` is a frontmatter key in three notes and in none of their titles.
  const once = kb.searchNotes(root, { query: 'type:' }).map((h) => h.path);
  const twice = kb.searchNotes(root, { query: 'type:' }).map((h) => h.path);
  assert.deepStrictEqual(once, twice);
  assert.deepStrictEqual(once, [...once].sort());
});

test('a hit carries the matching line number and one line of context either side', (t) => {
  const hits = kb.searchNotes(fixture(t), { query: 'seventeen' });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].path, '.joserah/knowledge/wiki/entities/meydan-kontrol.md');
  const lines = hits[0].snippet.split('\n');
  assert.strictEqual(lines.length, 3);
  assert.ok(lines[1].includes('seventeen'), 'the matching line sits in the middle');
});

test('search is case-insensitive and can be filtered by type and limited', (t) => {
  const root = fixture(t);
  assert.strictEqual(kb.searchNotes(root, { query: 'MERKEZI' }).length, 1);
  assert.deepStrictEqual(
    kb.searchNotes(root, { query: 'type:', type: 'person' }).map((h) => h.path),
    ['.joserah/personal/profile.md']);
  assert.strictEqual(kb.searchNotes(root, { query: 'type:', limit: 1 }).length, 1);
});

test('nothing found is an empty list, not an error', (t) => {
  assert.deepStrictEqual(kb.searchNotes(fixture(t), { query: 'zzz-nothing-here' }), []);
});

test('a read carries the two-line header, then the body exactly as it sits on disk', (t) => {
  const r = kb.readNote(fixture(t), { path: '.joserah/knowledge/wiki/entities/meydan-kontrol.md' });
  const lines = r.text.split('\n');
  assert.strictEqual(lines[0], 'path: .joserah/knowledge/wiki/entities/meydan-kontrol.md');
  assert.strictEqual(lines[1],
    'title: Meydan Kontrol · type: entity · snapshot: 2026-01-02 · source: ops-handoff');
  assert.strictEqual(lines[2], '---');
  assert.ok(r.text.includes('- [fact] 31 registered modules'), 'the body is not rewritten');
  assert.ok(r.text.includes('Merkezi kontrol paneli.'), 'and not translated');
});

test('section returns that heading block and nothing after it', (t) => {
  const r = kb.readNote(fixture(t),
    { path: '.joserah/knowledge/wiki/entities/meydan-kontrol.md', section: 'Modules' });
  assert.ok(r.text.includes('## Modules'));
  assert.ok(r.text.includes('seventeen of type module'));
  assert.ok(!r.text.includes('31 registered modules'), 'the earlier section is not included');
});

test('a path outside the tool surface reads as no such note, never as a file', (t) => {
  const root = fixture(t);
  for (const bad of ['keys/AGENTS.md', 'imports/dump.md', '../outside.md',
    '.joserah/user/cv.md', 'projects/Owner/Proj/README.md']) {
    const r = kb.readNote(root, { path: bad });
    assert.ok(r.error, `${bad} was readable`);
    assert.ok(!r.text, `${bad} returned content`);
  }
});

test('an unknown heading is an error the caller can correct, naming the note', (t) => {
  const r = kb.readNote(fixture(t),
    { path: '.joserah/knowledge/wiki/topics/backup.md', section: 'No Such Heading' });
  assert.match(r.error, /No Such Heading/);
  assert.match(r.error, /backup\.md/);
});

test('an oversized note is cut inside the budget and says how to get the rest', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, '.joserah', 'knowledge', 'big.md'),
    '---\ntitle: Big\ntype: note\n---\n\n# Big\n\n' +
    'a filler line long enough to matter, repeated.\n'.repeat(1500) +
    '\n## Second half\n\nthe rest\n', 'utf8');
  const r = kb.readNote(root, { path: '.joserah/knowledge/big.md' });
  assert.ok(r.text.length <= kb.MAX_CHARS, `cut to ${r.text.length}, budget is ${kb.MAX_CHARS}`);
  assert.match(r.text, /\[truncated — \d+ more characters; call kb_read with section: "Second half"\]/);
  assert.ok(r.text.endsWith('\n'));
});

test('a note that fits is not touched', (t) => {
  const r = kb.readNote(fixture(t), { path: '.joserah/knowledge/wiki/topics/backup.md' });
  assert.ok(!/truncated/.test(r.text));
  assert.ok(r.text.endsWith('nothing there has an automatic backup.\n'));
});

const core = require(path.join(PLUGIN_ROOT, 'mcp', 'lib', 'core'));

test('three tools, in a fixed order, with specification-legal names', (t) => {
  const tools = core.createServer({ root: fixture(t) }).listTools();
  assert.deepStrictEqual(tools.map((x) => x.name), ['kb_search', 'kb_read', 'kb_list']);
  for (const tool of tools) {
    assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/);
    assert.ok(tool.description.length > 10, `${tool.name} has no description`);
    assert.strictEqual(tool.inputSchema.type, 'object');
  }
});

// The decision this pins: DECISIONS.md, "MCP design rule: no character in the
// MCP". The instruction string says how to CALL, never how to BE. Asserting
// the whole string is the cheapest way to make an edit that adds a sentence
// about tone fail a test instead of passing a review.
test('the instruction string carries the conventions and no character at all', () => {
  assert.strictEqual(core.INSTRUCTIONS,
    'A markdown knowledge base. Call kb_search or kb_list to find a path, then kb_read. '
    + 'Paths are workspace-relative. Dates are ISO 8601.');
  assert.ok(core.INSTRUCTIONS.length < 200, 'this is the short pattern, not a server tour');
  assert.doesNotMatch(core.INSTRUCTIONS, /\bI\b|\bJoserah\b|assistant/);
});

test('kb_list and kb_search come back as one text block of JSON', (t) => {
  const server = core.createServer({ root: fixture(t) });
  const listed = JSON.parse(server.callTool('kb_list', { type: 'topic' }).content[0].text);
  assert.deepStrictEqual(listed.map((r) => r.path), ['.joserah/knowledge/wiki/topics/backup.md']);
  const found = JSON.parse(server.callTool('kb_search', { query: 'seventeen' }).content[0].text);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].line, 15, 'the fixture note puts that word on line 15');
});

test('kb_read comes back as the note itself', (t) => {
  const r = core.createServer({ root: fixture(t) })
    .callTool('kb_read', { path: '.joserah/knowledge/wiki/topics/backup.md' });
  assert.ok(!r.isError);
  assert.match(r.content[0].text, /^path: \.joserah\/knowledge\/wiki\/topics\/backup\.md\n/);
});

test('a mistake the caller can fix comes back as isError, not as a protocol error', (t) => {
  const server = core.createServer({ root: fixture(t) });
  const missing = server.callTool('kb_read', { path: 'keys/AGENTS.md' });
  assert.strictEqual(missing.isError, true);
  assert.match(missing.content[0].text, /no note at keys\/AGENTS\.md/);
  assert.strictEqual(server.callTool('kb_search', {}).isError, true);
  assert.strictEqual(server.callTool('kb_read', {}).isError, true);
});

test('an unknown tool throws a protocol error, and so does a tool allow hides', (t) => {
  const root = fixture(t);
  const open = core.createServer({ root });
  assert.throws(() => open.callTool('kb_delete', {}), (err) => err.rpcCode === -32602);

  // The whole of the Part 2 seam: a filter over names. The core learns nothing
  // about who is calling and holds no vocabulary for it.
  const readOnly = core.createServer({ root, allow: (name) => name !== 'kb_list' });
  assert.deepStrictEqual(readOnly.listTools().map((x) => x.name), ['kb_search', 'kb_read']);
  assert.throws(() => readOnly.callTool('kb_list', {}), (err) => err.rpcCode === -32602);
  assert.ok(readOnly.callTool('kb_search', { query: 'backup' }).content[0].text);
});

test('the core holds no authentication, identity or panel vocabulary', () => {
  const src = fs.readFileSync(path.join(PLUGIN_ROOT, 'mcp', 'lib', 'core.js'), 'utf8');
  for (const forbidden of [/\bACL\b/, /\btoken\b/i, /\bauth/i, /x-zc-/i, /permission/i, /\bemail\b/i]) {
    assert.doesNotMatch(src, forbidden, `${forbidden} belongs to the corporate wrapper, not the core`);
  }
});
