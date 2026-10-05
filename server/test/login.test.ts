import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { baseDeps, readyAuth, login, ORIGIN, ADDR } from './helpers.ts';

function form(o: Record<string, string>) { return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: new URLSearchParams(o).toString() }; }

test('api 401 vs page redirect', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const app = createApp(deps);
  const api = await app.request('/api/jobs');
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'signed-out' });
  const page = await app.request('/p/tracker?x=1');
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login?next=%2Fp%2Ftracker%3Fx%3D1');
});

test('login sets a strict cookie and redirects to a safe next', async (t) => {
  const deps = baseDeps(t); readyAuth(deps, 'pw-0123456789');
  const app = createApp(deps);
  const r = await app.request('/login', form({ password: 'pw-0123456789', next: '//evil.example.invalid/x' }), ADDR);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
  const c = r.headers.get('set-cookie') ?? '';
  assert.match(c, /^jsid=/); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\//);
  assert.doesNotMatch(c, /Secure/, 'plain http on 127.0.0.1');
  const ok = await app.request('/api/nope', { headers: { cookie: c.split(';')[0] } });
  assert.equal(ok.status, 404, 'signed in: the request reaches routing');
});

test('wrong password is 401, the sixth try in a minute is 429', async (t) => {
  const deps = baseDeps(t); readyAuth(deps, 'pw-0123456789');
  const app = createApp(deps);
  for (let i = 0; i < 5; i++) assert.equal((await app.request('/login', form({ password: 'nope' }), ADDR)).status, 401);
  const r = await app.request('/login', form({ password: 'pw-0123456789' }), ADDR);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
});

test('a state-changing request without our Origin is refused', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const app = createApp(deps);
  const cookie = await login(app);
  const r = await app.request('/api/anything', { method: 'POST', headers: { cookie, origin: 'http://evil.example.invalid' } });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'origin' });
});

test('security headers are on every response', async (t) => {
  const r = await createApp(baseDeps(t)).request('/healthz');
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('setup mode sends pages to /setup', async (t) => {
  const r = await createApp(baseDeps(t)).request('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/setup');
});

test('setup mode: the login page sends to /setup instead of showing a form that cannot work', async (t) => {
  const r = await createApp(baseDeps(t)).request('/login');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/setup');
});

test('signed out: logout still clears the cookie and lands on /login, never on a redirect chain', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const r = await createApp(deps).request('/logout', { method: 'POST', headers: { origin: ORIGIN } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login');
  assert.match(r.headers.get('set-cookie') ?? '', /^jsid=;.*Max-Age=0/);
});

test('next never points back at the login page', async (t) => {
  const deps = baseDeps(t); readyAuth(deps, 'pw-0123456789');
  const r = await createApp(deps).request('/login', form({ password: 'pw-0123456789', next: '/login?next=%2F' }), ADDR);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
});

test('the signed-out login page carries next and a sign-in form', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const r = await createApp(deps).request('/login?next=%2Fp%2Ftracker');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<form method="post" action="\/login">/);
  assert.match(html, /name="next" value="\/p\/tracker"/);
});
