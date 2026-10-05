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
