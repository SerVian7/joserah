import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SHIM_JS } from '../src/shim.ts';
import { preparePage } from '../src/pages.ts';

type Fetch = (url: string, init?: { method?: string; body?: string }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;
function browser(o: { page?: string; mode?: string; fetch: Fetch; session?: Record<string, string>; EventSource?: unknown }) {
  const appended: Array<{ id: string; text: string; href?: string }> = [];
  const store = new Map(Object.entries(o.session ?? {}));
  const el = (tag: string) => { const e: Record<string, unknown> & { children: unknown[] } = { tag, children: [], style: {}, setAttribute() {}, appendChild(c: unknown) { this.children.push(c); return c; } }; return e; };
  const document = {
    documentElement: { lang: 'en' }, readyState: 'complete',
    querySelector: (sel: string) => (sel.includes('joserah-page') && o.page ? { getAttribute: () => o.page } : sel.includes('joserah-mode') ? { getAttribute: () => o.mode ?? 'page' } : null),
    getElementById: (id: string) => appended.find((a) => a.id === id) ?? null,
    createElement: el, createTextNode: (text: string) => ({ text }),
    body: { appendChild: (b: { id: string; children: Array<{ text?: string; textContent?: string; href?: string }> }) => { appended.push({ id: b.id, text: b.children.map((c) => c.text ?? c.textContent ?? '').join(''), href: b.children.find((c) => c.href)?.href }); } },
  };
  const window: Record<string, unknown> = {
    document, location: { pathname: '/p/2026-10-06/daily-tracker/', search: '', reload() { window.reloaded = true; } },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    fetch: o.fetch, setTimeout, clearTimeout, setInterval: () => 0, Date, JSON, encodeURIComponent, Promise,
  };
  if (o.EventSource) window.EventSource = o.EventSource;
  window.window = window;
  vm.runInNewContext(SHIM_JS, window);
  return { window, appended, store };
}
const res = (status: number, body: unknown = {}) => Promise.resolve({ status, ok: status < 300, json: () => Promise.resolve(body) });

test('shim: db set() PUTs to the page\'s answers', async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const { window } = browser({ page: '2026-10-06/daily-tracker', fetch: (url, init) => { calls.push({ url, ...init }); return res(200, { ok: true }); } });
  const claude = window.claude as { use(n: string): Promise<{ collection(n: string): { doc(id: string): { set(a: unknown): Promise<void> } } }> };
  const db = await claude.use('db');
  await db.collection('answers').doc('a-x-1').set({ key: 'A' });
  assert.equal(calls[0].url, '/api/db/2026-10-06/daily-tracker/answers/a-x-1');
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, '{"key":"A"}');
});

test('shim shows the signed-out banner on 401', async () => {
  const { window, appended } = browser({ page: '2026-10-06/daily-tracker', fetch: () => res(401, { error: 'signed-out' }) });
  const claude = window.claude as { use(n: string): Promise<{ collection(n: string): { doc(id: string): { set(a: unknown): Promise<void> } } }> };
  const db = await claude.use('db');
  await assert.rejects(db.collection('answers').doc('a-x-1').set({}), (e: { code: string }) => e.code === 'signed-out');
  assert.equal(appended.length, 1);
  assert.match(appended[0].text, /Signed out/);
  assert.equal(appended[0].href, '/login?next=%2Fp%2F2026-10-06%2Fdaily-tracker%2F');
  // A second 401 adds no second banner and never reloads the page (no reload loop).
  await assert.rejects(db.collection('answers').doc('a-x-1').set({}));
  assert.equal(appended.length, 1);
  assert.ok(!window.reloaded);
});

// Added (Review Focus 5): the event stream closed by a 401 asks /api/me once; signed out → the banner, no reload.
test('shim: a closed event stream while signed out shows the banner, not a reload', async () => {
  const made: Array<{ readyState: number; onerror?: () => void; close(): void }> = [];
  class FakeES { readyState = 0; onmessage?: (m: { data: string }) => void; onerror?: () => void; url: string; constructor(url: string) { this.url = url; made.push(this); } close() { this.readyState = 2; } }
  const urls: string[] = [];
  const { window, appended } = browser({ page: '2026-10-06/daily-tracker', EventSource: FakeES, fetch: (url) => { urls.push(url); return res(401, { error: 'signed-out' }); } });
  assert.equal(made.length, 1);
  made[0].readyState = 2; made[0].onerror!();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(urls, ['/api/me']);
  assert.equal(appended.length, 1);
  assert.match(appended[0].text, /Signed out/);
  assert.ok(!window.reloaded);
});

test('shim: hot data comes back after a reload and ready() hands it over', () => {
  const saved = JSON.stringify({ state: { p: 'x' }, sig: { k: 1 } });
  const { window, store } = browser({ page: '2026-10-06/daily-tracker', fetch: () => res(200), session: { 'jh:hot:/p/2026-10-06/daily-tracker/': saved } });
  const hot = (window.claude as { hot: { data: unknown; ready(cb: (h: unknown) => void): void } }).hot;
  assert.deepEqual(hot.data, { state: { p: 'x' }, sig: { k: 1 } });
  let got: unknown = null; hot.ready((h) => { got = h; });
  assert.deepEqual(got, { state: { p: 'x' }, sig: { k: 1 } });
  assert.equal(store.size, 0, 'used once');
});

test('shim: the TV view has no database', async () => {
  const { window } = browser({ page: '2026-10-06/daily-tracker', mode: 'tv', fetch: () => res(200) });
  await assert.rejects((window.claude as { use(n: string): Promise<unknown> }).use('db'));
});

test('preparePage puts the shim before any page script', () => {
  const h = preparePage('<html><head><script>window.x=1</script></head><body></body></html>', { page: 'd/f', mode: 'page' });
  assert.ok(h.indexOf('/_/shim.js') < h.indexOf('window.x=1'));
  assert.ok(h.indexOf('joserah-mode') < h.indexOf('/_/shim.js'), 'after the two meta tags');
});
