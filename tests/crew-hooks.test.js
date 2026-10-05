'use strict';
// hooks/crew.js — the crew's payload-reading hook (spec "The Ledger", safety net).
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');
// the hook's own state (the pending descriptions) in a folder of this test run alone
process.env.JOSERAH_STATE_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'joserah-crew-test-'));
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

// A Lead with one open job, one closed, one owner-waiting, one decision; today's Daily Tracker with
// one open and one done row (spec "Tests", post-compact).
function compactFixture(t) {
  const ws = wsFor(t);
  hook(ws, 'subagent-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', agent_type: 'lead' }));
  const led = path.join(ws, '.joserah', 'desk', 'crew', '2026-10-05', 'lead', 'ledger-0900.md');
  const add = (...a) => runTool('ledger.js', ['add', led, ...a], { env: { JOSERAH_NOW: '2026-10-05T09:10:00' } });
  add('start', 'open-job', 'Scout', 'scout/0910-open-job.md');
  add('start', 'closed-job', 'Builder', 'builder/0910-closed-job.md');
  add('end', 'closed-job', 'done', 'builder/0910-closed-job.md');
  add('owner', 'wait-job', 'approval - send it', '-');
  add('decision', '-', 'keep the old page', '-');
  const tr = path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-05', 'daily-tracker');
  runTool('tracker.js', ['init', tr, '--title', 'Daily Tracker']);
  fs.writeFileSync(path.join(tr, 'rows.json'), JSON.stringify([{ state: 'you', title: 'Open row' }, { state: 'ok', title: 'Done row' }]));
  return { ws, tr };
}

test('SessionStart compact re-injects open items and open Tracker rows only', (t) => {
  const { ws } = compactFixture(t);
  const r = hook(ws, 'session-start', JSON.stringify({ session_id: 'S1', source: 'compact' }), '2026-10-05T11:00:00');
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  for (const s of ['open-job', 'wait-job', 'keep the old page', 'A1', 'Open row']) assert.ok(ctx.includes(s), s);
  for (const s of ['closed-job', 'Done row']) assert.ok(!ctx.includes(s), s);
  assert.ok(ctx.length < 2000, `under 2,000 characters (${ctx.length})`);
});

test('SessionStart with another source adds nothing', (t) => {
  const ws = wsFor(t);
  const r = hook(ws, 'session-start', JSON.stringify({ session_id: 'S1', source: 'startup' }));
  assert.strictEqual(r.stdout, '');
});

test('re-injection never takes another session\'s Ledger', (t) => {
  const { ws } = compactFixture(t);
  const r = hook(ws, 'session-start', JSON.stringify({ session_id: 'S2', source: 'compact' }), '2026-10-05T11:00:00');
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
  for (const s of ['open-job', 'wait-job', 'keep the old page', 'A1']) assert.ok(!ctx.includes(s), s);
  assert.ok(ctx.includes('Open row'), 'the Daily Tracker is this conversation\'s page, Lead or no Lead');
});

test('a subagent compacting gets the Ledger lines, no Tracker rows', (t) => {
  const { ws } = compactFixture(t);
  const r = hook(ws, 'session-start', JSON.stringify({ session_id: 'S1', agent_id: 'A1', source: 'compact' }), '2026-10-05T11:00:00');
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes('open-job'));
  assert.ok(!ctx.includes('Open row'));
});

