import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { baseDeps } from './helpers.ts';

test('healthz separates alive, signed in and last job', async (t) => {
  const app = createApp(baseDeps(t, { health: { signedIn: false, lastJobOk: null } }));
  const r = await app.request('/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { alive: true, signedIn: false, lastJobOk: null });
});

test('an unknown api path is 404 JSON, never HTML', async (t) => {
  const r = await createApp(baseDeps(t)).request('/api/nope');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await r.json(), { error: 'not-found' });
});

test('the device prefix is reserved', async (t) => {
  const r = await createApp(baseDeps(t)).request('/api/devices/abc/run', { method: 'POST' });
  assert.equal(r.status, 501);
  assert.deepEqual(await r.json(), { error: 'reserved' });
});
