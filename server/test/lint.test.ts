import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { msUntil, LintScheduler } from '../src/lint-scheduler.ts';
import { runnerFor, tmpdir, signedIn, ORIGIN } from './helpers.ts';
import { cliTracker } from '../src/tracker-bridge.ts';
import { DEFAULT_CONFIG, type ServerConfig } from '../src/config.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const put = (ws: string, rel: string, text: string) => { const p = path.join(ws, '.joserah/knowledge', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

function sched(t: import('node:test').TestContext, env: Record<string, string> = {}, cfg: Partial<ServerConfig> = {}) {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...cfg };
  const { runner, deps, ws } = runnerFor(t, { env, config: cfg });
  fs.rmSync(path.join(ws, '.joserah/knowledge'), { recursive: true, force: true }); // start from an empty wiki: the scaffold's READMEs would be pages too
  const s = new LintScheduler({ workspace: ws, stateDir: tmpdir(t), store: deps.store, bus: deps.bus, jobs: runner, tracker: cliTracker(ws, 'en'), config: () => config, lang: 'en', debounceMs: 10 });
  t.after(() => s.stop());
  return { s, ws, runner, deps };
}

test('msUntil: later today, else tomorrow', () => {
  assert.equal(msUntil('03:30', new Date(2026, 9, 6, 3, 0)), 30 * 60000);
  assert.equal(msUntil('03:30', new Date(2026, 9, 6, 4, 0)), (23 * 60 + 30) * 60000);
});

test('deterministic lint runs on a knowledge change, writes latest.json and the index', async (t) => {
  const { s, ws, deps } = sched(t);
  s.start();
  put(ws, 'wiki/topics/a.md', '# A\n\n[x](missing.md)\n');
  deps.store.pollOnce();
  await new Promise((r) => setTimeout(r, 100));
  const latest = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/lint/latest.json'), 'utf8'));
  assert.ok(latest.findings.some((f: { kind: string }) => f.kind === 'broken-link'));
  assert.match(fs.readFileSync(path.join(ws, '.joserah/knowledge/wiki/index.md'), 'utf8'), /\[A\]\(topics\/a\.md\)/);
});

test('the model pass runs only over the changed set', async (t) => {
  const { s, ws, runner } = sched(t);
  put(ws, 'wiki/topics/a.md', '# A\n');
  assert.deepEqual(s.changedSet(), ['wiki/topics/a.md']);
  const job = s.runLlm()!;
  assert.equal(job.type, 'lint');
  assert.deepEqual(job.pointers, ['.joserah/knowledge/wiki/topics/a.md']);
  await runner.idle();
  assert.deepEqual(s.changedSet(), [], 'covered set remembered');
  assert.equal(s.runLlm(), null, 'nothing changed: no model');
});

test('conflicts the lint job quotes become owner rows', async (t) => {
  const conflicts = JSON.stringify([{ a: { path: 'wiki/x.md', quote: 'runs at 50 fps' }, b: { path: 'wiki/y.md', quote: 'runs at 25 fps' }, note: 'frame rate disagrees' }]);
  const { s, ws, runner } = sched(t, { FAKE_CLAUDE_WRITE: `.joserah/knowledge/.lint/conflicts.json:${conflicts}` });
  put(ws, 'wiki/x.md', '# X\nruns at 50 fps\n');
  s.runLlm(); await runner.idle();
  const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8'));
  const row = (Array.isArray(j) ? j : j.rows).find((r: { title: string }) => r.title.startsWith('Wiki conflict: wiki/x.md vs wiki/y.md'));
  assert.equal(row.state, 'you');
  assert.match(row.small, /"runs at 50 fps" ↔ "runs at 25 fps"/);
  assert.match(fs.readFileSync(path.join(ws, '.joserah/knowledge/wiki/log.md'), 'utf8'), /lint \| 1 conflict/);
});

