'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('./helpers');
const L = require('../tools/lib/ledger');

const doc = [
  L.formatLine({ time: '09:00', kind: 'open', job: 'lead', text: 'session S1 agent A1', path: '-' }),
  L.formatLine({ time: '09:05', kind: 'start', job: 'dots-research', text: 'Scout', path: 'scout/0905-dots-research.md' }),
  L.formatLine({ time: '09:06', kind: 'start', job: 'tracker-strip', text: 'Builder', path: 'builder/0906-tracker-strip.md' }),
  L.formatLine({ time: '09:30', kind: 'end', job: 'tracker-strip', text: 'done', path: 'builder/0906-tracker-strip.md' }),
  L.formatLine({ time: '09:31', kind: 'owner', job: 'mail-reply', text: 'approval · send the draft', path: '-' }),
  L.formatLine({ time: '09:40', kind: 'decision', job: '-', text: 'crew on by default', path: '-' }),
].join('\n');

test('open items: started and owner-waiting jobs, not ended ones', () => {
  const o = L.openItems(doc);
  assert.deepStrictEqual(o.jobs.map((j) => j.job).sort(), ['dots-research', 'mail-reply']);
  assert.strictEqual(o.decisions.length, 1);
  assert.strictEqual(o.agentId, 'A1');
  assert.strictEqual(o.sessionId, 'S1');
});

test('unknown kind is refused', () => {
  assert.throws(() => L.formatLine({ time: '09:00', kind: 'maybe', job: 'x', text: 't', path: '-' }), /maybe/);
});

test('separator and newline in text', () => {
  const line = L.formatLine({ time: '10:00', kind: 'start', job: 'j', text: 'a · b\nc', path: 'p.md' });
  assert.ok(!line.includes('\n'));
  assert.deepStrictEqual(L.parseLine(line), { time: '10:00', kind: 'start', job: 'j', text: 'a - b c', path: 'p.md' });
});

test('separator-like text at the edges, empty text, a path with spaces', () => {
  const line = L.formatLine({ time: '10:00', kind: 'end', job: 'j', text: 'a ·', path: 'C:/Users/A B/t.jsonl' });
  assert.deepStrictEqual(L.parseLine(line), { time: '10:00', kind: 'end', job: 'j', text: 'a ·', path: 'C:/Users/A B/t.jsonl' });
  const empty = L.formatLine({ time: '10:00', kind: 'decision', job: '-', text: '', path: '-' });
  assert.strictEqual(L.parseLine(empty).text, '-');
  assert.throws(() => L.formatLine({ time: '10:00', kind: 'start', job: 'two words', text: 't', path: '-' }), /job/);
  assert.throws(() => L.formatLine({ time: '10:00', kind: 'start', job: 'j', text: 't', path: 'a\nb' }), /path/);
  assert.throws(() => L.formatLine({ time: '9:00', kind: 'start', job: 'j', text: 't', path: '-' }), /time/);
  for (const bad of ['', 'not a line', '10:00 · start · j · t', '10:00 · maybe · j · t · -']) assert.strictEqual(L.parseLine(bad), null, bad);
});

test('a job reopened after its end is open again; only the last five decisions', () => {
  const lines = [doc];
  lines.push(L.formatLine({ time: '10:00', kind: 'start', job: 'tracker-strip', text: 'Builder again', path: '-' }));
  for (let i = 0; i < 7; i++) lines.push(L.formatLine({ time: '10:1' + i, kind: 'decision', job: '-', text: 'd' + i, path: '-' }));
  const o = L.openItems(lines.join('\r\n') + '\n');
  assert.ok(o.jobs.some((j) => j.job === 'tracker-strip' && j.text === 'Builder again'));
  assert.deepStrictEqual(o.decisions.map((d) => d.text), ['d2', 'd3', 'd4', 'd5', 'd6']);
});

test('findLedger returns the matching session only, never the newest', (t) => {
  const root = tmpdir(t);
  const dir = path.join(root, '.joserah', 'desk', 'crew', '2026-10-05', 'lead');
  fs.mkdirSync(dir, { recursive: true });
  const open = (s, a) => L.formatLine({ time: '09:00', kind: 'open', job: 'lead', text: `session ${s} agent ${a}`, path: '-' }) + '\n';
  fs.writeFileSync(path.join(dir, 'ledger-0900.md'), open('S1', 'A1'));
  fs.writeFileSync(path.join(dir, 'ledger-1000.md'), open('S10', 'A2'));
  assert.strictEqual(L.findLedger(root, '2026-10-05', 'S1'), path.join(dir, 'ledger-0900.md'));
  assert.strictEqual(L.findLedger(root, '2026-10-05', 'S10'), path.join(dir, 'ledger-1000.md'));
  assert.strictEqual(L.findLedger(root, '2026-10-05', 'S9'), null);
  assert.strictEqual(L.findLedger(root, '2026-10-04', 'S1'), null);
  assert.strictEqual(L.findLedger(root, '2026-10-05', ''), null);
});
