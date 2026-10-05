import test from 'node:test';
import assert from 'node:assert/strict';
import { signedIn } from './helpers.ts';

async function readUntil(res: Response, pred: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let text = '';
  const deadline = Date.now() + 3000;
  while (!pred(text) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  await reader.cancel();
  return text;
}

test('events stream live and resume after Last-Event-ID', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const first = deps.bus.publish({ type: 'changed', path: 'a' });
  deps.bus.publish({ type: 'changed', path: 'b' });
  const res = await app.request('/events', { headers: { cookie, 'last-event-id': String(first) } });
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const text = await readUntil(res, (s) => s.includes('"path":"b"'));
  assert.match(text, /data: {"type":"changed","path":"b"}/);
  assert.match(text, /^id: 2$/m);
  assert.ok(!text.includes('"path":"a"'));
});

test('an id older than the buffer gets a reset', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  for (let i = 0; i < 1005; i++) deps.bus.publish({ type: 'jobs' });
  const text = await readUntil(await app.request('/events', { headers: { cookie, 'last-event-id': '1' } }), (s) => s.includes('reset'));
  assert.match(text, /"type":"reset"/);
});

test('events need a session', async (t) => {
  const { app } = await signedIn(t);
  assert.equal((await app.request('/events')).status, 401);
});

// Added: a fresh connection says hello, then hears what is published after it; closing it lets go of its subscription.
test('a fresh stream says hello, hears new events, and unsubscribes on close', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  let subs = 0;
  const orig = deps.bus.subscribe.bind(deps.bus);
  deps.bus.subscribe = (fn) => { subs++; const off = orig(fn); return () => { subs--; off(); }; };
  const res = await app.request('/events', { headers: { cookie } });
  setTimeout(() => deps.bus.publish({ type: 'answers', page: '2026-10-06/daily-tracker' }), 50);
  const text = await readUntil(res, (s) => s.includes('"answers"'));
  assert.match(text, /"type":"hello"/);
  assert.match(text, /data: {"type":"answers","page":"2026-10-06\/daily-tracker"}/);
  for (let i = 0; i < 50 && subs > 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(subs, 0);
});
