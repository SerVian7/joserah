import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runnerFor, tmpdir } from './helpers.ts';
import { JobRunner, ensureJobIgnores, rotateLogs, Refused, type JobRecord } from '../src/jobs.ts';
import { cliTracker } from '../src/tracker-bridge.ts';
import { fakeEngine, ORIGIN } from './helpers.ts';

const DAY = '2026-10-06';
const FAKE_SID = '00000000-0000-4000-8000-000000000001';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const rowsOf = (ws: string) => { const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8')); return { rows: Array.isArray(j) ? j : j.rows, crew: Array.isArray(j) ? [] : j.crew }; };
const rec = (ws: string, j: JobRecord) => JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/jobs', j.day, `${j.id}.job.json`), 'utf8'));

test('a job runs, keeps its session id, logs redacted, writes its digest and closes its row', async (t) => {
  const { runner, ws } = runnerFor(t);
  const job = runner.submit({ type: 'digest', text: 'Summarise the week' });
  assert.equal(job.state, 'queued');
  assert.equal(job.target, 'server');
  assert.equal(job.model, 'haiku');
  await runner.idle();
  const r = rec(ws, job);
  assert.equal(r.state, 'done');
  assert.equal(r.sessionId, FAKE_SID, 'taken from the raw event before redaction');
  assert.equal(r.cliVersion, '2.1.289');
  assert.equal(r.costUsd, 0.0123);
  const log = fs.readFileSync(path.join(ws, '.joserah/desk/jobs', DAY, `${job.id}.jsonl`), 'utf8');
  assert.ok(!log.includes('hunter2hunter2'), 'redacted');
  const md = fs.readFileSync(path.join(ws, '.joserah/desk/jobs', DAY, `${job.id}.md`), 'utf8');
  assert.match(md, /^# Job /m); assert.match(md, /Cost estimate: \$0\.0123 \(CLI estimate\)/); assert.match(md, /Claude Code: 2\.1\.289/);
  const { rows, crew } = rowsOf(ws);
  const row = rows.find((x: { title: string }) => x.title === job.rowTitle);
  assert.equal(row.state, 'ok');
  assert.equal(row.url, `${ORIGIN}/jobs/${job.id}`);
  assert.equal(crew.find((c: { job: string }) => c.job === job.rowTitle).state, 'idle', 'strip cleared at the end');
});

test('denied tool calls end needs-approval with an owner row', async (t) => {
  const { runner, ws } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'deny' } });
  const job = runner.submit({ type: 'task', text: 'Build it' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'needs-approval');
  assert.deepEqual(runner.get(job.id)!.denials, ['Bash']);
  const row = rowsOf(ws).rows.find((x: { title: string }) => x.title === job.rowTitle);
  assert.equal(row.state, 'you');
  assert.match(row.small, /Bash/);
});

test('the money cap ends a job failed with the reason', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'budget' } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.match(runner.get(job.id)!.error!, /money cap \$2\.00/);
});

test('the turn limit stops a runaway job', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'turns' }, config: { jobMaxTurns: 5 } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.match(runner.get(job.id)!.error!, /turn limit 5/);
});

test('the timeout stops a hung job', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'hang' }, config: { jobTimeoutMin: 0.005 } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.match(runner.get(job.id)!.error!, /timeout/);
});

test('the owner cancels a running job', async (t) => {
  const { runner, ws } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'hang' } });
  const job = runner.submit({ type: 'task', text: 'x' });
  for (let i = 0; i < 100 && runner.get(job.id)!.state !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
  await runner.cancel(job.id);
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'cancelled');
  assert.equal(rowsOf(ws).rows.find((x: { title: string }) => x.title === job.rowTitle).state, 'you');
});

test('a crash ends failed with the first stderr line', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'crash' } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.equal(runner.get(job.id)!.error, 'boom');
});

test('one job at a time by default; the second waits', async (t) => {
  const { runner } = runnerFor(t);
  const a = runner.submit({ type: 'task', text: 'first' });
  const b = runner.submit({ type: 'task', text: 'second' });
  assert.equal(runner.get(b.id)!.state, 'queued');
  await runner.idle();
  assert.ok(runner.get(b.id)!.startedAt! >= runner.get(a.id)!.endedAt!);
  assert.notEqual(a.rowTitle, b.rowTitle);
});

