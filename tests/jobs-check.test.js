'use strict';
// tools/jobs-check.js: schema + rules for a job file, and the once-only journal line when a job is done.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const { tmpdir } = require('./helpers');
const J = require('../tools/jobs-check');

const ok = { title: 'Fix login', project: 'Shop', state: 'run', started: '2026-10-13T09:00:00+03:00' };
const rules = (job, slug = 'fix-login', siblings = []) => J.check(job, slug, siblings);

test('a valid job passes', () => assert.deepStrictEqual(rules(ok), []));
test('state must be one of run/you/wait/done/plan', () => {
  assert.match(rules({ ...ok, state: 'working' })[0], /state/);
  for (const s of ['run', 'you', 'wait', 'done', 'plan']) assert.deepStrictEqual(rules({ ...ok, state: s, finished: '2026-10-13T10:00:00+03:00' }), []);
});
test('title is required', () => assert.match(rules({ ...ok, title: ' ' })[0], /title/));
test('a child title does not repeat the project name (leading name or "name:" is refused)', () => {
  assert.match(rules({ ...ok, title: 'Shop: fix login' })[0], /project/);
  assert.match(rules({ ...ok, title: 'shop - fix login' })[0], /project/);
  assert.deepStrictEqual(rules({ ...ok, title: 'Shopping list fix' }), []); // a longer word is not the name
});
test('a decision row (state you, title a question or options given) carries options, recommend and why', () => {
  const q = { ...ok, state: 'you', title: 'Which plan?' };
  assert.match(rules(q).join(), /options/);
  const full = { ...q, options: [{ key: 'A', label: 'Cheap' }, { key: 'B', label: 'Fast' }], recommend: 'A', why: 'fits the need' };
  assert.deepStrictEqual(rules(full), []);
  assert.match(rules({ ...full, recommend: 'Z' }).join(), /recommend/);
  assert.match(rules({ ...full, why: '' }).join(), /why/);
  assert.deepStrictEqual(rules({ ...ok, state: 'you', title: 'Sign in to the server' }), []); // an action for the owner, not a decision
});
test('slug is lowercase ascii with dashes and unique ignoring case', () => {
  assert.match(rules(ok, 'Fix Login')[0], /slug/);
  assert.match(rules(ok, 'fix-login', ['FIX-LOGIN.json'])[0], /slug/);
  assert.deepStrictEqual(rules(ok, 'fix-login', ['fix-login.json', 'other.json']), []); // itself is not a duplicate
});
test('done without finished is refused by check (the write path fills it in)', () => assert.match(rules({ ...ok, state: 'done' })[0], /finished/));

const ws = (t) => { const d = tmpdir(t); fs.mkdirSync(path.join(d, '.joserah', 'desk', 'jobs'), { recursive: true }); return d; };
const put = (root, slug, job) => { const f = path.join(root, '.joserah', 'desk', 'jobs', slug + '.json'); fs.writeFileSync(f, JSON.stringify(job)); return f; };
const journal = (root) => fs.readFileSync(path.join(root, '.joserah', 'desk', 'daily', '2026', '2026-10-13.md'), 'utf8');
const NOW = new Date('2026-10-13T10:30:00+03:00');

test('afterWrite: done appends one journal line under "## Done today", newest first, and fills finished', (t) => {
  const root = ws(t);
  const dir = path.join(root, '.joserah', 'desk', 'daily', '2026'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-13.md'), '# 2026-10-13\n\n## Done today\n- 09:00 older\n\n## Notes\n- x\n');
  const f = put(root, 'fix-login', { ...ok, state: 'done', note: 'Login works again. More detail here.', url: 'http://x/y', label: 'report' });
  const r = J.afterWrite(root, f, NOW);
  assert.deepStrictEqual(r.errors, []);
  const j = journal(root);
  assert.match(j, /## Done today\n- 10:30 Fix login — Login works again\. — \[report\]\(http:\/\/x\/y\) <!-- job:fix-login@2026-10-13T10:30:00\+03:00 -->\n- 09:00 older/);
  assert.match(j, /## Notes\n- x/);
  assert.ok(JSON.parse(fs.readFileSync(f, 'utf8')).finished);
});
test('afterWrite: a repeated done does not duplicate the line; a new finish time does', (t) => {
  const root = ws(t);
  const f = put(root, 'a', { ...ok, state: 'done', finished: '2026-10-13T10:00:00+03:00' });
  J.afterWrite(root, f, NOW); J.afterWrite(root, f, NOW);
  assert.strictEqual(journal(root).split('job:a@').length, 2);
  put(root, 'a', { ...ok, state: 'done', finished: '2026-10-13T11:00:00+03:00' });
  J.afterWrite(root, f, NOW);
  assert.strictEqual(journal(root).split('job:a@').length, 3);
});
test('afterWrite: not done writes no journal; an invalid job writes none and returns its errors; broken JSON is an error', (t) => {
  const root = ws(t);
  assert.deepStrictEqual(J.afterWrite(root, put(root, 'a', ok), NOW).errors, []);
  assert.ok(!fs.existsSync(path.join(root, '.joserah', 'desk', 'daily')));
  const bad = J.afterWrite(root, put(root, 'b', { ...ok, state: 'nope' }), NOW);
  assert.match(bad.errors[0], /state/);
  const f = path.join(root, '.joserah', 'desk', 'jobs', 'c.json'); fs.writeFileSync(f, '{"title":');
  assert.match(J.afterWrite(root, f, NOW).errors[0], /unreadable/);
});
test('afterWrite ignores files that are not job files (_agents.json, other folders, temp files)', (t) => {
  const root = ws(t);
  for (const n of ['_agents.json', 'x.json.tmp']) assert.strictEqual(J.afterWrite(root, path.join(root, '.joserah', 'desk', 'jobs', n), NOW), null);
  assert.strictEqual(J.afterWrite(root, path.join(root, 'other.json'), NOW), null);
});
test('afterWrite: the journal stub lone dash placeholder is replaced', (t) => {
  const root = ws(t);
  const dir = path.join(root, '.joserah', 'desk', 'daily', '2026'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-13.md'), '# d\n\n## Done today\n-\n\n## Notes\n');
  J.afterWrite(root, put(root, 'a', { ...ok, state: 'done', finished: '2026-10-13T10:00:00+03:00' }), NOW);
  assert.doesNotMatch(journal(root), /\n-\n/);
});