test('compact with nothing open adds nothing', (t) => {
  const ws = wsFor(t);
  const r = hook(ws, 'session-start', JSON.stringify({ session_id: 'S1', source: 'compact' }));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

// Safety net (spec "Tracker Crew strip", Mechanics): a crew-role subagent with no strip entry gets one.
function trackerFixture(t) {
  const ws = wsFor(t);
  const tr = path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-05', 'daily-tracker');
  runTool('tracker.js', ['init', tr, '--title', 'Daily Tracker'], { env: { JOSERAH_NOW: '2026-10-05T08:00:00' } });
  return { ws, tr, store: () => JSON.parse(fs.readFileSync(path.join(tr, 'rows.json'), 'utf8')) };
}
const sub = (ws, ev, type, agent = 'A7', now = '2026-10-05T09:00:00') =>
  hook(ws, ev, JSON.stringify({ session_id: 'S1', agent_id: agent, agent_type: type }), now);

test('safety net: a crew worker with no entry is added at start and dimmed at stop', (t) => {
  const { ws, store } = trackerFixture(t);
  const r = sub(ws, 'subagent-start', 'scout');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '', 'a worker\'s start prints nothing');
  assert.deepStrictEqual(store().crew.map(({ role, job, state }) => ({ role, job, state })), [{ role: 'scout', job: 'A7', state: 'work' }]);
  sub(ws, 'subagent-stop', 'scout', 'A7', '2026-10-05T09:20:00');
  const e = store().crew[0];
  assert.strictEqual(e.state, 'idle');
  assert.strictEqual(e.time, '09:20');
});

// A1 (owner, 2026-10-05): every agent appears, also when its role already has an entry; that entry is kept.
test('safety net: an existing entry for the role is kept; the agent gets its own beside it', (t) => {
  const { ws, tr, store } = trackerFixture(t);
  runTool('tracker.js', ['crew', tr, '--role', 'scout', '--job', 'DOTS research', '--state', 'work'], { env: { JOSERAH_NOW: '2026-10-05T08:30:00' } });
  sub(ws, 'subagent-start', 'scout');
  assert.deepStrictEqual(store().crew.map((e) => [e.job, e.state, e.agent]), [['DOTS research', 'work', undefined], ['A7', 'work', 'A7']]);
  sub(ws, 'subagent-stop', 'scout');
  assert.deepStrictEqual(store().crew.map((e) => e.state), ['work', 'idle'], 'the stop touches only its own agent\'s entry');
});

test('safety net: an entry Lead tagged with --agent is dimmed at that agent\'s stop, its link kept', (t) => {
  const { ws, tr, store } = trackerFixture(t);
  runTool('tracker.js', ['crew', tr, '--role', 'scout', '--job', 'DOTS research', '--state', 'work', '--agent', 'A7', '--url', 'r/report.html'], { env: { JOSERAH_NOW: '2026-10-05T08:30:00' } });
  runTool('tracker.js', ['crew', tr, '--role', 'scout', '--job', 'Other job', '--state', 'work', '--agent', 'A8'], { env: { JOSERAH_NOW: '2026-10-05T08:31:00' } });
  sub(ws, 'subagent-stop', 'scout', 'A7', '2026-10-05T09:20:00');
  const [a, b] = store().crew;
  assert.deepStrictEqual([a.job, a.state, a.agent, a.url, a.time], ['DOTS research', 'idle', 'A7', 'r/report.html', '09:20']);
  assert.strictEqual(b.state, 'work', 'another agent\'s entry is untouched');
  assert.strictEqual(store().crew.length, 2, 'no second entry under the agent id');
});

test('safety net: not a crew role, or no Tracker today, writes nothing', (t) => {
  const { ws, tr } = trackerFixture(t);
  const before = fs.readFileSync(path.join(tr, 'rows.json'), 'utf8');
  for (const type of ['general-purpose', '', 'Explore']) {
    assert.strictEqual(sub(ws, 'subagent-start', type).status, 0);
    assert.strictEqual(sub(ws, 'subagent-stop', type).status, 0);
  }
  assert.strictEqual(fs.readFileSync(path.join(tr, 'rows.json'), 'utf8'), before);
  const bare = wsFor(t);
  const r = sub(bare, 'subagent-start', 'scout');
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(bare, '.joserah', 'desk', 'artifacts')));
});

test('safety net: Lead\'s start adds its entry and still prints only its Ledger path', (t) => {
  const { ws, store } = trackerFixture(t);
  const r = sub(ws, 'subagent-start', 'lead', 'A1');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^Your Ledger: \.joserah\/desk\/crew\/2026-10-05\/lead\/ledger-0900\.md$/);
  assert.deepStrictEqual(store().crew.map((e) => [e.role, e.job, e.state]), [['lead', 'A1', 'work']]);
});

test('safety net: a broken rows.json is left alone and the hook exits 0', (t) => {
  const { ws, tr } = trackerFixture(t);
  fs.writeFileSync(path.join(tr, 'rows.json'), '{ broken');
  const r = sub(ws, 'subagent-start', 'scout');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(fs.readFileSync(path.join(tr, 'rows.json'), 'utf8'), '{ broken');
});

