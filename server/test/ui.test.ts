import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createApp } from '../src/app.ts';
import { SHIM_JS } from '../src/shim.ts';
import { baseDeps, readyAuth, signedIn, trackerPage, REPO_ROOT } from './helpers.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('the interface files are served without a session, with their types', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const app = createApp(deps);
  const want: Array<[string, RegExp]> = [['/_/s/ui.css', /text\/css/], ['/_/s/ui.js', /javascript/],
    ['/_/s/fonts/sora-latin-wght-normal.woff2', /font\/woff2/], ['/_/s/j.png', /image\/png/]];
  for (const [u, type] of want) {
    const r = await app.request(u);
    assert.equal(r.status, 200, u);
    assert.match(r.headers.get('content-type') ?? '', type, u);
  }
});

test('the J is the recorded asset, byte for byte', async (t) => {
  const app = createApp(baseDeps(t));
  const r = await app.request('/_/s/j.png');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), fs.readFileSync(path.join(REPO_ROOT, 'assets', 'j-faded.png')));
});

test('nothing outside the interface folder is reachable through it', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const app = createApp(deps);
  for (const u of ['/_/s/../package.json', '/_/s/%2e%2e/package.json', '/_/s/..%2fpackage.json', '/_/s/nope.css', '/_/s/.hidden', '/_/s/ui.css/x']) {
    const r = await app.request(u);
    assert.ok(r.status === 404 || r.status === 302, `${u} answered ${r.status}`);
  }
});

test('every framed page links the interface, preloads the font and marks where you are', async (t) => {
  const { app, cookie } = await signedIn(t);
  const html = await (await app.request('/jobs', { headers: { cookie } })).text();
  assert.match(html, /<link rel="stylesheet" href="\/_\/s\/ui\.css\?v=[0-9a-f]{8}">/);
  assert.match(html, /<script src="\/_\/s\/ui\.js\?v=[0-9a-f]{8}" defer><\/script>/);
  assert.doesNotMatch(html, /vendor\//, 'no third-party script: the living layer is plain CSS and WebGL');
  assert.match(html, /<meta name="theme-color"/);
  assert.match(html, /<a class="skip" href="#main">/);
  assert.match(html, /<link rel="preload" href="\/_\/s\/fonts\/sora-latin-wght-normal\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.match(html, /<a href="\/jobs" aria-current="page">/);
});

test('the sign-in page carries the interface too', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const html = await (await createApp(deps).request('/login')).text();
  assert.match(html, /\/_\/s\/ui\.css/);
  assert.match(html, /class="jmark/);
});

test('presence: calm when nothing runs and nothing waits', async (t) => {
  const { app, cookie } = await signedIn(t);
  const p = await (await app.request('/api/presence', { headers: { cookie } })).json();
  assert.equal(p.mode, 'idle');
  assert.deepEqual(p.running, []);
  assert.deepEqual(p.waiting, []);
});

test('presence: the owner rows of today\'s Tracker are what waits', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, [{ title: 'Which cable?', state: 'you', small: 'Pick one' }, { title: 'Ordering', state: 'wait' }, { title: 'Done thing', state: 'ok' }]);
  const p = await (await app.request('/api/presence', { headers: { cookie } })).json();
  assert.equal(p.mode, 'waiting');
  assert.deepEqual(p.waiting.map((w: { title: string }) => w.title), ['Which cable?']);
  assert.equal(p.waiting[0].url, `/p/${DAY}/daily-tracker/`);
});

test('presence: a queued or running job makes it work', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const j = deps.jobs.submit({ type: 'task', text: 'Tidy the notes' });
  const p = await (await app.request('/api/presence', { headers: { cookie } })).json();
  assert.equal(p.mode, 'working');
  assert.equal(p.running[0].id, j.id);
  assert.equal(p.running[0].title, j.rowTitle);
  await deps.jobs.idle();
});

test('presence needs a session', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  assert.equal((await createApp(deps).request('/api/presence')).status, 401);
});

test('home opens on the presence, with its state already in the page', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, [{ title: 'Which cable?', state: 'you' }]);
  const html = await (await app.request('/', { headers: { cookie } })).text();
  assert.match(html, /<html lang="en" data-state="waiting"/);
  assert.match(html, /<section id="presence"/);
  assert.match(html, /<canvas id="field"/);
  assert.match(html, /Which cable\?/);
  assert.match(html, /<form id="job"/);
});

test('a page opens inside the app frame: the header, the J and the live pulse around it', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, [{ title: 'Which cable?', state: 'you' }]);
  const html = await (await app.request(`/p/${DAY}/daily-tracker/`, { headers: { cookie } })).text();
  assert.match(html, /<link rel="stylesheet" href="\/_\/s\/frame\.css\?v=[0-9a-f]{8}">/);
  assert.match(html, /<script src="\/_\/s\/ui\.js\?v=[0-9a-f]{8}" defer><\/script>/);
  assert.match(html, /<body[^>]*>\s*<header class="jz-top jz-frame"[^>]*>.*<a href="\/p\/tracker" aria-current="page">/s);
  assert.ok(html.indexOf('/_/shim.js') < html.indexOf('/_/s/ui.js'), 'the shim comes first, so the page shares its event stream');
});

test('the frame stays out of the TV view and out of a page shown inside another page', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, []);
  const tv = await (await app.request('/tv', { headers: { cookie } })).text();
  assert.doesNotMatch(tv, /jz-frame|frame\.css/);
  const framed = await (await app.request(`/p/${DAY}/daily-tracker/`, { headers: { cookie, 'sec-fetch-dest': 'iframe' } })).text();
  assert.doesNotMatch(framed, /jz-frame|frame\.css/);
});

test('the shim shares its event stream with the interface', () => {
  assert.match(SHIM_JS, /es=W\.jzES=new W\.EventSource\('\/events'\)/);
});

test('text files go out compressed when the browser accepts it', async (t) => {
  const app = createApp(baseDeps(t));
  const r = await app.request('/_/s/ui.js', { headers: { 'accept-encoding': 'gzip, deflate, br' } });
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  assert.match(r.headers.get('vary') ?? '', /Accept-Encoding/i);
  const body = zlib.gunzipSync(Buffer.from(await r.arrayBuffer()));
  assert.deepEqual(body, fs.readFileSync(path.join(import.meta.dirname, '..', 'static', 'ui.js')));
  const plain = await app.request('/_/s/ui.js');
  assert.equal(plain.headers.get('content-encoding'), null);
  const font = await app.request('/_/s/fonts/sora-latin-wght-normal.woff2', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(font.headers.get('content-encoding'), null, 'a woff2 is already compressed');
});
