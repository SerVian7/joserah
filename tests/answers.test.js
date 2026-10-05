'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');
const A = require('../tools/lib/answers');

test('owner put merges by field and never deletes a missing one', (t) => {
  const d = tmpdir(t);
  assert.ok(A.put(d, 'a-x-1', { row: 'X', key: 'A', label: 'one', note: 'because', at: '2026-10-06T08:00:00Z' }, 'owner').ok);
  assert.ok(A.markRead(d, 'a-x-1').ok);
  const r = A.put(d, 'a-x-1', { key: 'B', at: '2026-10-06T08:05:00Z' }, 'owner');
  assert.deepEqual(r.doc, { row: 'X', key: 'B', label: 'one', note: 'because', at: '2026-10-06T08:05:00Z', state: 'new' });
});

test('an owner write never replaces an assistant document', (t) => {
  const d = tmpdir(t);
  const rep = A.reply(d, 'a-x-1', 'Done, see the page.', Date.UTC(2026, 9, 6, 8));
  assert.ok(rep.ok);
  assert.match(rep.id, /^a-x-1--r[a-z0-9]+$/);
  assert.deepEqual(A.put(d, rep.id, { note: 'overwrite' }, 'owner'), { ok: false, code: 'not-yours' });
  assert.equal(A.read(d).docs[rep.id].note, 'Done, see the page.');
  assert.deepEqual(A.put(d, 'a-x-1', { note: 'x' }, 'assistant'), { ok: false, code: 'not-yours' });
});

test('bad ids and bad documents are refused', (t) => {
  const d = tmpdir(t);
  for (const id of ['', '../x', 'A-UPPER', 'a/b', 'x'.repeat(161)]) assert.equal(A.put(d, id, { note: 'n' }, 'owner').code, 'bad-id', id);
  assert.equal(A.put(d, 'a-1', { note: 5 }, 'owner').code, 'bad-doc');
  assert.equal(A.put(d, 'a-1', ['x'], 'owner').code, 'bad-doc');
});

test('list --new and newCounts', (t) => {
  const ws = tmpdir(t);
  const d = path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-06', 'daily-tracker');
  fs.mkdirSync(d, { recursive: true });
  A.put(d, 'a-1', { note: 'n1', at: '2026-10-06T08:00:00Z' }, 'owner');
  A.put(d, 'a-2', { note: 'n2', at: '2026-10-06T08:01:00Z' }, 'owner');
  A.markRead(d, 'a-1');
  assert.deepEqual(A.list(d, { onlyNew: true }).map((x) => x.id), ['a-2']);
  assert.deepEqual(A.newCounts(ws).map(({ page, count }) => ({ page, count })), [{ page: '2026-10-06/daily-tracker', count: 1 }]);
});

test('two writers lose nothing', async (t) => {
  const d = tmpdir(t);
  const lib = path.join(PLUGIN_ROOT, 'tools', 'lib', 'answers.js').replace(/\\/g, '/');
  const writer = (tag, author) => new Promise((resolve, reject) => {
    const code = `const A=require(${JSON.stringify(lib)});for(let i=0;i<40;i++){const r=${author === 'owner'
      ? `A.put(process.argv[1],'a-${tag}-'+i,{note:'n'+i},'owner')`
      : `A.reply(process.argv[1],'a-base-'+i,'r'+i,1700000000000+i*1000+${tag === 'r' ? 0 : 500})`};if(!r.ok)process.exit(2)}`;
    const p = spawn(process.execPath, ['-e', code, d], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`writer ${tag} exit ${c}`))));
  });
  await Promise.all([writer('o', 'owner'), writer('r', 'assistant'), writer('p', 'owner')]);
  const docs = A.read(d).docs;
  assert.equal(Object.keys(docs).length, 120);
  assert.ok(!fs.existsSync(path.join(d, 'answers.json.lock')));
});

const { runTool, HERMETIC_CONFIG_DIR } = require('./helpers');
const { spawnSync } = require('child_process');

function pageWith(t) {
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  const d = path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-06', 'daily-tracker');
  fs.mkdirSync(d, { recursive: true });
  A.put(d, 'a-q-1', { row: 'Pick a cable', key: 'B', note: 'the short one', at: '2026-10-06T08:00:00Z' }, 'owner');
  return { ws, d };
}