// Task 4.6 (owner, 2026-10-05: "never an estimate"): a worker's context size, read from its own
// transcript (measured: <dir of transcript_path>/<session_id>/subagents/agent-<agent_id>.jsonl, live
// from the worker's first tool call, each assistant entry carrying message.usage).
const usageLine = (ts, i, cr, cc) => JSON.stringify({ type: 'assistant', timestamp: ts,
  message: { id: `m-${ts}`, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: i, cache_read_input_tokens: cr, cache_creation_input_tokens: cc, output_tokens: 5 } } });
const localHm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function ctxFixture(t) {
  const fx = trackerFixture(t);
  const agent = `a${process.pid}${Math.random().toString(16).slice(2, 10)}`;
  const proj = path.join(tmpdir(t), 'proj');
  const main = path.join(proj, 'S1.jsonl');
  const agentFile = path.join(proj, 'S1', 'subagents', `agent-${agent}.jsonl`);
  fs.mkdirSync(path.dirname(agentFile), { recursive: true });
  fs.writeFileSync(main, '');
  const write = (...lines) => fs.writeFileSync(agentFile, ['{"type":"user","message":{"role":"user","content":"go"}}', ...lines].join('\n') + '\n');
  const post = (now) => hook(fx.ws, 'post-tool-use', JSON.stringify({ session_id: 'S1', transcript_path: main, agent_id: agent, agent_type: 'scout', tool_name: 'Read' }), now);
  t.after(() => { try { fs.rmSync(require('os').tmpdir() + `/joserah-crew-ctx-S1-${agent}`, { force: true }); } catch { /* gone */ } });
  return { ...fx, agent, main, agentFile, write, post };
}

test('ctx: a worker\'s tool call sets its entry\'s context size from its own transcript', (t) => {
  const f = ctxFixture(t);
  sub(f.ws, 'subagent-start', 'scout', f.agent);
  f.write(usageLine('2026-10-05T06:01:00.000Z', 10, 0, 16904), usageLine('2026-10-05T06:02:00.000Z', 8, 16904, 1930));
  const r = f.post('2026-10-05T09:05:00');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  const e = f.store().crew[0];
  assert.strictEqual(e.ctx, 8 + 16904 + 1930, 'the last assistant message: input + cache read + cache creation');
  assert.strictEqual(e.ctxTime, localHm('2026-10-05T06:02:00.000Z'), 'the time of the figure, not of the hook');
  assert.strictEqual(e.state, 'work');
});

test('ctx: at most once a minute per agent', (t) => {
  const f = ctxFixture(t);
  sub(f.ws, 'subagent-start', 'scout', f.agent);
  f.write(usageLine('2026-10-05T06:02:00.000Z', 1, 100, 0));
  f.post('2026-10-05T09:05:00');
  f.write(usageLine('2026-10-05T06:02:00.000Z', 1, 100, 0), usageLine('2026-10-05T06:02:30.000Z', 1, 200, 0));
  f.post('2026-10-05T09:05:40');
  assert.strictEqual(f.store().crew[0].ctx, 101, 'throttled: 40 s later nothing is read');
  f.post('2026-10-05T09:06:00');
  assert.strictEqual(f.store().crew[0].ctx, 201, 'a minute later the figure moves');
});

test('ctx: nothing measured, nothing written', (t) => {
  const f = ctxFixture(t);
  sub(f.ws, 'subagent-start', 'scout', f.agent);
  const before = () => fs.readFileSync(path.join(f.tr, 'rows.json'), 'utf8');
  const b = before();
  f.post('2026-10-05T09:05:00'); // no transcript yet (measured: none before the first tool call)
  assert.strictEqual(before(), b);
  f.write('{"type":"assistant","timestamp":"2026-10-05T06:02:00.000Z","message":{"content":[]}}', 'not json');
  f.post('2026-10-05T09:07:00'); // no usage anywhere
  assert.strictEqual(before(), b);
  const r = hook(f.ws, 'post-tool-use', JSON.stringify({ session_id: 'S1', transcript_path: f.main, tool_name: 'Read' }));
  assert.strictEqual(r.status, 0, 'the main thread (no agent_id) is not a worker');
  assert.strictEqual(before(), b);
});

