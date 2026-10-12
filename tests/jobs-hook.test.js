'use strict';
// hooks/jobs.js: the only writer of .joserah/desk/jobs/_agents.json; pairs by tool_use_id -> agentId.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');
process.env.JOSERAH_STATE_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'joserah-jobs-test-'));
const hook = (cwd, event, payload, now = '2026-10-13T09:00:00') => spawnSync(process.execPath,
  [path.join(PLUGIN_ROOT, 'hooks', 'jobs.js'), event],
  { cwd, input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, JOSERAH_NOW: now }, timeout: 5000 });
const mk = (t, jobs = { a: 'run', b: 'run' }) => {
  const d = tmpdir(t); const dir = path.join(d, '.joserah', 'desk', 'jobs');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(d, '.joserah', 'config.json'), '{}');
  for (const [slug, state] of Object.entries(jobs)) fs.writeFileSync(path.join(dir, slug + '.json'), JSON.stringify({ title: slug, project: 'P', state, started: '2026-10-13T08:00:00+03:00' }));
  return d;
};
const agents = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, '.joserah', 'desk', 'jobs', '_agents.json'), 'utf8')); } catch { return {}; } };
const S = 'sess-1';
const pre = (tu, desc, type = 'builder', extra = {}) => ({ session_id: S, tool_name: 'Agent', tool_use_id: tu, tool_input: { description: desc, prompt: 'go', subagent_type: type, ...extra } });
const post = (tu, id, desc, type = 'builder', status = 'async_launched') => ({ ...pre(tu, desc, type), tool_response: { agentId: id, status, resolvedModel: 'claude-sonnet-5-5' } });
const start = (id, type = 'builder') => ({ session_id: S, agent_id: id, agent_type: type });

test('two agents started together: each pairs to its own job through its tool_use_id, whatever order the events arrive', (t) => {
  const d = mk(t);
  hook(d, 'pre-tool-use', pre('tu1', 'Fix it job:a', 'builder', { model: 'sonnet', effort: 'medium' }));
  hook(d, 'pre-tool-use', pre('tu2', 'Check it job:b', 'scout'));
  hook(d, 'subagent-start', start('A1'));
  hook(d, 'post-tool-use', post('tu1', 'A1', 'Fix it job:a'));
  hook(d, 'post-tool-use', post('tu2', 'A2', 'Check it job:b', 'scout'));
  hook(d, 'subagent-start', start('A2', 'scout'));
  const a = agents(d);
  assert.deepStrictEqual(Object.keys(a).sort(), ['A1', 'A2']);
  assert.strictEqual(a.A1.job, 'a'); assert.strictEqual(a.A1.role, 'builder'); assert.strictEqual(a.A1.state, 'work');
  assert.strictEqual(a.A1.model, 'sonnet'); assert.strictEqual(a.A1.effort, 'medium');
  assert.strictEqual(a.A2.job, 'b'); assert.strictEqual(a.A2.model, 'claude-sonnet-5-5');
  hook(d, 'subagent-stop', start('A2', 'scout'));
  assert.strictEqual(agents(d).A2.state, 'idle'); assert.strictEqual(agents(d).A1.state, 'work');
});

test('a resumed agent moves its own entry back to work: never a second entry', (t) => {
  const d = mk(t);
  hook(d, 'pre-tool-use', pre('tu1', 'x job:a')); hook(d, 'post-tool-use', post('tu1', 'A1', 'x job:a'));
  hook(d, 'subagent-stop', start('A1'));
  hook(d, 'subagent-start', start('A1'));
  const a = agents(d);
  assert.strictEqual(Object.keys(a).length, 1); assert.strictEqual(a.A1.state, 'work'); assert.strictEqual(a.A1.job, 'a');
});

test('no job token or no such job: no entry is created and the writer gets a one-line warning', (t) => {
  const d = mk(t);
  hook(d, 'pre-tool-use', pre('tu1', 'no token here'));
  const r = hook(d, 'post-tool-use', post('tu1', 'A1', 'no token here'));
  assert.deepStrictEqual(agents(d), {});
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /job:<slug>/);
  hook(d, 'pre-tool-use', pre('tu2', 'x job:missing')); hook(d, 'post-tool-use', post('tu2', 'A2', 'x job:missing'));
  assert.deepStrictEqual(agents(d), {});
  hook(d, 'subagent-start', start('A9')); // a start alone never invents a line
  assert.deepStrictEqual(agents(d), {});
});

test('a foreground agent that already finished never gets an entry', (t) => {
  const d = mk(t);
  hook(d, 'pre-tool-use', pre('tu1', 'x job:a')); hook(d, 'subagent-start', start('A1')); hook(d, 'subagent-stop', start('A1'));
  hook(d, 'post-tool-use', post('tu1', 'A1', 'x job:a', 'builder', 'completed'));
  assert.deepStrictEqual(agents(d), {});
});

test('a worker writing its own report log goes idle while the agent keeps running; another role log does not', (t) => {
  const d = mk(t);
  hook(d, 'pre-tool-use', pre('tu1', 'x job:a')); hook(d, 'post-tool-use', post('tu1', 'A1', 'x job:a'));
  const w = (role) => ({ session_id: S, agent_id: 'A1', agent_type: 'builder', tool_name: 'Write', tool_input: { file_path: `${d.replace(/\\/g, '/')}/.joserah/desk/crew/2026-10-13/${role}/0100-x.md` } });
  hook(d, 'post-tool-use', w('scout')); assert.strictEqual(agents(d).A1.state, 'work');
  hook(d, 'post-tool-use', w('builder')); assert.strictEqual(agents(d).A1.state, 'idle');
});

