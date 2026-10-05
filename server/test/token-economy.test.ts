import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runnerFor, tmpdir, signedIn, ORIGIN, trackerPage } from './helpers.ts';
import { BRIEF_PREFIX, composeBrief } from '../src/briefs.ts';
import { JOB_TYPES, loadServerConfig, ConfigError } from '../src/config.ts';
import { AnswerTrigger, isAck } from '../src/answer-trigger.ts';
import { answersLib } from '../src/cjs.ts';
import { Refused } from '../src/jobs.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('(a) the model never writes or re-reads a page: no brief carries an .html path', async (t) => {
  for (const type of JOB_TYPES) assert.ok(!/[\w./-]+\.html?\b/.test(composeBrief({ type, task: 'x', pointers: ['.joserah/desk/artifacts/d/f/index.html', 'a.md'] })), type);
  const out = path.join(tmpdir(t), 'stdin.txt');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_STDIN_OUT: out } });
  runner.submit({ type: 'task', text: 'tidy the page', pointers: ['.joserah/desk/artifacts/2026-10-06/daily-tracker/index.html', '.joserah/desk/tasks/now.md'] });
  await runner.idle();
  const sent = fs.readFileSync(out, 'utf8');
  assert.ok(!sent.includes('index.html'));
  assert.match(sent, /do not write or re-read any \.html file/);
});

test('(b) a stable prefix first, then the task, then pointers — never file bodies', async (t) => {
  const out = path.join(tmpdir(t), 'stdin.txt');
  const { runner, ws } = runnerFor(t, { env: { FAKE_CLAUDE_STDIN_OUT: out } });
  fs.writeFileSync(path.join(ws, 'big-note.md'), 'BODY-MARKER-should-never-be-pasted\n'.repeat(100));
  runner.submit({ type: 'research', text: 'look at the note', pointers: ['big-note.md'] });
  await runner.idle();
  const a = fs.readFileSync(out, 'utf8');
  runner.submit({ type: 'code', text: 'something else' });
  await runner.idle();
  const b = fs.readFileSync(out, 'utf8');
  assert.ok(a.startsWith(BRIEF_PREFIX + '\n') && b.startsWith(BRIEF_PREFIX + '\n'), 'identical prefix bytes');
  assert.ok(a.indexOf('## Job') < a.indexOf('## Files'));
  assert.match(a, /^- big-note\.md$/m);
  assert.ok(!a.includes('BODY-MARKER'));
});

test('(c) model per job type reaches the CLI; haiku is refused for claim-touching types', async (t) => {
  const out = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_ARGS_OUT: out } });
  const seen: Record<string, string> = {};
  for (const type of ['answers', 'ingest', 'review'] as const) {
    runner.submit({ type, text: 'x' }); await runner.idle();
    const args = JSON.parse(fs.readFileSync(out, 'utf8')) as string[];
    seen[type] = args[args.indexOf('--model') + 1];
  }
  assert.deepEqual(seen, { answers: 'haiku', ingest: 'sonnet', review: 'opus' });
  const ws = tmpdir(t); fs.mkdirSync(path.join(ws, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.joserah', 'server.json'), JSON.stringify({ models: { lint: 'haiku' } }));
  assert.throws(() => loadServerConfig(ws), ConfigError);
});

