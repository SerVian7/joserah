'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
const nf = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'note-format'));

test('parseFrontmatter: no frontmatter yields empty data and untouched body', () => {
  const r = nf.parseFrontmatter('# Title\n\nbody\n');
  assert.strictEqual(r.hasFrontmatter, false);
  assert.deepStrictEqual(r.data, {});
  assert.strictEqual(r.body, '# Title\n\nbody\n');
});

test('parseFrontmatter: reads simple keys and a list', () => {
  const r = nf.parseFrontmatter('---\ntitle: Zenger Agency\ntype: company\ntags: [zenger, ops]\n---\n\nbody\n');
  assert.strictEqual(r.hasFrontmatter, true);
  assert.strictEqual(r.data.title, 'Zenger Agency');
  assert.strictEqual(r.data.type, 'company');
  assert.deepStrictEqual(r.data.tags, ['zenger', 'ops']);
  assert.strictEqual(r.body, '\nbody\n');
});

test('ensureFrontmatter: adds a block when there is none', () => {
  const r = nf.ensureFrontmatter('# Zenger Agency\n\nbody\n', { title: 'Zenger Agency', type: 'company' });
  assert.strictEqual(r.changed, true);
  assert.match(r.text, /^---\ntitle: Zenger Agency\ntype: company\n---\n\n# Zenger Agency/);
});

test('ensureFrontmatter: is idempotent and preserves unknown keys verbatim', () => {
  const first = nf.ensureFrontmatter('---\ncustom_field: keep me\n---\n\nbody\n',
    { title: 'Note', type: 'note' });
  assert.strictEqual(first.changed, true);
  assert.match(first.text, /custom_field: keep me/);
  const second = nf.ensureFrontmatter(first.text, { title: 'Note', type: 'note' });
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.text, first.text);
});

test('ensureFrontmatter: never overwrites an existing managed key', () => {
  const r = nf.ensureFrontmatter('---\ntitle: Owner Chosen\n---\n\nbody\n',
    { title: 'Derived', type: 'note' });
  assert.match(r.text, /title: Owner Chosen/);
  assert.doesNotMatch(r.text, /title: Derived/);
});