test('sweep: an agent whose job is done goes idle; an entry whose job file is gone is dropped', (t) => {
  const d = mk(t);
  hook(d, 'pre-tool-use', pre('tu1', 'x job:a')); hook(d, 'post-tool-use', post('tu1', 'A1', 'x job:a'));
  hook(d, 'pre-tool-use', pre('tu2', 'y job:b')); hook(d, 'post-tool-use', post('tu2', 'A2', 'y job:b'));
  const dir = path.join(d, '.joserah', 'desk', 'jobs');
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ title: 'a', state: 'done', finished: '2026-10-13T09:30:00+03:00' }));
  fs.rmSync(path.join(dir, 'b.json'));
  hook(d, 'post-tool-use', { session_id: S, tool_name: 'Read', tool_input: {} });
  assert.strictEqual(agents(d).A1.state, 'idle'); assert.strictEqual(agents(d).A2, undefined);
});

test('sweep: an agent that ended without a notice (transcript quiet, last entry end_turn) goes idle; a long tool call does not', (t) => {
  const d = mk(t);
  const sub = path.join(d, 'tr', S, 'subagents'); fs.mkdirSync(sub, { recursive: true });
  const base = { session_id: S, transcript_path: path.join(d, 'tr', S + '.jsonl') };
  for (const [id, job, stop] of [['A1', 'a', 'end_turn'], ['A2', 'b', 'tool_use']]) {
    hook(d, 'pre-tool-use', pre('t' + id, `x job:${job}`)); hook(d, 'post-tool-use', { ...post('t' + id, id, `x job:${job}`), ...base });
    const f = path.join(sub, `agent-${id}.jsonl`);
    fs.writeFileSync(f, JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T08:00:00Z', message: { stop_reason: stop, usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } } }) + '\n');
    const old = new Date('2026-10-13T05:00:00Z'); fs.utimesSync(f, old, old);
  }
  hook(d, 'post-tool-use', { session_id: S, tool_name: 'Read', tool_input: {} }, '2026-10-13T09:00:00');
  assert.strictEqual(agents(d).A1.state, 'idle'); assert.strictEqual(agents(d).A2.state, 'work');
});

test('a worker tool call records its context size from its own transcript', (t) => {
  const d = mk(t);
  const sub = path.join(d, 'tr', S, 'subagents'); fs.mkdirSync(sub, { recursive: true });
  const base = { session_id: S, transcript_path: path.join(d, 'tr', S + '.jsonl') };
  hook(d, 'pre-tool-use', pre('tu1', 'x job:a')); hook(d, 'post-tool-use', { ...post('tu1', 'A1', 'x job:a'), ...base });
  fs.writeFileSync(path.join(sub, 'agent-A1.jsonl'), JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T06:05:00Z', message: { stop_reason: 'tool_use', usage: { input_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } } }) + '\n');
  hook(d, 'post-tool-use', { ...base, agent_id: 'A1', agent_type: 'builder', tool_name: 'Read', tool_input: {} });
  assert.strictEqual(agents(d).A1.ctx, 240);
});

test('a job-file Write runs the checker: errors come back as context, done writes the journal line', (t) => {
  const d = mk(t);
  const f = path.join(d, '.joserah', 'desk', 'jobs', 'bad.json');
  fs.writeFileSync(f, JSON.stringify({ title: 'P: dup', project: 'P', state: 'run' }));
  const r = hook(d, 'post-tool-use', { session_id: S, tool_name: 'Write', tool_input: { file_path: f } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /bad\.json.*project/);
  fs.writeFileSync(f, JSON.stringify({ title: 'Ship it', project: 'P', state: 'done', finished: '2026-10-13T09:00:00+03:00' }));
  assert.strictEqual(hook(d, 'post-tool-use', { session_id: S, tool_name: 'Write', tool_input: { file_path: f } }).stdout, '');
  assert.match(fs.readFileSync(path.join(d, '.joserah', 'desk', 'daily', '2026', '2026-10-13.md'), 'utf8'), /Ship it/);
});

test('silent without a jobs folder, on broken payloads and for a non-crew agent type', (t) => {
  const d = tmpdir(t); fs.mkdirSync(path.join(d, '.joserah'), { recursive: true }); fs.writeFileSync(path.join(d, '.joserah', 'config.json'), '{}');
  assert.strictEqual(hook(d, 'post-tool-use', post('t', 'A1', 'x job:a')).status, 0);
  assert.ok(!fs.existsSync(path.join(d, '.joserah', 'desk')));
  const e = mk(t);
  for (const p of ['', 'nope', '[]']) assert.strictEqual(spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'jobs.js'), 'post-tool-use'], { cwd: e, input: p, encoding: 'utf8' }).status, 0);
  hook(e, 'pre-tool-use', pre('tu1', 'x job:a', 'probe')); hook(e, 'post-tool-use', post('tu1', 'A1', 'x job:a', 'probe'));
  assert.deepStrictEqual(agents(e), {});
});

test('hooks.json registers jobs.js for the Agent PreToolUse, PostToolUse, SubagentStart and SubagentStop', () => {
  const h = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const ev = { PreToolUse: 'pre-tool-use', PostToolUse: 'post-tool-use', SubagentStart: 'subagent-start', SubagentStop: 'subagent-stop' };
  const has = (e, m) => (h[e] || []).some((g) => (g.matcher || '') === m && g.hooks.some((x) => x.command.includes('hooks/jobs.js"') && x.command.endsWith(ev[e])));
  assert.ok(has('PreToolUse', 'Agent|Task') && has('PostToolUse', '') && has('SubagentStart', '') && has('SubagentStop', ''));
});