test('answers.js list, reply and mark', (t) => {
  const { d } = pageWith(t);
  let r = runTool('answers.js', ['list', d, '--new']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^a-q-1 · new · \d\d:\d\d · B · Pick a cable · the short one$/m);
  r = runTool('answers.js', ['reply', d, 'a-q-1', '--note', 'Ordered the short one.']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^reply: a-q-1--r[a-z0-9]+$/m);
  r = runTool('answers.js', ['mark', d, 'a-q-1', 'read']);
  assert.match(r.stdout, /^marked: a-q-1$/m);
  r = runTool('answers.js', ['list', d, '--new', '--json']);
  assert.deepEqual(JSON.parse(r.stdout), []);
  r = runTool('answers.js', ['mark', d, 'a-nope', 'read']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /answers: not-found/);
});

test('answers.js pages lists counts and paths, nothing when none', (t) => {
  const { ws, d } = pageWith(t);
  let r = runTool('answers.js', ['pages', ws]);
  assert.equal(r.stdout.trim(), `2026-10-06/daily-tracker · 1 new · ${d}`);
  A.markRead(d, 'a-q-1');
  r = runTool('answers.js', ['pages', ws]);
  assert.equal(r.stdout, '');
});

test('the session brief carries one [answers] line with counts and pointers, no bodies', (t) => {
  const { ws } = pageWith(t);
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'session-brief.js')],
    { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC_CONFIG_DIR, CLAUDE_PLUGIN_ROOT: '', JOSERAH_NOW: '2026-10-06T09:00:00' } });
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  const line = ctx.split('\n').find((l) => l.startsWith('[answers]'));
  assert.ok(line, ctx);
  assert.match(line, /1 new answer/);
  assert.match(line, /2026-10-06\/daily-tracker/);
  assert.match(line, /answers\.js" list /);
  assert.ok(!line.includes('the short one'), 'pointers, never bodies');
});

test('two replies in one millisecond keep both, and a broken answers.json is kept aside', (t) => {
  const d = tmpdir(t);
  const a = A.reply(d, 'a-x-1', 'first', 1700000000000);
  const b = A.reply(d, 'a-x-1', 'second', 1700000000000);
  assert.ok(a.ok && b.ok && a.id !== b.id);
  assert.deepEqual(A.list(d).map((x) => x.note).sort(), ['first', 'second']);
  fs.writeFileSync(path.join(d, 'answers.json'), '{ not json');
  assert.ok(A.put(d, 'a-y-1', { note: 'n' }, 'owner').ok);
  const kept = fs.readdirSync(d).filter((f) => f.startsWith('answers.json.broken-'));
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(path.join(d, kept[0]), 'utf8'), '{ not json');
});

test('answers.js reply refuses an id that is not on the page', (t) => {
  const { d } = pageWith(t);
  const r = runTool('answers.js', ['reply', d, 'a-typo-1', '--note', 'x']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /answers: not-found/);
  assert.equal(Object.keys(A.read(d).docs).length, 1);
});

test('the lock: a dead writer\'s lock is taken over, another writer\'s lock is never released', (t) => {
  const d = tmpdir(t);
  const lock = path.join(d, 'answers.json.lock');
  fs.writeFileSync(lock, 'dead');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  assert.ok(A.put(d, 'a-x-1', { note: 'n' }, 'owner').ok);
  assert.ok(!fs.existsSync(lock));
  A.withLock(d, () => fs.writeFileSync(lock, 'someone-else'));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'someone-else');
});

test('a write whose lock was taken over is refused, not written over the other', (t) => {
  const d = tmpdir(t);
  fs.writeFileSync(path.join(d, 'answers.json'), '{"version":1,"docs":{}}\n');
  const lock = path.join(d, 'answers.json.lock');
  assert.throws(() => A.withLock(d, () => { fs.writeFileSync(lock, 'someone-else'); A._writeLocked(d, { version: 1, docs: { 'a-1': { note: 'x' } } }); }), /lock/);
  assert.deepEqual(A.read(d).docs, {});
});

test('object prototype names are not documents', (t) => {
  const d = tmpdir(t);
  A.put(d, 'a-1', { note: 'n' }, 'owner');
  assert.deepEqual(A.markRead(d, 'constructor'), { ok: false, code: 'not-found' });
  assert.deepEqual(Object.keys(A.read(d).docs), ['a-1']);
});