test('unreadable conflicts output fails closed: an owner row, nothing marked checked', async (t) => {
  const { s, ws, runner } = sched(t, { FAKE_CLAUDE_WRITE: '.joserah/knowledge/.lint/conflicts.json:not json' });
  put(ws, 'wiki/x.md', '# X\n');
  s.runLlm(); await runner.idle();
  const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8'));
  assert.ok((Array.isArray(j) ? j : j.rows).some((r: { title: string; state: string }) => r.title.startsWith('Wiki check output unreadable') && r.state === 'you'));
  assert.deepEqual(s.changedSet(), ['wiki/x.md'], 'not marked as checked');
});

test('nightly runs once a day, catches up after a missed night, and the model pass stays off by default', (t) => {
  const { s, runner } = sched(t);
  assert.equal(s.nightly(new Date(2026, 9, 6, 3, 31)), true);
  assert.equal(s.nightly(new Date(2026, 9, 6, 4, 0)), false, 'lock: once a day');
  assert.equal(runner.list().length, 0, 'nightlyLlmLint is off: no job');
  assert.equal(s.nightly(new Date(2026, 9, 7, 9, 0)), true, 'next day');
});

test('lint routes', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/a.md', '# A\n\n[x](missing.md)\n');
  const r = await app.request('/api/lint', { method: 'POST', headers: { cookie, origin: ORIGIN } });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).findings >= 1);
  const html = await (await app.request('/w/lint', { headers: { cookie } })).text();
  assert.match(html, /broken-link/);
  assert.match(html, /data-lint="llm"/);
});

test('a second model pass while one is queued or running returns that job and starts no new one', async (t) => {
  const { s, ws, runner } = sched(t);
  put(ws, 'wiki/topics/a.md', '# A\n');
  const first = s.runLlm()!;
  const second = s.runLlm()!;
  assert.equal(second.id, first.id);
  await runner.idle();
  assert.equal(runner.list().filter((j) => j.type === 'lint').length, 1);
});

test('a conflicts file left by an earlier run is not read as this run\'s answer', async (t) => {
  const { s, ws, runner } = sched(t);
  put(ws, '.lint/conflicts.json', 'stale, not json');
  put(ws, 'wiki/x.md', '# X\n');
  s.runLlm(); await runner.idle();
  const p = path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json');
  const rows = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  assert.ok(!(Array.isArray(rows) ? rows : rows.rows).some((r: { title: string }) => r.title.startsWith('Wiki check output unreadable')));
  assert.deepEqual(s.changedSet(), [], 'the pass finished and covered the page');
});

test('start() catches up a missed night once, and the nightly timer is cleared by stop()', (t) => {
  const { s, ws } = sched(t); // JOSERAH_NOW is 09:00, past 03:30
  s.start();
  assert.ok(fs.existsSync(path.join(ws, '.joserah/desk/lint/latest.json')));
  assert.equal(s.nightly(), false, 'catch-up already took today\'s lock');
  s.stop();
});

test('POST /api/lint/llm: nothing changed answers 200 with a reason', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  fs.rmSync(path.join(deps.workspace, '.joserah/knowledge'), { recursive: true, force: true });
  const r = await app.request('/api/lint/llm', { method: 'POST', headers: { cookie, origin: ORIGIN } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: null, reason: 'nothing changed' });
});

test('a pass covers at most what the brief can carry; the rest stays in the changed set for the next pass', async (t) => {
  const { s, ws, runner } = sched(t);
  for (let i = 0; i < 25; i++) put(ws, `wiki/topics/p${String(i).padStart(2, '0')}.md`, `# P${i}\n`);
  const job = s.runLlm()!;
  assert.equal(job.pointers!.length, 20);
  await runner.idle();
  assert.equal(s.changedSet().length, 5, 'the five the model never saw are still unchecked');
  s.runLlm(); await runner.idle();
  assert.deepEqual(s.changedSet(), []);
});
