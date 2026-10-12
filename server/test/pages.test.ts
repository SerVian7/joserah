import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signedIn, trackerPage, REPO_ROOT } from './helpers.ts';
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

test('/p/tracker and the TV view lead to the living Tracker page, which is served with the job files it polls', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  for (const p of ['/p/tracker', '/tv', '/tracker']) {
    const r = await app.request(p, { headers: { cookie } });
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), '/tracker/');
  }
  assert.match(await (await app.request('/tracker/', { headers: { cookie } })).text(), /no Tracker for today/, 'not installed yet');
  const page = path.join(deps.workspace, '.joserah/desk/artifacts/tracker'); fs.mkdirSync(page, { recursive: true });
  for (const n of ['index.html', 'style.css', 'jobs.js']) fs.copyFileSync(path.join(REPO_ROOT, 'templates/jobs', n), path.join(page, n));
  const idx = await app.request('/tracker/', { headers: { cookie } });
  assert.match(idx.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await idx.text(), /<script src="jobs\.js"/);
  assert.match((await app.request('/tracker/style.css', { headers: { cookie } })).headers.get('content-type') ?? '', /text\/css/);
  assert.equal((await app.request('/tracker/secret.txt', { headers: { cookie } })).status, 200, 'any other name gets the not-installed shell, never a file');
  const jobs = path.join(deps.workspace, '.joserah/desk/jobs'); fs.mkdirSync(path.join(jobs, DAY), { recursive: true });
  fs.writeFileSync(path.join(jobs, 'a.json'), '{"title":"A","state":"run"}'); fs.writeFileSync(path.join(jobs, 'a.json.tmp'), 'x');
  const list = await (await app.request('/jobs/index.json', { headers: { cookie } })).json();
  assert.deepEqual(list.map((f: { n: string }) => f.n), ['a.json'], 'flat job files only, no day folders or temp files');
  assert.equal(await (await app.request('/jobs/a.json', { headers: { cookie } })).text(), '{"title":"A","state":"run"}');
  assert.equal((await app.request('/jobs/..%2F..%2Fconfig.json', { headers: { cookie } })).status, 404, 'no path out of the folder');
  assert.equal((await app.request('/jobs/index.json')).status === 200, false, 'signed out: refused');
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

test('listPages finds the kinds and the reports', (t) => {
  return signedIn(t).then(({ deps }) => {
    const dir = trackerPage(deps.workspace, DAY);
    fs.writeFileSync(path.join(dir, 'notes.md'), '# n');
    const p = listPages(deps.workspace);
    assert.equal(p.length, 1);
    assert.equal(p[0].kind, 'static');
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

test('a symlinked index.html pointing out of the page is not served', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const base = path.join(deps.workspace, '.joserah', 'desk', 'artifacts', DAY, 'f');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(deps.workspace, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(deps.workspace, 'keys', 'x'), 'TOPSECRET');
  try { fs.symlinkSync(path.join(deps.workspace, 'keys', 'x'), path.join(base, 'index.html'), 'file'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e; fs.symlinkSync(path.join(deps.workspace, 'keys'), path.join(base, 'index.html'), 'junction'); }   // Windows without the privilege: a junction out
  for (const p of [`/p/${DAY}/f/`, `/p/${DAY}/f/index.html`]) {
    const r = await app.request(p, { headers: { cookie } });
    assert.equal(r.status, 404, p);
    assert.ok(!(await r.text()).includes('TOPSECRET'), p);
  }
  assert.deepEqual(listPages(deps.workspace).map((p) => p.folder), []);
});
