import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/events.ts';

test('ids increase and since() replays after an id', () => {
  const b = new EventBus(3, 1);
  const seen: number[] = [];
  const off = b.subscribe((id) => seen.push(id));
  b.publish({ type: 'jobs' }); b.publish({ type: 'jobs' }); b.publish({ type: 'jobs' });
  off(); b.publish({ type: 'jobs' });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(b.since(2)!.map((x) => x.id), [3, 4]);
  assert.deepEqual(b.since(4), []);
});

test('an id older than the ring buffer returns null (the page must reset)', () => {
  const b = new EventBus(2, 1);
  for (let i = 0; i < 5; i++) b.publish({ type: 'jobs' });
  assert.equal(b.since(1), null);
  assert.equal(b.lastId(), 5);
});

test('an id from a previous server run (newer than any issued) returns null, never a silent []', () => {
  const b = new EventBus(1000, 1);
  b.publish({ type: 'jobs' }); b.publish({ type: 'jobs' });
  assert.deepEqual(b.since(b.lastId()), []);
  assert.equal(b.since(b.lastId() + 1), null);
  assert.equal(b.since(500), null);
  assert.equal(b.since(-1), null);
  assert.equal(b.since(Number.NaN), null);
});

// Reviewer finding 1: a restarted server must not reuse small ids, or a browser holding an old id would resume into the
// new run's events with no reset. Ids start at the clock, so every id of an earlier run is below the new ring.
test('a restarted bus never continues the previous run\'s id sequence (since() of an old id is null)', async () => {
  const a = new EventBus();
  a.publish({ type: 'jobs' }); a.publish({ type: 'jobs' }); a.publish({ type: 'jobs' });
  const seen = a.lastId();
  await new Promise((r) => setTimeout(r, 20));
  const b = new EventBus();
  b.publish({ type: 'jobs' });
  assert.ok(b.lastId() > seen);
  assert.equal(b.since(seen), null);
  assert.equal(b.since(1), null);
});

test('the first id can be pinned (tests, and a bus that must start at a known number)', () => {
  const b = new EventBus(5, 10);
  assert.equal(b.publish({ type: 'jobs' }), 10);
});
