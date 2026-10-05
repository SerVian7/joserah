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
