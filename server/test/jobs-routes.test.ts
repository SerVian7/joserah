import test from 'node:test';
import assert from 'node:assert/strict';
import { signedIn, ORIGIN } from './helpers.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const post = (cookie: string, body?: unknown) => ({ method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('a job given from the browser runs and can be read back', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  deps.engineHealth = { installed: true, version: '2.1.289', signedIn: true, detail: 'signed in' };
  const r = await app.request('/api/jobs', post(cookie, { text: 'Summarise the week', type: 'digest' }));
  assert.equal(r.status, 201);
  const { id } = await r.json();
  await deps.jobs.idle();
  const g = await (await app.request(`/api/jobs/${id}`, { headers: { cookie } })).json();
  assert.equal(g.job.state, 'done');
  assert.equal(g.job.target, 'server');
  assert.ok(g.stream.some((l: { kind: string; text: string }) => l.kind === 'text' && /Done\./.test(l.text)));
  assert.ok(!JSON.stringify(g).includes('hunter2hunter2'));
});

test('jobs cannot start while Claude Code is not signed in', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  deps.engineHealth = { installed: true, version: '2.1.289', signedIn: false, detail: 'not signed in' };
  const r = await app.request('/api/jobs', post(cookie, { text: 'x' }));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'engine', reason: 'not signed in' });
});

test('refusals map to statuses', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  assert.equal((await app.request('/api/jobs', post(cookie, { text: 'x', type: 'nope' }))).status, 400);
  assert.equal((await app.request('/api/jobs', post(cookie, { text: '' }))).status, 400);
  assert.equal((await app.request('/api/jobs/j-nope', { headers: { cookie } })).status, 404);
  assert.equal((await app.request('/api/jobs/j-nope/cancel', post(cookie))).status, 404);
  const q = deps.jobs.submit({ type: 'query', text: 'q' }); await deps.jobs.idle();
  assert.equal((await app.request(`/api/jobs/${q.id}/approve`, post(cookie))).status, 403);
  const a = deps.jobs.submit({ type: 'task', text: 't' }); await deps.jobs.idle();
  assert.equal((await app.request(`/api/jobs/${a.id}/approve`, post(cookie))).status, 409);
});

test('reply and retry start follow-up jobs', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const a = deps.jobs.submit({ type: 'task', text: 'first' }); await deps.jobs.idle();
  const r1 = await app.request(`/api/jobs/${a.id}/reply`, post(cookie, { text: 'and more' }));
  assert.equal(r1.status, 201);
  const r2 = await app.request(`/api/jobs/${a.id}/retry`, post(cookie));
  assert.equal(r2.status, 201);
  await deps.jobs.idle();
  const kids = deps.jobs.list().filter((j) => j.parentId === a.id);
  assert.equal(kids.length, 2);
});
