import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { setupToken } from '../src/auth.ts';
import { wizardPass } from '../src/routes/setup.ts';
import { baseDeps, signedIn, ORIGIN, tmpdir, git, fakeEngine } from './helpers.ts';

const post = (body: unknown, cookie = '') => ({ method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test('the wizard needs the setup token printed at start', async (t) => {
  const deps = baseDeps(t); const app = createApp(deps);
  assert.equal((await app.request('/setup')).status, 403);
  assert.equal((await app.request('/setup?token=wrong')).status, 403);
  const tok = setupToken(deps.stateDir);
  const r = await app.request(`/setup?token=${tok}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /type="password"/);
  assert.match(r.headers.get('set-cookie') ?? '', /^jsetup=/);
  // the cookie it set is enough on the next visit
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  assert.equal((await app.request('/setup', { headers: { cookie } })).status, 200);
});

test('the password step writes the hash outside the workspace and signs in', async (t) => {
  const deps = baseDeps(t); const app = createApp(deps);
  const tok = setupToken(deps.stateDir);
  assert.equal((await app.request('/api/setup/password', post({ token: 'nope', password: 'long-enough-1', confirm: 'long-enough-1' }))).status, 403);
  assert.equal((await app.request('/api/setup/password', post({ token: tok, password: 'short', confirm: 'short' }))).status, 400);
  assert.equal((await app.request('/api/setup/password', post({ token: tok, password: 'long-enough-1', confirm: 'long-enough-2' }))).status, 400);
  const r = await app.request('/api/setup/password', post({ token: tok, password: 'long-enough-1', confirm: 'long-enough-1' }));
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie') ?? '', /^jsid=/);
  assert.ok(fs.existsSync(path.join(deps.stateDir, 'auth.json')));
  assert.ok(path.relative(deps.workspace, deps.stateDir).startsWith('..'), 'the state dir is outside the workspace');
  assert.ok(!fs.existsSync(path.join(deps.stateDir, 'setup-token')));
  assert.equal(deps.auth.state.kind, 'ready');
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  assert.equal((await app.request('/api/setup/password', post({ token: tok, password: 'x'.repeat(12), confirm: 'x'.repeat(12) }, cookie))).status, 409);
});

test('two password posts at once: one wins, the other is told it is already set', async (t) => {
  const deps = baseDeps(t); const app = createApp(deps);
  const tok = setupToken(deps.stateDir);
  const [a, b] = await Promise.all([
    app.request('/api/setup/password', post({ token: tok, password: 'first-password-1', confirm: 'first-password-1' })),
    app.request('/api/setup/password', post({ token: tok, password: 'other-password-2', confirm: 'other-password-2' })),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
});

test('later steps need the password first', async (t) => {
  const deps = baseDeps(t); const app = createApp(deps);
  for (const p of ['workspace', 'git-init', 'remote', 'test-job']) assert.equal((await app.request(`/api/setup/${p}`, post({}))).status, 403, p);
  assert.equal((await app.request('/api/setup/engine')).status, 403);
  const r = await app.request('/api/setup/git-init', post({}));
  assert.equal((await r.json()).error, 'password-first');
});

test('once the password is set, the wizard needs a session', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  assert.equal((await app.request('/setup', { headers: { cookie }, redirect: 'manual' })).status, 200);
  const anon = createApp(deps);
  assert.equal((await anon.request('/setup', { redirect: 'manual' })).status, 302);
  assert.equal((await anon.request('/api/setup/engine')).status, 401);
});

test('workspace, backup history and remote steps', async (t) => {
  const empty = path.join(tmpdir(t), 'fresh');
  fs.mkdirSync(empty);
  const { app, cookie } = await signedIn(t, { workspace: empty });
  assert.equal((await app.request('/api/setup/remote', post({ url: 'https://example.invalid/w.git' }, cookie))).status, 409, 'no history yet');
  let r = await app.request('/api/setup/workspace', post({ owner: 'O', name: 'w', language: 'English' }, cookie));
  assert.equal(r.status, 201);
  assert.ok(fs.existsSync(path.join(empty, '.joserah', 'config.json')));
  const gi = fs.readFileSync(path.join(empty, '.gitignore'), 'utf8');
  assert.match(gi, /^keys\/\*$/m, 'the scaffold secret rules');
  assert.match(gi, /desk\/jobs\/\*\*\/\*\.jsonl/, 'and the job-log lines');
  assert.equal((await app.request('/api/setup/workspace', post({ owner: 'O', name: 'w', language: 'English' }, cookie))).status, 409);
  r = await app.request('/api/setup/git-init', post({}, cookie));
  assert.equal(r.status, 201);
  assert.match(git(empty, 'log', '-1', '--format=%s'), /workspace: start/);
  assert.equal((await app.request('/api/setup/git-init', post({}, cookie))).status, 409);
  assert.equal((await app.request('/api/setup/remote', post({ url: 'https://u:p@example.invalid/w.git' }, cookie))).status, 400);
  assert.equal((await (await app.request('/api/setup/remote', post({ url: 'https://u:p@example.invalid/w.git' }, cookie))).json()).error, 'credentials-in-url');
  assert.equal((await (await app.request('/api/setup/remote', post({ url: 'ssh://u:p@example.invalid/w.git' }, cookie))).json()).error, 'credentials-in-url');
  assert.equal((await (await app.request('/api/setup/remote', post({ url: 'file:///etc' }, cookie))).json()).error, 'bad-url');
  assert.equal((await (await app.request('/api/setup/remote', post({ url: '--upload-pack=x' }, cookie))).json()).error, 'bad-url');
  r = await app.request('/api/setup/remote', post({ url: 'https://example.invalid/w.git' }, cookie));
  assert.equal(r.status, 200);
  assert.equal(git(empty, 'remote', 'get-url', 'origin').trim(), 'https://example.invalid/w.git');
  assert.equal((await app.request('/api/setup/remote', post({ url: 'git@example.invalid:o/w.git' }, cookie))).status, 200, 'a second call replaces the first');
  assert.equal(git(empty, 'remote', 'get-url', 'origin').trim(), 'git@example.invalid:o/w.git');
  const page = await (await app.request('/setup', { headers: { cookie } })).text();
  assert.match(page, /git@example\.invalid:o\/w\.git/);
});

test('a remote with credentials set by hand is never shown on the page', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  git(deps.workspace, 'init', '-q');
  git(deps.workspace, 'remote', 'add', 'origin', 'https://u:secret-pass@example.invalid/w.git');
  const page = await (await app.request('/setup', { headers: { cookie } })).text();
  assert.ok(!page.includes('secret-pass'));
});

test('the Claude Code step reads health; the test job is one real cheap job', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const h = await (await app.request('/api/setup/engine', { headers: { cookie } })).json();
  assert.equal(h.installed, true);
  const r = await app.request('/api/setup/test-job', post({}, cookie));
  assert.equal(r.status, 201);
  const { id } = await r.json();
  const job = deps.jobs.get(id)!;
  assert.equal(job.type, 'bookkeeping');
  assert.equal(job.budgetUsd, 0.05);
  await deps.jobs.idle();
  const s = await (await app.request(`/api/setup/test-job/${id}`, { headers: { cookie } })).json();
  assert.equal(s.state, 'done');
  assert.equal(s.pass, false, 'the fake CLI answers "Done.", not "ready"');
  assert.equal((await app.request('/api/setup/test-job/j-nope', { headers: { cookie } })).status, 404);
  assert.equal(wizardPass({ ...job, state: 'done', resultText: 'ready' }), true);
  assert.equal(wizardPass({ ...job, state: 'done', resultText: 'Done.' }), false);
  assert.equal(wizardPass({ ...job, state: 'failed', resultText: 'ready' }), false);
});

test('the test job is refused with the reason when Claude Code is not signed in', async (t) => {
  const { app, cookie } = await signedIn(t, { engine: fakeEngine({ FAKE_CLAUDE_SIGNED_IN: '0' }) });
  const r = await app.request('/api/setup/test-job', post({}, cookie));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'engine');
});

test('a refused job (no workspace yet) answers with the reason, not a crash', async (t) => {
  const empty = path.join(tmpdir(t), 'fresh');
  fs.mkdirSync(empty);
  const { app, cookie } = await signedIn(t, { workspace: empty });
  const r = await app.request('/api/setup/test-job', post({}, cookie));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'no-workspace');
});
