'use strict';
// hooks/crew.js — the crew's payload-reading hook (spec "The Ledger", safety net).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');
const hook = (cwd, event, payload, now = '2026-10-05T09:00:00') => spawnSync(process.execPath,
  [path.join(PLUGIN_ROOT, 'hooks', 'crew.js'), event],
  { cwd, input: payload, encoding: 'utf8', env: { ...process.env, JOSERAH_NOW: now }, timeout: 5000 });
const wsFor = (t) => { const d = path.join(tmpdir(t), 'ws'); runTool('scaffold.js', ['--target', d, '--workspace', 'w', '--owner', 'A B']); return d; };
const leadDir = (ws, day = '2026-10-05') => path.join(ws, '.joserah', 'desk', 'crew', day, 'lead');

test('SubagentStart for lead creates the Ledger and names it', (t) => {
  const ws = wsFor(t);
  const r = hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }));
  assert.strictEqual(r.status, 0, r.stderr);
  const f = path.join(ws, '.joserah', 'desk', 'crew', '2026-10-05', 'lead', 'ledger-0900.md');
  assert.match(fs.readFileSync(f, 'utf8'), /^09:00 · open · lead · session S1 agent A1 · -/);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /ledger-0900\.md/);
});

test('empty or broken payload is a silent no-op', (t) => {
  const ws = wsFor(t);
  for (const p of ['', 'not json', '{', 'null', '"lead"']) {
    const r = hook(ws, 'subagent-start', p);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  }
  assert.ok(!fs.existsSync(path.join(ws, '.joserah', 'desk', 'crew')));
});

test('crew off: nothing is written', (t) => {
  const ws = wsFor(t);
  const p = path.join(ws, '.joserah', 'config.json');
  fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(fs.readFileSync(p, 'utf8')), crew: false }));
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }));
  assert.ok(!fs.existsSync(path.join(ws, '.joserah', 'desk', 'crew')));
});

test('stdin never closed: the hook still exits 0 within the idle timer', (t) => {
  const ws = wsFor(t);
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const c = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'crew.js'), 'subagent-start'],
      { cwd: ws, env: { ...process.env, JOSERAH_NOW: '2026-10-05T09:00:00' } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stdin.write('{"session_id":"S1"'); // and never end it
    const kill = setTimeout(() => { c.kill(); reject(new Error('hook hung on an open stdin')); }, 5000);
    c.on('exit', (code) => {
      clearTimeout(kill);
      try {
        assert.strictEqual(code, 0);
        assert.strictEqual(out, '');
        assert.ok(Date.now() - started < 5000);
        resolve();
      } catch (e) { reject(e); }
    });
  });
});

test('a plugin-namespaced lead type counts; another type or an unknown event makes no Ledger', (t) => {
  const ws = wsFor(t);
  for (const type of ['general-purpose', '', 'leader']) {
    const r = hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: type }));
    assert.strictEqual(r.status, 0);
  }
  const bad = hook(ws, 'no-such-event', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }));
  assert.strictEqual(bad.status, 0);
  assert.strictEqual(bad.stdout, '');
  assert.ok(!fs.existsSync(leadDir(ws)));
  const r = hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'joserah:lead' }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(leadDir(ws), 'ledger-0900.md')));
});

test('a resumed Lead keeps its Ledger; a second Lead in the same minute gets its own', (t) => {
  const ws = wsFor(t);
  const start = (s, a) => hook(ws, 'subagent-start', JSON.stringify({ session_id: s, agent_id: a, agent_type: 'lead' }));
  start('S1', 'A1');
  const again = start('S1', 'A1');
  assert.match(JSON.parse(again.stdout).hookSpecificOutput.additionalContext, /ledger-0900\.md/);
  assert.deepStrictEqual(fs.readdirSync(leadDir(ws)), ['ledger-0900.md']);
  start('S2', 'A2');
  const names = fs.readdirSync(leadDir(ws)).sort();
  assert.strictEqual(names.length, 2);
  assert.match(fs.readFileSync(path.join(leadDir(ws), names[1]), 'utf8'), /session S2 agent A2/);
});

test('stamp goes to the matching session only', (t) => {
  const ws = wsFor(t);
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }), '2026-10-05T09:00:00');
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S2', agent_id: 'A2', agent_type: 'lead' }), '2026-10-05T10:00:00');
  hook(ws, 'pre-compact', JSON.stringify({ session_id: 'S2', trigger: 'auto', transcript_path: '/t/s2.jsonl' }), '2026-10-05T11:00:00');
  hook(ws, 'session-end', JSON.stringify({ session_id: 'S2', reason: 'other', transcript_path: '/t/s2.jsonl' }), '2026-10-05T12:00:00');
  const dir = path.join(ws, '.joserah', 'desk', 'crew', '2026-10-05', 'lead');
  const s1 = fs.readFileSync(path.join(dir, 'ledger-0900.md'), 'utf8');
  const s2 = fs.readFileSync(path.join(dir, 'ledger-1000.md'), 'utf8');
  assert.doesNotMatch(s1, /compact|session-end/);
  assert.match(s2, /11:00 · compact · - · auto · \/t\/s2\.jsonl/);
  assert.match(s2, /12:00 · session-end · - · other · \/t\/s2\.jsonl/);
});

test('no matching Ledger: nothing is written', (t) => {
  const ws = wsFor(t);
  const r = hook(ws, 'pre-compact', JSON.stringify({ session_id: 'S9', trigger: 'manual', transcript_path: '/t/x' }));
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(ws, '.joserah', 'desk', 'crew')));
});

test('stamps add nothing to context and print nothing', (t) => {
  const ws = wsFor(t);
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }));
  for (const [ev, p] of [['pre-compact', { session_id: 'S1', trigger: 'manual', transcript_path: '/t/a' }],
    ['session-end', { session_id: 'S1', reason: 'other' }]]) {
    const r = hook(ws, ev, JSON.stringify(p), '2026-10-05T09:30:00');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', ev);
  }
  const text = fs.readFileSync(path.join(leadDir(ws), 'ledger-0900.md'), 'utf8');
  assert.match(text, /09:30 · session-end · - · other · -\n$/, 'no transcript_path: the path field is -');
});

test('a session crossing midnight stamps yesterday\'s Ledger', (t) => {
  const ws = wsFor(t);
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }), '2026-10-05T23:50:00');
  hook(ws, 'pre-compact', JSON.stringify({ session_id: 'S1', trigger: 'auto', transcript_path: '/t/a' }), '2026-10-06T00:10:00');
  assert.match(fs.readFileSync(path.join(leadDir(ws), 'ledger-2350.md'), 'utf8'), /00:10 · compact · - · auto · \/t\/a/);
  assert.ok(!fs.existsSync(leadDir(ws, '2026-10-06')));
});

test('a fresh Lead in the same session takes the stamps from then on', (t) => {
  const ws = wsFor(t);
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }), '2026-10-05T09:00:00');
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A2', agent_type: 'lead' }), '2026-10-05T10:00:00');
  hook(ws, 'pre-compact', JSON.stringify({ session_id: 'S1', trigger: 'auto', transcript_path: '/t/a' }), '2026-10-05T11:00:00');
  assert.doesNotMatch(fs.readFileSync(path.join(leadDir(ws), 'ledger-0900.md'), 'utf8'), /compact/);
  assert.match(fs.readFileSync(path.join(leadDir(ws), 'ledger-1000.md'), 'utf8'), /11:00 · compact/);
});
