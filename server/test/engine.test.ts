import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ClaudeCliEngine, claudeArgs, parseLine, jobEnv } from '../src/engines/claude-cli.ts';
import type { EngineJob, EngineItem } from '../src/engine.ts';
import { tmpdir, SERVER_ROOT } from './helpers.ts';

// The plan puts these two in helpers.ts; kept here so this task touches no shared file (Lead moves them at merge).
const FAKE_CLAUDE = path.join(SERVER_ROOT, 'test', 'fixtures', 'fake-claude.mjs');
function fakeEngine(extraEnv: Record<string, string> = {}): ClaudeCliEngine {
  return new ClaudeCliEngine({ command: process.execPath, prefixArgs: [FAKE_CLAUDE], extraEnv });
}

const job = (o: Partial<EngineJob> = {}): EngineJob => ({ id: 'j1', type: 'task', target: 'server', brief: 'b', model: 'sonnet', cwd: process.cwd(), budgetUsd: 2, restricted: false, writeArea: [], ...o });
async function collect(run: { events: AsyncIterable<EngineItem> }): Promise<EngineItem[]> { const out: EngineItem[] = []; for await (const x of run.events) out.push(x); return out; }

test('claudeArgs: a general job', () => {
  assert.deepEqual(claudeArgs(job()), ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--max-budget-usd', '2.00', '--permission-prompts', 'none', '--permission-mode', 'acceptEdits']);
});

test('claudeArgs: a restricted job writes only in its area, allow rules last', () => {
  assert.deepEqual(claudeArgs(job({ type: 'ingest', restricted: true, writeArea: ['.joserah/knowledge'], budgetUsd: 0.5 })), [
    '-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--max-budget-usd', '0.50', '--permission-prompts', 'none',
    '--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob,Edit,Write',
    '--allowedTools', 'Edit(.joserah/knowledge/**)', 'Write(.joserah/knowledge/**)',
  ]);
  assert.deepEqual(claudeArgs(job({ type: 'query', restricted: true })).slice(-6), ['--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob']);
});

test('claudeArgs: resume and an owner-approved tool', () => {
  const a = claudeArgs(job({ resumeSessionId: 'sid-1', allowTools: ['Bash'] }));
  assert.deepEqual(a.slice(a.indexOf('--resume'), a.indexOf('--resume') + 2), ['--resume', 'sid-1']);
  assert.deepEqual(a.slice(-2), ['--allowedTools', 'Bash']);
});

test('parseLine maps every recorded line, never throws', () => {
  const lines = fs.readFileSync(path.join(SERVER_ROOT, 'test', 'fixtures', 'stream-ok.jsonl'), 'utf8').trim().split('\n');
  const kinds = lines.flatMap((l) => parseLine(l.replaceAll('SESSION', 's1'))).map((e) => e.kind);
  assert.deepEqual(kinds, ['init', 'other', 'tool', 'turn', 'other', 'text', 'result', 'other']);
  const init = parseLine(lines[0].replaceAll('SESSION', 's1'))[0];
  assert.deepEqual(init, { kind: 'init', sessionId: 's1', model: 'claude-sonnet-test', cliVersion: '2.1.289', tools: ['Read', 'Write'] });
  const res = parseLine(lines[7].replaceAll('SESSION', 's1'))[0];
  assert.deepEqual(res, { kind: 'result', ok: true, subtype: 'success', text: 'Done.', costUsd: 0.0123, turns: 2, denials: [], sessionId: 's1' });
  assert.deepEqual(parseLine('not json'), [{ kind: 'bad-line', text: 'not json' }]);
  assert.deepEqual(parseLine(''), []);
  assert.deepEqual(parseLine('{"type":"system","subtype":"permission_denied","tool_name":"Bash"}'), [{ kind: 'denied', tool: 'Bash' }]);
  assert.deepEqual(parseLine('[1,2]'), [{ kind: 'other', type: 'unknown' }]);
});

test('stdin carries Turkish, quotes and newlines', async (t) => {
  const out = path.join(tmpdir(t), 'stdin.bin');
  const text = `"Şu dosyayı" 'özetle'\nsonra… çğıöşü İ $HOME \`x\` %PATH%`;
  const run = fakeEngine({ FAKE_CLAUDE_STDIN_OUT: out }).start(job({ brief: text }));
  await collect(run); await run.done;
  assert.ok(fs.readFileSync(out).equals(Buffer.from(text, 'utf8')));
});

test('a run streams init, text, result and a bad line', async () => {
  const run = fakeEngine().start(job());
  const items = await collect(run);
  const done = await run.done;
  assert.equal(done.code, 0);
  const kinds = items.map((i) => i.event.kind);
  assert.ok(kinds.includes('init') && kinds.includes('text') && kinds.includes('result') && kinds.includes('bad-line'));
  assert.ok(items.every((i) => typeof i.raw === 'string'));
});

test('cancel kills the whole process tree', async (t) => {
  const pids = path.join(tmpdir(t), 'pids.json');
  const run = fakeEngine({ FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_PIDS: pids }).start(job());
  t.after(() => run.cancel()); // a failed assertion must not leave the hung fake behind
  const it = run.events[Symbol.asyncIterator]();
  await it.next();
  const read = (): number[] | null => { try { return JSON.parse(fs.readFileSync(pids, 'utf8')) as number[]; } catch { return null; } };
  for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 50));
  const [parent, child] = read() ?? [];
  await run.cancel();
  await run.done;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 50 && (alive(parent) || alive(child)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(!alive(parent), 'cli gone');
  assert.ok(!alive(child), 'its child gone too');
});

test('a missing binary ends the run with a spawn error, not a throw', async () => {
  const run = new ClaudeCliEngine({ command: 'definitely-not-claude-xyz' }).start(job());
  await collect(run);
  const d = await run.done;
  assert.match(d.spawnError ?? '', /ENOENT/);
});

test('jobEnv keeps only the allowlist', () => {
  const e = jobEnv({ PATH: '/bin', HOME: '/h', JOSERAH_STATE_DIR: '/s', JOSERAH_NOW: 'x', MY_SECRET: 's', GITHUB_TOKEN: 't', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c', AWS_SECRET_ACCESS_KEY: 'a' }, 'j9');
  assert.deepEqual(Object.keys(e).sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR', 'HOME', 'JOSERAH_JOB_ID', 'PATH', ...(process.platform === 'win32' ? [] : ['LANG'])].sort());
  assert.equal(e.JOSERAH_JOB_ID, 'j9');
});

test('health reads the version and the sign-in state', async () => {
  assert.deepEqual(await fakeEngine().health(), { installed: true, version: '2.1.289', signedIn: true, detail: 'signed in' });
  const out = await fakeEngine({ FAKE_CLAUDE_SIGNED_IN: '0' }).health();
  assert.equal(out.signedIn, false);
  assert.equal(out.detail, 'not signed in');
});
