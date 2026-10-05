'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

// Synthetic transcripts in the runtime's layout (verified against a real one,
// 2026-10-05): `<dir>/<session>.jsonl` plus `<dir>/<session>/subagents/agent-<id>.jsonl`.
// An assistant entry carries `message.id`, `message.usage` and an ISO `timestamp`;
// one API message is written as several entries (one per content block) that
// repeat the same input figures while `output_tokens` grows to its final value.
function assistant(id, ts, [input, cacheRead, cacheWrite, output]) {
  return {
    type: 'assistant', timestamp: ts,
    message: {
      id, role: 'assistant', content: [{ type: 'text', text: 'x' }],
      usage: {
        input_tokens: input, cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite, output_tokens: output,
      },
    },
  };
}
const jsonl = (entries) => entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n';

function fixture(t) {
  const dir = tmpdir(t);
  const main = path.join(dir, 'sess-1.jsonl');
  fs.writeFileSync(main, jsonl([
    { type: 'user', timestamp: '2026-01-01T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistant('msg_m1', '2026-01-01T10:00:02.000Z', [10, 100, 1000, 5]),
    assistant('msg_m1', '2026-01-01T10:00:03.000Z', [10, 100, 1000, 50]),
    { type: 'ai-title', title: 't' },
    'not json',
    assistant('msg_m2', '2026-01-01T10:01:30.000Z', [8, 1100, 200, 30]),
  ]));
  const subs = path.join(dir, 'sess-1', 'subagents');
  fs.mkdirSync(subs, { recursive: true });
  fs.writeFileSync(path.join(subs, 'agent-a1.jsonl'), jsonl([
    { type: 'user', timestamp: '2026-01-01T10:00:04.000Z', message: { role: 'user', content: 'task' } },
    assistant('msg_s1', '2026-01-01T10:00:05.000Z', [10, 0, 500, 3]),
    assistant('msg_s1', '2026-01-01T10:00:06.000Z', [10, 0, 500, 40]),
    assistant('msg_s2', '2026-01-01T10:00:40.000Z', [8, 500, 100, 20]),
  ]));
  fs.writeFileSync(path.join(subs, 'agent-a1.meta.json'), '{"agentType":"general-purpose"}\n');
  return main;
}

function run(args) {
  const r = runTool('measure-run.js', args);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('measure-run sums the main transcript and its subagents, one figure per API message', (t) => {
  const out = run([fixture(t)]);
  assert.deepStrictEqual(out, {
    wallSeconds: 90, sessions: 2,
    tokens: { input: 36, output: 140, cacheRead: 1700, cacheWrite: 1800 },
  });
});

test('measure-run counts only entries between --from and --to, and the wall time is that window', (t) => {
  const out = run([fixture(t), '--from', '2026-01-01T10:00:00Z', '--to', '2026-01-01T10:00:30Z']);
  assert.deepStrictEqual(out, {
    wallSeconds: 30, sessions: 2,
    tokens: { input: 20, output: 90, cacheRead: 100, cacheWrite: 1500 },
  });
});

test('measure-run counts a session only when it has a message inside the window', (t) => {
  const out = run([fixture(t), '--from', '2026-01-01T10:01:00Z', '--to', '2026-01-01T10:02:00Z']);
  assert.deepStrictEqual(out, {
    wallSeconds: 60, sessions: 1,
    tokens: { input: 8, output: 30, cacheRead: 1100, cacheWrite: 200 },
  });
});

test('measure-run exits 1 on a missing transcript or a bad time, instead of reporting zeros', (t) => {
  const dir = tmpdir(t);
  const missing = runTool('measure-run.js', [path.join(dir, 'none.jsonl')]);
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /not found/i);
  const bad = runTool('measure-run.js', [fixture(t), '--from', 'yesterday']);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /--from/);
  const none = runTool('measure-run.js', []);
  assert.strictEqual(none.status, 1);
});
