import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, safeHref } from '../src/markdown.ts';

test('raw html is escaped, never executed', () => {
  const h = renderMarkdown('hi <script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!h.includes('<script>'));
  assert.ok(!/<img[^>]*onerror/.test(h));
  assert.match(h, /&lt;script&gt;/);
});

test('only safe links survive', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref('//evil.example.invalid'), null);
  assert.equal(safeHref('https://example.invalid/a'), 'https://example.invalid/a');
  assert.equal(safeHref('notes.md', (h) => `/x/${h}`), '/x/notes.md');
  const h = renderMarkdown('[a](javascript:alert(1)) [b](https://example.invalid)');
  assert.ok(!h.includes('javascript:'));
  assert.match(h, /<a href="https:\/\/example\.invalid" rel="noopener noreferrer">b<\/a>/);
});

test('gfm tables and Turkish text', () => {
  const h = renderMarkdown('| a | b |\n|---|---|\n| ğüşiöç | İı |');
  assert.match(h, /<table>/);
  assert.match(h, /ğüşiöç/);
});

test('a control character in a link never hides a script scheme', () => {
  assert.equal(safeHref('java\tscript:alert(1)'), null);
  assert.equal(safeHref('\x01javascript:alert(1)'), null);
  assert.equal(safeHref('/\t/evil.example.invalid', (h) => h), null);
  const h = renderMarkdown('[a](<java\tscript:alert(1)>)');
  assert.ok(!/href=/.test(h), h);
});
