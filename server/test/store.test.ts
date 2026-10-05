import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, OutsideWorkspace } from '../src/store.ts';
import { EventBus, type BusEvent } from '../src/events.ts';
import { tmpdir } from './helpers.ts';

function setup(t: import('node:test').TestContext) {
  const root = tmpdir(t);
  const bus = new EventBus();
  const events: BusEvent[] = [];
  bus.subscribe((_id, e) => events.push(e));
  const store = new Store(root, bus, { pollDirs: () => ['.joserah/desk/artifacts', '.joserah/knowledge'] });
  return { root, bus, store, events };
}

test('write is atomic, creates folders and emits one change', (t) => {
  const { root, store, events } = setup(t);
  store.writeJson('.joserah/desk/artifacts/2026-10-06/x/rows.json', { rows: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.joserah/desk/artifacts/2026-10-06/x/rows.json'), 'utf8')), { rows: [] });
  assert.deepEqual(events, [{ type: 'changed', path: '.joserah/desk/artifacts/2026-10-06/x/rows.json' }]);
  assert.deepEqual(fs.readdirSync(path.join(root, '.joserah/desk/artifacts/2026-10-06/x')), ['rows.json'], 'no temp file left');
});

test('answers.json maps to an answers event for its page', (t) => {
  const { store, events } = setup(t);
  store.write('.joserah/desk/artifacts/2026-10-06/daily-tracker/answers.json', '{}');
  assert.deepEqual(events, [{ type: 'answers', page: '2026-10-06/daily-tracker' }]);
});

test('the poll sees an outside edit once, and not the Store\'s own write', (t) => {
  const { root, store, events } = setup(t);
  store.write('.joserah/knowledge/a.md', 'a');
  store.pollOnce(); events.length = 0;
  assert.deepEqual(store.pollOnce(), [], 'own write is not reported again');
  const p = path.join(root, '.joserah/knowledge/a.md');
  fs.writeFileSync(p, 'b'); const later = new Date(Date.now() + 3000); fs.utimesSync(p, later, later);
  assert.deepEqual(store.pollOnce(), ['.joserah/knowledge/a.md']);
  assert.deepEqual(store.pollOnce(), []);
  assert.deepEqual(events, [{ type: 'changed', path: '.joserah/knowledge/a.md' }]);
});

test('the poll reports a deleted file', (t) => {
  const { root, store } = setup(t);
  store.write('.joserah/knowledge/gone.md', 'x'); store.pollOnce();
  fs.rmSync(path.join(root, '.joserah/knowledge/gone.md'));
  assert.deepEqual(store.pollOnce(), ['.joserah/knowledge/gone.md']);
});

test('paths outside the workspace are refused', (t) => {
  const { store } = setup(t);
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'C:\\x', 'a\\..\\..\\x', '']) assert.throws(() => store.abs(bad), OutsideWorkspace, bad);
});

test('importVerbatim only writes under imports/ and never overwrites', (t) => {
  const { root, store } = setup(t);
  const a = store.importVerbatim(Buffer.from('one'), 'imports/2026-10-06-upload/n.txt');
  const b = store.importVerbatim(Buffer.from('two'), 'imports/2026-10-06-upload/n.txt');
  assert.equal(a, 'imports/2026-10-06-upload/n.txt');
  assert.equal(b, 'imports/2026-10-06-upload/n (2).txt');
  assert.equal(fs.readFileSync(path.join(root, a), 'utf8'), 'one');
  assert.throws(() => store.importVerbatim(Buffer.from('x'), '.joserah/x.txt'), OutsideWorkspace);
});

test('readJson returns null for a missing or broken file', (t) => {
  const { store } = setup(t);
  assert.equal(store.readJson('nope.json'), null);
  store.write('bad.json', '{');
  assert.equal(store.readJson('bad.json'), null);
});

test('append publishes nothing itself; the next poll reports the file once', (t) => {
  const { store, events } = setup(t);
  store.write('.joserah/knowledge/wiki/log.md', '# log\n'); store.pollOnce(); events.length = 0;
  store.append('.joserah/knowledge/wiki/log.md', 'a\n'); store.append('.joserah/knowledge/wiki/log.md', 'b\n');
  assert.deepEqual(events, [], 'no event per appended line');
  assert.equal(store.read('.joserah/knowledge/wiki/log.md'), '# log\na\nb\n');
  const p = store.abs('.joserah/knowledge/wiki/log.md'); const later = new Date(Date.now() + 3000); fs.utimesSync(p, later, later);
  assert.deepEqual(store.pollOnce(), ['.joserah/knowledge/wiki/log.md']);
  assert.deepEqual(store.pollOnce(), []);
});

test('remove publishes once for an existing file and nothing for a missing one', (t) => {
  const { store, events } = setup(t);
  store.write('.joserah/knowledge/r.md', 'x'); events.length = 0;
  store.remove('.joserah/knowledge/r.md'); store.remove('.joserah/knowledge/r.md');
  assert.deepEqual(events, [{ type: 'changed', path: '.joserah/knowledge/r.md' }]);
  assert.deepEqual(store.pollOnce(), [], 'a removal by the Store is not reported again');
});
