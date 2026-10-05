import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_PREFIX, composeBrief, cut, BRIEF_MAX } from '../src/briefs.ts';

test('every brief starts with the same stable prefix', () => {
  const a = composeBrief({ task: 'Summarise the week', type: 'digest' });
  const b = composeBrief({ task: 'Fix the link checker', type: 'code', pointers: ['tools/verify-links.js'] });
  assert.ok(a.startsWith(BRIEF_PREFIX + '\n') && b.startsWith(BRIEF_PREFIX + '\n'));
});

test('pointers are paths, never .html pages, and long input is cut with a marker', () => {
  const b = composeBrief({ task: 'x'.repeat(5000), type: 'task', pointers: ['a.md', '.joserah/desk/artifacts/d/f/index.html', 'p'.repeat(400)] });
  assert.ok(!/[\w./-]+\.html\b/.test(b), 'no html path in a brief');
  assert.match(b, /\[cut\]/);
  assert.ok(b.length <= BRIEF_MAX + 6);
  assert.equal(cut('abcdef', 3), 'abc [cut]');
  assert.equal(cut('abc', 3), 'abc');
});
