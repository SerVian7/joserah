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

test('ensureFrontmatter: preserves CRLF byte-for-byte on an existing block', () => {
  const input = '---\r\ncustom_field: keep me\r\n---\r\n\r\nbody\r\n';
  const r = nf.ensureFrontmatter(input, { title: 'Note', type: 'note' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(
    r.text,
    '---\r\ncustom_field: keep me\r\ntitle: Note\r\ntype: note\r\n---\r\n\r\nbody\r\n'
  );
  // No lone LF (an LF not preceded by CR) anywhere — the whole file stays CRLF.
  assert.doesNotMatch(r.text, /[^\r]\n|^\n/);
});

test('ensureFrontmatter: is idempotent on CRLF input', () => {
  const input = '---\r\ncustom_field: keep me\r\n---\r\n\r\nbody\r\n';
  const first = nf.ensureFrontmatter(input, { title: 'Note', type: 'note' });
  const second = nf.ensureFrontmatter(first.text, { title: 'Note', type: 'note' });
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.text, first.text);
});

test('ensureFrontmatter: a new block on a CRLF document uses CRLF, not LF', () => {
  const r = nf.ensureFrontmatter('# Title\r\n\r\nbody\r\n', { title: 'Title', type: 'note' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(
    r.text,
    '---\r\ntitle: Title\r\ntype: note\r\n---\r\n\r\n# Title\r\n\r\nbody\r\n'
  );
});

test('ensureFrontmatter: leaves an unterminated frontmatter block untouched', () => {
  const input = '---\ntitle: X\nno closing delimiter\n';
  const r = nf.ensureFrontmatter(input, { title: 'Note', type: 'note' });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, input);
});
