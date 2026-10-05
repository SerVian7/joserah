'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');
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

test('add appends exactly one line; open prints only open items', (t) => {
  const f = path.join(tmpdir(t), 'ledger-0900.md');
  fs.writeFileSync(f, doc + '\n');
  const env = { env: { JOSERAH_NOW: '2026-10-05T11:00:00' } };
  assert.strictEqual(runTool('ledger.js', ['add', f, 'end', 'dots-research', 'done', 'scout/0905-dots-research.md'], env).status, 0);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert.match(lines.at(-1), /^11:00 · end · dots-research · done · scout\/0905-dots-research\.md$/);
  const out = runTool('ledger.js', ['open', f]).stdout;
  assert.match(out, /mail-reply/);
  assert.doesNotMatch(out, /dots-research|tracker-strip/);
  assert.match(out, /A1/);
});

test('add refuses an unknown kind with exit 1 and leaves the file alone', (t) => {
  const f = path.join(tmpdir(t), 'l.md'); fs.writeFileSync(f, doc + '\n');
  const r = runTool('ledger.js', ['add', f, 'maybe', 'x', 'y']);
  assert.strictEqual(r.status, 1);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), doc + '\n');
});

test('add: no path means -, a missing final newline is mended, a missing Ledger is refused', (t) => {
  const dir = tmpdir(t);
  const f = path.join(dir, 'l.md'); fs.writeFileSync(f, doc);
  const env = { env: { JOSERAH_NOW: '2026-10-05T11:05:00' } };
  assert.strictEqual(runTool('ledger.js', ['add', f, 'decision', '-', 'keep it'], env).status, 0);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), doc + '\n11:05 · decision · - · keep it · -\n');
  const r = runTool('ledger.js', ['add', path.join(dir, 'nope.md'), 'decision', '-', 'x'], env);
  assert.strictEqual(r.status, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'nope.md')), 'a mistyped path makes no stray Ledger');
});

test('stamp appends a hook stamp line and refuses another kind', (t) => {
  const f = path.join(tmpdir(t), 'l.md'); fs.writeFileSync(f, doc + '\n');
  const env = { env: { JOSERAH_NOW: '2026-10-05T12:00:00' } };
  assert.strictEqual(runTool('ledger.js', ['stamp', f, 'compact', 'auto', '/t/s2.jsonl'], env).status, 0);
  assert.strictEqual(runTool('ledger.js', ['stamp', f, 'session-end', 'other', '/t/s2.jsonl'], env).status, 0);
  const tail = fs.readFileSync(f, 'utf8').trim().split('\n').slice(-2);
  assert.deepStrictEqual(tail, ['12:00 · compact · - · auto · /t/s2.jsonl', '12:00 · session-end · - · other · /t/s2.jsonl']);
  assert.strictEqual(runTool('ledger.js', ['stamp', f, 'end', 'x', '/t/x'], env).status, 1);
});
