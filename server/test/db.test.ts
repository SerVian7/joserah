import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { signedIn, trackerPage, ORIGIN, REPO_ROOT } from './helpers.ts';
import type { BusEvent } from '../src/events.ts';
import { answersLib } from '../src/cjs.ts';

const DAY = '2026-10-06';
const put = (cookie: string, _id: string, body: unknown) => ({ method: 'PUT', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('PUT then GET an answer, and subscribers hear it', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  const seen: BusEvent[] = []; deps.bus.subscribe((_i, e) => seen.push(e));
  const r = await app.request(`/api/db/${DAY}/daily-tracker/answers/a-x-1`, put(cookie, 'a-x-1', { row: 'X', key: 'A', note: 'yes', at: '2026-10-06T08:00:00Z', state: 'new' }));
  assert.equal(r.status, 200);
  const g = await (await app.request(`/api/db/${DAY}/daily-tracker/answers`, { headers: { cookie } })).json();
  assert.deepEqual(g.docs, [{ id: 'a-x-1', data: { row: 'X', key: 'A', note: 'yes', at: '2026-10-06T08:00:00Z', state: 'new' } }]);
  assert.deepEqual(seen.filter((e) => e.type === 'answers'), [{ type: 'answers', page: `${DAY}/daily-tracker` }]);
});

test('an owner write never replaces an assistant document (route)', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  const rep = answersLib.reply(dir, 'a-x-1', 'assistant text');
  assert.ok(rep.ok && rep.id);
  const r = await app.request(`/api/db/${DAY}/daily-tracker/answers/${rep.id}`, put(cookie, rep.id!, { note: 'mine now' }));
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'not-yours' });
});

test('bad id is 400, unknown page is 404', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  assert.equal((await app.request(`/api/db/${DAY}/daily-tracker/answers/BAD`, put(cookie, 'BAD', { note: 'x' }))).status, 400);
  assert.equal((await app.request(`/api/db/${DAY}/nope/answers/a-1`, put(cookie, 'a-1', { note: 'x' }))).status, 404);
});

test('two writers lose nothing (browser PUTs while the terminal replies)', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  const lib = path.join(REPO_ROOT, 'tools', 'lib', 'answers.js').replace(/\\/g, '/');
  const cli = new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', `const A=require(${JSON.stringify(lib)});for(let i=0;i<30;i++){if(!A.reply(process.argv[1],'a-b-'+i,'r',1700000000000+i).ok)process.exit(2)}`, dir], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`exit ${c}`))));
  });
  for (let i = 0; i < 30; i++) assert.equal((await app.request(`/api/db/${DAY}/daily-tracker/answers/a-o-${i}`, put(cookie, `a-o-${i}`, { note: 'n' }))).status, 200);
  await cli;
  const docs = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8')).docs;
  assert.equal(Object.keys(docs).length, 60);
});

// Added: a write the library cannot complete answers JSON, never an HTML 500 or a crashed request.
test('a failing write answers JSON, not a crash', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  fs.mkdirSync(path.join(dir, 'answers.json'));   // the library cannot read a directory
  const r = await app.request(`/api/db/${DAY}/daily-tracker/answers/a-x-1`, put(cookie, 'a-x-1', { note: 'x' }));
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'write-failed' });
});

// Added: a body that is not JSON is bad-doc; the stamp and /api/me answer; the API needs a session; the shim is served.
test('bad body, stamp, me, the signed-out answer and the shim file', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  const bad = await app.request(`/api/db/${DAY}/daily-tracker/answers/a-x-1`, { method: 'PUT', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'bad-doc' });
  const s = await (await app.request(`/api/stamp/${DAY}/daily-tracker`, { headers: { cookie } })).json();
  assert.ok(typeof s.stamp === 'number' && s.stamp > 0);
  assert.equal((await app.request(`/api/stamp/${DAY}/nope`, { headers: { cookie } })).status, 404);
  assert.deepEqual(await (await app.request('/api/me', { headers: { cookie } })).json(), { ok: true });
  const out = await app.request(`/api/db/${DAY}/daily-tracker/answers`);
  assert.equal(out.status, 401);
  assert.deepEqual(await out.json(), { error: 'signed-out' });
  const js = await app.request('/_/shim.js', { headers: { cookie } });
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
});
