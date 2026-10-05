import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/events.ts';

test('ids increase and since() replays after an id', () => {
  const b = new EventBus(3);
  const seen: number[] = [];
  const off = b.subscribe((id) => seen.push(id));
  b.publish({ type: 'jobs' }); b.publish({ type: 'jobs' }); b.publish({ type: 'jobs' });
  off(); b.publish({ type: 'jobs' });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(b.since(2)!.map((x) => x.id), [3, 4]);
  assert.deepEqual(b.since(4), []);
});

test('an id older than the ring buffer returns null (the page must reset)', () => {
  const b = new EventBus(2);
  for (let i = 0; i < 5; i++) b.publish({ type: 'jobs' });
  assert.equal(b.since(1), null);
  assert.equal(b.lastId(), 5);
});
