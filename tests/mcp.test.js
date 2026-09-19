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