test('ctx: only the hook\'s own entry for that agent is touched', (t) => {
  const f = ctxFixture(t);
  runTool('tracker.js', ['crew', f.tr, '--role', 'scout', '--job', 'DOTS research', '--state', 'work'], { env: { JOSERAH_NOW: '2026-10-05T08:30:00' } });
  sub(f.ws, 'subagent-start', 'scout', f.agent); // A1: the agent gets its own entry beside the role's other one
  f.write(usageLine('2026-10-05T06:02:00.000Z', 1, 100, 0));
  f.post('2026-10-05T09:05:00');
  assert.deepStrictEqual(f.store().crew.map((e) => [e.job, e.ctx]), [['DOTS research', undefined], [f.agent, 101]], 'the other entry is not touched');
});

test('ctx: SubagentStop writes the final figure as it dims the entry', (t) => {
  const f = ctxFixture(t);
  sub(f.ws, 'subagent-start', 'scout', f.agent);
  f.write(usageLine('2026-10-05T06:02:00.000Z', 1, 100, 0));
  f.post('2026-10-05T09:05:00');
  f.write(usageLine('2026-10-05T06:02:00.000Z', 1, 100, 0), usageLine('2026-10-05T06:05:10.000Z', 8, 18834, 222));
  const r = hook(f.ws, 'subagent-stop', JSON.stringify({ session_id: 'S1', transcript_path: f.main, agent_id: f.agent, agent_type: 'scout', agent_transcript_path: f.agentFile }), '2026-10-05T09:05:20');
  assert.strictEqual(r.status, 0, r.stderr);
  const e = f.store().crew[0];
  assert.strictEqual(e.state, 'idle');
  assert.strictEqual(e.ctx, 8 + 18834 + 222, 'not throttled at the stop');
  assert.strictEqual(e.ctxTime, localHm('2026-10-05T06:05:10.000Z'));
});

