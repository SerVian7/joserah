import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signedIn, trackerPage } from './helpers.ts';
import { listPages } from '../src/pages.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('a page is served with its page id and a viewport', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, [{ title: 'Check the line', state: 'run' }]);
  const r = await app.request(`/p/${DAY}/daily-tracker/`, { headers: { cookie } });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Check the line/);
  assert.match(html, new RegExp(`<meta name="joserah-page" content="${DAY}/daily-tracker">`));
  assert.match(html, /<meta name="viewport"/);
});

test('/p/tracker goes to today\'s Daily Tracker', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  let r = await app.request('/p/tracker', { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /no Tracker for today/);
  trackerPage(deps.workspace, DAY);
  r = await app.request('/p/tracker', { headers: { cookie } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/p/${DAY}/daily-tracker/`);
});

test('a hand edit of rows.json is re-rendered before serving', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY, [{ title: 'First', state: 'run' }]);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  const list = Array.isArray(rows) ? rows : rows.rows;
  list.push({ title: 'Added by hand', state: 'wait' });
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(Array.isArray(rows) ? list : { ...rows, rows: list }));
  const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'rows.json'), later, later);
  const html = await (await app.request(`/p/${DAY}/daily-tracker/`, { headers: { cookie } })).text();
  assert.match(html, /Added by hand/);
});

test('markdown reports render inside the shell', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  fs.writeFileSync(path.join(dir, 'report.md'), '# Report\n\n<script>x</script>\n');
  const r = await app.request(`/p/${DAY}/daily-tracker/report.md`, { headers: { cookie } });
  const html = await r.text();
  assert.match(html, /<h1>Report<\/h1>/);
  assert.ok(!html.includes('<script>x'));
  assert.match(html, /width=device-width/);
});

test('traversal is refused', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  const secret = fs.readFileSync(path.join(deps.workspace, '.joserah', 'config.json'), 'utf8');
  fs.mkdirSync(path.join(deps.workspace, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(deps.workspace, 'keys', 'x'), 'TOPSECRET');
  for (const p of [
    '/p/../../keys/x', `/p/${DAY}/daily-tracker/../../../../keys/x`, `/p/${DAY}/daily-tracker/%2e%2e/%2e%2e/%2e%2e/%2e%2e/keys/x`,
    `/p/${DAY}/daily-tracker/..%5c..%5c..%5c..%5ckeys%5cx`, `/p/${DAY}/daily-tracker/.%2e/.%2e/.%2e/.%2e/.joserah/config.json`,
    `/p/..%2f..%2fkeys/x/`, `/p/${DAY}/..%2f..%2f..%2fkeys/x`,
  ]) {
    const r = await app.request(p, { headers: { cookie } });
    const body = await r.text();
    assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
    assert.ok(!body.includes('TOPSECRET') && !body.includes(secret.trim()), p);
  }
});

test('the TV view is the Tracker, large and without forms', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, [{ title: 'On air', state: 'run' }]);
  const html = await (await app.request('/tv', { headers: { cookie } })).text();
  assert.match(html, /On air/);
  assert.match(html, /<meta name="joserah-mode" content="tv">/);
  assert.match(html, /html\{font-size:28px\}/);
});

test('listPages finds the kinds and the reports', (t) => {
  return signedIn(t).then(({ deps }) => {
    const dir = trackerPage(deps.workspace, DAY);
    fs.writeFileSync(path.join(dir, 'notes.md'), '# n');
    const p = listPages(deps.workspace);
    assert.equal(p.length, 1);
    assert.equal(p[0].kind, 'tracker');
    assert.deepEqual(p[0].reports, ['notes.md']);
    assert.equal(p[0].url, `/p/${DAY}/daily-tracker/`);
  });
});

test('an asset in the page is served; a link out of the page and a dotfile are not', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  fs.mkdirSync(path.join(dir, 'img'));
  fs.writeFileSync(path.join(dir, 'img', 'a b.png'), 'PNGDATA');
  fs.writeFileSync(path.join(dir, '.hidden.txt'), 'HIDDEN');
  fs.mkdirSync(path.join(deps.workspace, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(deps.workspace, 'keys', 'x'), 'TOPSECRET');
  fs.symlinkSync(path.join(deps.workspace, 'keys'), path.join(dir, 'out'), 'junction');
  let r = await app.request(`/p/${DAY}/daily-tracker/img/a%20b.png`, { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(await r.text(), 'PNGDATA');
  for (const p of [`/p/${DAY}/daily-tracker/out/x`, `/p/${DAY}/daily-tracker/.hidden.txt`, `/p/${DAY}/daily-tracker/img%2f..%2f..%2f..%2f..%2fkeys%2fx`, `/p/${DAY}/daily-tracker/x.md%00`, `/p/${DAY}/daily-tracker/C:%5cWindows%5cwin.ini`]) {
    r = await app.request(p, { headers: { cookie } });
    const body = await r.text();
    assert.equal(r.status, 404, p);
    assert.ok(!body.includes('TOPSECRET') && !body.includes('HIDDEN'), p);
  }
  r = await app.request(`/p/${DAY}/daily-tracker`, { headers: { cookie } });
  assert.equal(r.status, 302);
  assert.equal((await app.request(`/p/${DAY}/no-such-page`, { headers: { cookie } })).status, 404);
});