test('recover marks running jobs interrupted and keeps the queue', async (t) => {
  const { runner, ws, deps } = runnerFor(t);
  const tracker = cliTracker(ws, 'en');
  const mk = (id: string, state: string): JobRecord => ({ id, day: DAY, type: 'task', target: 'server', text: id, state: state as JobRecord['state'], createdAt: `${DAY}T08:00:0${id.slice(-1)}.000Z`, model: 'sonnet', budgetUsd: 2, rowTitle: `${id} · 08:00`, turns: 0 });
  tracker.row({ title: 'j-running · 08:00', state: 'run' });
  tracker.crew({ role: 'builder', job: 'j-running · 08:00', state: 'work', row: 'j-running · 08:00' });
  deps.store.writeJson(`.joserah/desk/jobs/${DAY}/j-running.job.json`, mk('j-running', 'running'));
  deps.store.writeJson(`.joserah/desk/jobs/${DAY}/j-queued2.job.json`, mk('j-queued2', 'queued'));
  runner.recover();
  await runner.idle();
  assert.equal(runner.get('j-running')!.state, 'interrupted');
  assert.equal(runner.get('j-queued2')!.state, 'done', 'queued jobs still run');
  const { rows, crew } = rowsOf(ws);
  assert.equal(rows.find((x: { title: string }) => x.title === 'j-running · 08:00').state, 'you');
  assert.equal(crew.find((c: { job: string }) => c.job === 'j-running · 08:00').state, 'idle');
});

test('reply resumes the same session', async (t) => {
  const argsOut = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_ARGS_OUT: argsOut } });
  const a = runner.submit({ type: 'task', text: 'first' });
  await runner.idle();
  const b = runner.reply(a.id, 'and also the second part');
  await runner.idle();
  const args = JSON.parse(fs.readFileSync(argsOut, 'utf8')) as string[];
  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', FAKE_SID]);
  assert.equal(runner.get(b.id)!.parentId, a.id);
  assert.equal(runner.get(b.id)!.state, 'done');
});

test('reply falls back to a fresh job from the digest when resume fails', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'resume-fail' } });
  const a = runner.submit({ type: 'task', text: 'first' });
  await runner.idle();
  const b = runner.reply(a.id, 'more');
  await runner.idle();
  assert.equal(runner.get(b.id)!.state, 'failed');
  const fresh = runner.list().find((j) => j.fallbackOf === b.id)!;
  assert.ok(fresh, 'a fresh job was started');
  assert.equal(fresh.state, 'done');
  assert.ok(fresh.pointers!.some((p) => p.endsWith(`${a.id}.md`)));
});

test('approve resumes with the denied tool allowed; restricted types may not widen', async (t) => {
  const argsOut = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'deny', FAKE_CLAUDE_ARGS_OUT: argsOut } });
  const a = runner.submit({ type: 'task', text: 'build' });
  await runner.idle();
  runner.approve(a.id);
  await runner.idle();
  const args = JSON.parse(fs.readFileSync(argsOut, 'utf8')) as string[];
  assert.deepEqual(args.slice(-2), ['--allowedTools', 'Bash']);
  const q = runner.submit({ type: 'query', text: 'what?' });
  await runner.idle();
  assert.throws(() => runner.approve(q.id), (e: unknown) => e instanceof Refused && (e as Refused).code === 'restricted');
});

test('bad input is refused', (t) => {
  const { runner, ws } = runnerFor(t);
  assert.throws(() => runner.submit({ type: 'nope', text: 'x' }), (e: unknown) => (e as Refused).code === 'bad-type');
  assert.throws(() => runner.submit({ type: 'task', text: '   ' }), (e: unknown) => (e as Refused).code === 'bad-text');
  fs.rmSync(path.join(ws, '.joserah', 'config.json'));
  assert.throws(() => runner.submit({ type: 'task', text: 'x' }), (e: unknown) => (e as Refused).code === 'no-workspace');
  assert.equal(ensureJobIgnores(ws), false, 'no .gitignore written into a folder that is not a workspace yet');
});

test('job logs stay out of the backup; old raw logs are rotated', (t) => {
  const { ws, deps } = runnerFor(t);
  assert.equal(ensureJobIgnores(ws), true);
  assert.equal(ensureJobIgnores(ws), false, 'only once');
  const gi = fs.readFileSync(path.join(ws, '.gitignore'), 'utf8');
  assert.match(gi, /^\.joserah\/desk\/jobs\/\*\*\/\*\.jsonl$/m);
  assert.match(gi, /^\.joserah\/desk\/jobs\/\*\*\/\*\.job\.json$/m);
  deps.store.write('.joserah/desk/jobs/2026-08-01/j-old.jsonl', '{}\n');
  deps.store.write('.joserah/desk/jobs/2026-08-01/j-old.md', '# Job');
  deps.store.write(`.joserah/desk/jobs/${DAY}/j-new.jsonl`, '{}\n');
  assert.deepEqual(rotateLogs(deps.store, 30, new Date(`${DAY}T09:00:00`)), ['.joserah/desk/jobs/2026-08-01/j-old.jsonl']);
  assert.ok(fs.existsSync(path.join(ws, '.joserah/desk/jobs/2026-08-01/j-old.md')), 'the digest stays');
});