test('ctx: crew.js is registered for PostToolUse, one command string', () => {
  const h = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const cmds = h.PostToolUse.flatMap((e) => e.hooks);
  const c = cmds.find((x) => /hooks\/crew\.js" post-tool-use$/.test(x.command));
  assert.ok(c, 'registered');
  assert.strictEqual(c.shell, 'bash');
  assert.ok(h.PostToolUse.some((e) => e.hooks.includes(c) && (e.matcher === '' || e.matcher === undefined)), 'every tool');
});

test('ctx: an entry Lead wrote with --agent is matched by its agent id first', (t) => {
  const f = ctxFixture(t);
  runTool('tracker.js', ['crew', f.tr, '--role', 'scout', '--job', 'DOTS research', '--state', 'work', '--agent', f.agent], { env: { JOSERAH_NOW: '2026-10-05T08:30:00' } });
  sub(f.ws, 'subagent-start', 'scout', f.agent); // the role has an entry: the hook adds none
  f.write(usageLine('2026-10-05T06:02:00.000Z', 1, 100, 0));
  f.post('2026-10-05T09:05:00');
  assert.deepStrictEqual(f.store().crew.map((e) => [e.job, e.agent, e.ctx]), [['DOTS research', f.agent, 101]]);
});

// A1 (owner, 2026-10-05: "bunu da sık sık yapıyorsun … gerçekten testini yapıp çözmek lazım"): every
// crew agent appears on today's Tracker by itself, no model action needed. Real payloads, captured
// 2026-10-05 (tests/fixtures/hook-payloads): SubagentStart carries no description, so the job comes from
// the Agent tool call — PreToolUse (tool_input.description, before the start) and PostToolUse
// (tool_response.agentId with the same description; at launch for a background agent, at the end for a
// foreground one). Only agent_type / subagent_type are changed here, to a crew role.
const FX = path.join(__dirname, 'fixtures', 'hook-payloads');
const fx = (name, over = {}) => {
  const p = JSON.parse(fs.readFileSync(path.join(FX, `${name}.json`), 'utf8'));
  if (p.agent_type) p.agent_type = 'builder';
  if (p.tool_input && p.tool_input.subagent_type) p.tool_input.subagent_type = 'builder';
  return JSON.stringify({ ...p, ...over });
};
const ev = { PreToolUse: 'pre-tool-use', PostToolUse: 'post-tool-use', SubagentStart: 'subagent-start', SubagentStop: 'subagent-stop' };
const run = (ws, name, now, over) => hook(ws, ev[name.replace(/^(fg|bg)-|\d+$/g, '')], fx(name, over), now);
const strip = (tr) => (fs.readFileSync(path.join(tr, 'index.html'), 'utf8').match(/<section class="crew">[\s\S]*?<\/section>/) || [''])[0];
// the captured payloads share two session ids: their pending lists are cleared before and after each test,
// so a run that used the same payloads (a dry run, an interrupted test) cannot leave one behind
function pendingClean(t) {
  const clear = () => { for (const s of ['304afa0b-b958-48d9-adc9-44e178716e7f', '2fc43959-12c3-4d6f-88b3-645a48ae425b']) try { fs.rmSync(path.join(process.env.JOSERAH_STATE_DIR, `joserah-crew-pending-${s}.json`), { force: true }); } catch { /* gone */ } };
  clear();
  t.after(clear);
}

test('A1: background launches in their measured order — one entry each, job from the description, model/effort from the definition, idle at stop', (t) => {
  pendingClean(t);
  const { ws, tr, store } = trackerFixture(t);
  for (const n of ['bg-PreToolUse1', 'bg-PreToolUse2']) assert.strictEqual(run(ws, n).status, 0);
  assert.strictEqual(run(ws, 'bg-SubagentStart1', '2026-10-05T09:01:00').status, 0);
  let c = store().crew;
  assert.deepStrictEqual(c.map((e) => [e.role, e.job, e.state, e.agent, e.model, e.effort, e.time]),
    [['builder', 'Probe one', 'work', 'a7677bfe7d813817e', 'opus', 'high', '09:01']]);
  assert.match(strip(tr), />Probe one<\/button>/, 're-rendered: the line is on the page');
  run(ws, 'bg-PostToolUse1', '2026-10-05T09:01:00');
  run(ws, 'bg-PostToolUse2', '2026-10-05T09:01:00'); // its SubagentStart comes after (measured)
  run(ws, 'bg-SubagentStart2', '2026-10-05T09:01:00');
  c = store().crew;
  assert.deepStrictEqual(c.map((e) => [e.job, e.state, e.agent]), [['Probe one', 'work', 'a7677bfe7d813817e'], ['Probe two', 'work', 'ab9a3d315a2a8cc37']], 'no duplicate');
  run(ws, 'bg-SubagentStop1', '2026-10-05T09:05:00'); // ab9a… stops first (measured)
  run(ws, 'bg-SubagentStop2', '2026-10-05T09:06:00');
  c = store().crew;
  assert.deepStrictEqual(c.map((e) => [e.job, e.state, e.time]), [['Probe one', 'idle', '09:06'], ['Probe two', 'idle', '09:05']]);
  assert.match(strip(tr), /<li class="crew-none">/, 're-rendered: nothing running');
});
test('A1: a foreground agent — the late PostToolUse never sets a finished entry back to work', (t) => {
  pendingClean(t);
  const { ws, store } = trackerFixture(t);
  run(ws, 'fg-PreToolUse1'); run(ws, 'fg-SubagentStart1'); run(ws, 'fg-SubagentStop1', '2026-10-05T09:03:00'); run(ws, 'fg-PostToolUse1', '2026-10-05T09:03:00');
  assert.deepStrictEqual(store().crew.map((e) => [e.job, e.state, e.agent]), [['Probe job', 'idle', 'a2c4c87ea93f66eaa']]);
});
test('A1: two launches of one role started out of order — the PostToolUse puts each description on its own agent', (t) => {
  pendingClean(t);
  const { ws, store } = trackerFixture(t);
  run(ws, 'bg-PreToolUse1'); run(ws, 'bg-PreToolUse2');
  run(ws, 'bg-SubagentStart2'); // ab9a… starts first: it takes the oldest description, wrongly
  run(ws, 'bg-SubagentStart1');
  run(ws, 'bg-PostToolUse1'); run(ws, 'bg-PostToolUse2');
  const by = Object.fromEntries(store().crew.map((e) => [e.agent, e.job]));
  assert.deepStrictEqual(by, { a7677bfe7d813817e: 'Probe one', ab9a3d315a2a8cc37: 'Probe two' });
  assert.strictEqual(store().crew.length, 2);
});
test('A1: no definition — the model is the one the runtime resolved; a launch without PreToolUse still appears', (t) => {
  pendingClean(t);
  const { ws, store } = trackerFixture(t);
  fs.rmSync(path.join(ws, '.claude', 'agents', 'builder.md'));
  run(ws, 'bg-PostToolUse1');
  assert.deepStrictEqual(store().crew.map((e) => [e.job, e.state, e.model, e.effort]), [['Probe one', 'work', 'claude-haiku-4-5-20251001', undefined]]);
  run(ws, 'fg-SubagentStart1'); // no PreToolUse recorded: its agent id stands in, as before
  assert.deepStrictEqual(store().crew.map((e) => e.job), ['Probe one', 'a2c4c87ea93f66eaa']);
});
test('A1: not a crew role, a non-Agent tool, or no Tracker today writes nothing; a broken store is left alone', (t) => {
  pendingClean(t);
  const { ws, tr } = trackerFixture(t);
  const before = fs.readFileSync(path.join(tr, 'rows.json'), 'utf8');
  const probe = (name) => hook(ws, ev[name.replace(/^(fg|bg)-|\d+$/g, '')], fs.readFileSync(path.join(FX, `${name}.json`), 'utf8'));
  for (const n of ['bg-PreToolUse1', 'bg-SubagentStart1', 'bg-PostToolUse1', 'bg-SubagentStop2']) assert.strictEqual(probe(n).status, 0);
  assert.strictEqual(hook(ws, 'post-tool-use', JSON.stringify({ session_id: 'S1', tool_name: 'Read', tool_input: { file_path: 'x' }, tool_response: {} })).status, 0);
  assert.strictEqual(fs.readFileSync(path.join(tr, 'rows.json'), 'utf8'), before, 'agent type "probe" is no crew role');
  fs.writeFileSync(path.join(tr, 'rows.json'), '{ broken');
  for (const n of ['bg-PreToolUse1', 'bg-SubagentStart1', 'bg-PostToolUse1']) { const r = run(ws, n); assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, ''); }
  assert.strictEqual(fs.readFileSync(path.join(tr, 'rows.json'), 'utf8'), '{ broken');
  const bare = wsFor(t);
  assert.strictEqual(run(bare, 'bg-SubagentStart1').status, 0);
  assert.ok(!fs.existsSync(path.join(bare, '.joserah', 'desk', 'artifacts')));
});
test('A1: crew.js is registered for the Agent tool\'s PreToolUse', () => {
  const h = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const g = h.PreToolUse.find((x) => x.matcher === 'Agent|Task');
  assert.ok(g, 'a PreToolUse group for the Agent tool');
  assert.deepStrictEqual(g.hooks, [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/crew.js" pre-tool-use', shell: 'bash' }]);
});

// Lead, 2026-10-05: one full-suite run saw "Probe job" where the agent id belonged. The pending lists sat at a
// fixed temp path keyed by the captured session ids, so another run at the same time (a second suite, a
// dry run) shared them. The hook keeps them under JOSERAH_STATE_DIR when it is set; these tests use their own.
test('A1: pending descriptions live under JOSERAH_STATE_DIR — a list left elsewhere is never read', (t) => {
  const { ws, store } = trackerFixture(t);
  const shared = path.join(require('os').tmpdir(), 'joserah-crew-pending-2fc43959-12c3-4d6f-88b3-645a48ae425b.json');
  const before = fs.existsSync(shared) ? fs.readFileSync(shared) : null;
  fs.writeFileSync(shared, JSON.stringify([{ tu: 'x', role: 'builder', desc: 'Someone else\'s job', at: Date.now() }]));
  t.after(() => { if (before) fs.writeFileSync(shared, before); else fs.rmSync(shared, { force: true }); });
  const own = path.join(tmpdir(t), 'state');
  fs.mkdirSync(own);
  const p = JSON.parse(fs.readFileSync(path.join(FX, 'fg-SubagentStart1.json'), 'utf8'));
  p.agent_type = 'builder';
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'crew.js'), 'subagent-start'],
    { cwd: ws, input: JSON.stringify(p), encoding: 'utf8', env: { ...process.env, JOSERAH_NOW: '2026-10-05T09:00:00', JOSERAH_STATE_DIR: own }, timeout: 8000 });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(store().crew.map((e) => e.job), ['a2c4c87ea93f66eaa'], 'no description of its own: its agent id, not another run\'s');
});
