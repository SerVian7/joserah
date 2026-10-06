import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { signedIn, tmpWorkspace } from './helpers.ts';
import { JOB_TYPES } from '../src/config.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

/** A Turkish workspace: the scaffold's English one with dialogueLanguage switched. */
function turkish(t: TestContext): string {
  const ws = tmpWorkspace(t);
  const f = path.join(ws, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8')); cfg.dialogueLanguage = 'Turkish';
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
  return ws;
}
// The text a person reads: tags, scripts, styles and attribute values gone.
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');

test('a Turkish home names job kinds and the budget in Turkish; the value sent stays the kind\'s key', async (t) => {
  const { app, deps, cookie } = await signedIn(t, { workspace: turkish(t) });
  deps.jobs.submit({ type: 'task', text: 'Notları topla' });
  const html = await (await app.request('/', { headers: { cookie } })).text();
  const text = visible(html);
  for (const k of JOB_TYPES) assert.match(html, new RegExp(`<option value="${k}"`), `option ${k} keeps its value`);
  assert.match(html, /<option value="task" selected>İş<\/option>/);
  assert.doesNotMatch(text, /\bcap\b/);
  assert.match(text, /günlük sınır \$10\.00/);
  assert.doesNotMatch(text, /\b(queued|running)\b/);
  await deps.jobs.idle();
});

test('a Turkish job page and job list show the state, the kind and the actions in Turkish', async (t) => {
  const { app, deps, cookie } = await signedIn(t, { workspace: turkish(t) });
  const j = deps.jobs.submit({ type: 'research', text: 'Kablo araştır' });
  await deps.jobs.idle();
  for (const u of [`/jobs/${j.id}`, '/jobs']) {
    const text = visible(await (await app.request(u, { headers: { cookie } })).text());
    assert.doesNotMatch(text, /\b(done|failed|refused|running|queued|research)\b/, u);
  }
  const page = visible(await (await app.request(`/jobs/${j.id}`, { headers: { cookie } })).text());
  assert.match(page, /Araştırma/);
});

test('the Turkish claims table and its notes are in Turkish', async (t) => {
  const { app, deps, cookie } = await signedIn(t, { workspace: turkish(t) });
  const p = path.join(deps.workspace, '.joserah', 'knowledge', 'wiki', 'entities', 'enc.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '# Enc\n\n- [calculation] Latency -> 90 ms\n  date: 2026-09-01 · source: imports/a.md\n- [measurement] latency -> 120 ms\n  condition: lab · date: 2026-09-02 · source: imports/b.md\n');
  const text = visible(await (await app.request('/w/claims', { headers: { cookie } })).text());
  assert.doesNotMatch(text, /\b(kind|claim|condition|source|measurement speaks)\b/);
  assert.match(text, /ölçüm geçerli/);
});

test('the page script gets the state words in the page\'s language', async (t) => {
  const { app, cookie } = await signedIn(t, { workspace: turkish(t) });
  const html = await (await app.request('/', { headers: { cookie } })).text();
  const m = /data-words="([^"]+)"/.exec(html);
  const words = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.equal(words.states.running, 'çalışıyor');
  assert.equal(words.states.done, 'bitti');
});

test('a known job error is said in Turkish; the record keeps the original', async (t) => {
  const { app, deps, cookie } = await signedIn(t, { workspace: turkish(t) });
  const j = deps.jobs.submit({ type: 'task', text: 'x' });
  await deps.jobs.idle();
  // The checkpoint's refusal, as a job in a workspace without git records it.
  Object.assign(deps.jobs.get(j.id)!, { state: 'refused', error: 'the workspace is not a git repository — the setup wizard can create one' });
  const text = visible(await (await app.request(`/jobs/${j.id}`, { headers: { cookie } })).text());
  assert.match(text, /Çalışma alanı bir git deposu değil/);
  assert.doesNotMatch(text, /not a git repository/);
});
