import test from 'node:test';
import assert from 'node:assert/strict';
import { signedIn, trackerPage } from './helpers.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('home has the job box, the live Tracker, running jobs and the pages', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  const html = await (await app.request('/', { headers: { cookie } })).text();
  assert.match(html, /<form id="job"/);
  assert.match(html, /<iframe[^>]+src="\/p\/tracker"/);
  assert.match(html, /<ul id="running"/);
  assert.match(html, /\/p\/2026-10-06\/daily-tracker\//);
  assert.match(html, /<script src="\/_\/app\.js"><\/script>/);
  assert.match(html, /width=device-width/);
});

test('the job box is disabled with the reason when Claude Code is not ready', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  deps.engineHealth = { installed: false, version: null, signedIn: false, detail: 'Claude Code is not installed or not on PATH' };
  const html = await (await app.request('/', { headers: { cookie } })).text();
  assert.match(html, /<fieldset disabled>/);
  assert.match(html, /Claude Code is not installed or not on PATH/);
});

test('the job page escapes what the owner typed and labels the cost an estimate', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const j = deps.jobs.submit({ type: 'task', text: '<img src=x onerror=alert(1)> do it' });
  await deps.jobs.idle();
  const html = await (await app.request(`/jobs/${j.id}`, { headers: { cookie } })).text();
  assert.ok(!html.includes('<img src=x onerror'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; do it/);
  assert.match(html, /\$0\.0123 \(estimate\)/);
  assert.match(html, /<ol class="stream" data-job="/);
});