test('(d) new answers go to one job; acknowledgement-only answers start no model', async (t) => {
  const { runner, ws } = runnerFor(t, { config: { answerStartsJob: true } });
  const d1 = trackerPage(ws, DAY);
  const d2 = path.join(ws, '.joserah/desk/artifacts', DAY, 'other'); fs.mkdirSync(d2, { recursive: true });
  assert.ok(isAck({ note: 'Tamam.' })); assert.ok(isAck({ note: 'thanks!' })); assert.ok(!isAck({ note: 'tamam ama B olsun' })); assert.ok(!isAck({ key: 'A', note: 'ok' }));
  answersLib.put(d1, 'a-1', { note: 'tamam' }, 'owner');
  // fire() does not use the bus (start() does); a long batch window keeps the follow-up timer out of the test.
  let t2 = new AnswerTrigger({ workspace: ws, bus: undefined as never, jobs: runner, config: () => ({ answerStartsJob: true, answerBatchSec: 3600 }) as never });
  t.after(() => t2.stop());
  assert.equal(t2.fire(), null, 'an acknowledgement alone starts nothing');
  assert.equal(answersLib.read(d1).docs['a-1'].state, 'read', 'and is marked read without a model');
  answersLib.put(d1, 'a-2', { key: 'B', note: 'the short one' }, 'owner');
  answersLib.put(d2, 'a-3', { note: 'please also order two' }, 'owner');
  const job = t2.fire()!;
  assert.equal(job.type, 'answers');
  assert.equal(t2.fire(), null, 'one answers job at a time');
  assert.ok(job.pointers!.some((p) => p.includes('answers.js')));
  assert.ok(job.pointers!.some((p) => p.endsWith(`${DAY}/daily-tracker`)) && job.pointers!.some((p) => p.endsWith(`${DAY}/other`)));
  await runner.idle();
  assert.equal(t2.fire(), null, 'answers already handed to a job are not handed again, even if the job left them unread');
  t2.stop();
  t2 = new AnswerTrigger({ workspace: ws, bus: undefined as never, jobs: runner, config: () => ({ answerStartsJob: false }) as never });
  answersLib.put(d1, 'a-4', { note: 'one more' }, 'owner');
  assert.equal(t2.fire(), null, 'answerStartsJob is off by default');
});

test('(e) each job shows its cost as an estimate; home shows today\'s total', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const j = deps.jobs.submit({ type: 'digest', text: 'x' }); await deps.jobs.idle();
  assert.equal(deps.jobs.todayCostUsd(), 0.0123);
  assert.match(await (await app.request(`/jobs/${j.id}`, { headers: { cookie } })).text(), /\$0\.0123 \(estimate\)/);
  assert.match(await (await app.request('/', { headers: { cookie } })).text(), /<p id="cost">Today(&#39;|')s estimated cost: \$0\.0123 \(estimate\) · cap \$10\.00<\/p>/);
});

test('(f) per-job money cap reaches the CLI; the daily budget stops new jobs', async (t) => {
  const out = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_ARGS_OUT: out }, config: { jobBudgetUsd: 1.5, dailyBudgetUsd: 0.02 } });
  runner.submit({ type: 'task', text: 'one' }); await runner.idle();
  const args = JSON.parse(fs.readFileSync(out, 'utf8')) as string[];
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '1.50');
  runner.submit({ type: 'task', text: 'two' }); await runner.idle(); // 0.0246 spent now
  assert.throws(() => runner.submit({ type: 'task', text: 'three' }), (e: unknown) => e instanceof Refused && e.code === 'daily-budget');
});

test('(f) the daily budget answers 429 to the browser', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const base = deps.config();
  deps.config = () => ({ ...base, dailyBudgetUsd: 0.01 });
  deps.jobs.submit({ type: 'task', text: 'x' }); await deps.jobs.idle();
  const r = await app.request('/api/jobs', { method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'y' }) });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, 'daily-budget');
});

test('(d) an answer the owner changes after it was handed to a job is handed again', async (t) => {
  const { runner, ws } = runnerFor(t, { config: { answerStartsJob: true } });
  const d1 = trackerPage(ws, DAY);
  const trig = new AnswerTrigger({ workspace: ws, bus: undefined as never, jobs: runner, config: () => ({ answerStartsJob: true, answerBatchSec: 3600 }) as never });
  t.after(() => trig.stop());
  answersLib.put(d1, 'row-1', { key: 'A' }, 'owner');
  assert.ok(trig.fire());
  await runner.idle();
  assert.equal(trig.fire(), null, 'the same content is not handed twice');
  answersLib.put(d1, 'row-1', { key: 'B' }, 'owner');
  assert.ok(trig.fire(), 'a changed answer on the same id is new work');
  await runner.idle();
});
