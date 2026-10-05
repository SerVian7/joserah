import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signedIn } from './helpers.ts';

function put(ws: string, rel: string, text: string) { const p = path.join(ws, '.joserah/knowledge', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

test('the wiki home lists pages and offers search, ask and upload', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/enc.md', '---\ntitle: Encoders\ntype: topic\n---\n\nBody.\n');
  const html = await (await app.request('/w/', { headers: { cookie } })).text();
  assert.match(html, /<a href="\/w\/page\/wiki\/topics\/enc\.md">Encoders<\/a>/);
  assert.match(html, /<form id="ask"/); assert.match(html, /<form id="upload"/); assert.match(html, /action="\/w\/search"/);
});

test('a page renders with resolved links, wikilinks and backlinks', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/enc.md', '# Encoders\n\n[unit](../entities/unit.md) and [[unit]]. <script>x</script>\n');
  put(deps.workspace, 'wiki/entities/unit.md', '---\ntitle: Unit\n---\n\n# Unit\n');
  let html = await (await app.request('/w/page/wiki/topics/enc.md', { headers: { cookie } })).text();
  assert.equal((html.match(/href="\/w\/page\/wiki\/entities\/unit\.md"/g) ?? []).length, 2);
  assert.ok(!html.includes('<script>x'));
  html = await (await app.request('/w/page/wiki/entities/unit.md', { headers: { cookie } })).text();
  assert.match(html, /<a href="\/w\/page\/wiki\/topics\/enc\.md">Encoders<\/a>/, 'backlink');
  assert.ok(!html.includes('title: Unit'), 'frontmatter is not shown as text');
});

test('the claims view shows the measurement beside the calculation and struck lines struck', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/entities/enc.md', '# Enc\n\n- [calculation] Latency -> 90 ms\n  date: 2026-09-01 · source: imports/a.md\n- [measurement] latency -> 120 ms\n  condition: 1080p50 · date: 2026-09-02 · source: imports/b.md\n- [estimate] ~~cost -> 10~~\n  superseded: the offer of 2026-09-03\n');
  const html = await (await app.request('/w/claims', { headers: { cookie } })).text();
  const m = html.indexOf('120 ms'); const c = html.indexOf('90 ms');
  assert.ok(m > 0 && c > m, 'the measurement first, the calculation beside it');
  assert.match(html, /measurement speaks/);
  assert.match(html, /<s>cost -&gt; 10<\/s>/);
  assert.match(html, /1080p50/);
});

test('search folds Turkish letters', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/i.md', '# İç yayın\n');
  const html = await (await app.request('/w/search?q=ic%20yayin', { headers: { cookie } })).text();
  assert.match(html, /\/w\/page\/wiki\/topics\/i\.md/);
});

test('wiki traversal is refused', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/a.md', '# A');
  const secret = fs.readFileSync(path.join(deps.workspace, '.joserah', 'config.json'), 'utf8').trim();
  for (const p of ['/w/page/../../config.json', '/w/page/..%2f..%2fconfig.json', '/w/page/wiki/..%5c..%5c..%5cconfig.json', '/w/page/%2e%2e/%2e%2e/config.json', '/w/page/wiki/a.txt', '/w/page/.lint/x.md']) {
    const r = await app.request(p, { headers: { cookie } });
    const body = await r.text();
    assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
    assert.ok(!body.includes(secret), p);
  }
});

test('the page script carries the ask and upload handlers', async (t) => {
  const { app, cookie } = await signedIn(t);
  const js = await (await app.request('/_/app.js', { headers: { cookie } })).text();
  assert.match(js, /#ask/); assert.match(js, /\/api\/query/);
  assert.match(js, /#upload/); assert.match(js, /\/api\/ingest/);
});

test('a missing knowledge folder is an empty wiki, not an error; signed out redirects', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  fs.rmSync(path.join(deps.workspace, '.joserah', 'knowledge'), { recursive: true, force: true });
  assert.equal((await app.request('/w/', { headers: { cookie } })).status, 200);
  assert.equal((await app.request('/w/page/wiki/a.md', { headers: { cookie } })).status, 404);
  assert.equal((await app.request('/w/log', { headers: { cookie } })).status, 200);
  const out = await app.request('/w/', { redirect: 'manual' });
  assert.equal(out.status, 302); assert.match(out.headers.get('location') ?? '', /^\/login\?next=/);
});

test('pages with spaces and brackets link correctly; the generated index and log are readable', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/a b (1).md', '# Odd\n');
  put(deps.workspace, 'wiki/topics/src.md', '# Src\n\nSee [[Odd]] and [x](a%20b%20(1).md).\n');
  put(deps.workspace, 'wiki/index.md', '# Wiki index\n\n- [Src](topics/src.md)\n');
  let html = await (await app.request('/w/page/wiki/topics/src.md', { headers: { cookie } })).text();
  assert.equal((html.match(/href="\/w\/page\/wiki\/topics\/a%20b%20%281%29\.md"/g) ?? []).length, 2);
  const odd = await app.request('/w/page/wiki/topics/a%20b%20%281%29.md', { headers: { cookie } });
  assert.equal(odd.status, 200);
  html = await (await app.request('/w/page/wiki/index.md', { headers: { cookie } })).text();
  assert.match(html, /href="\/w\/page\/wiki\/topics\/src\.md"/);
});

test('links keep their anchor and reach the generated index', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/index.md', '# Wiki index\n');
  put(deps.workspace, 'wiki/topics/b.md', '# B\n');
  put(deps.workspace, 'wiki/topics/a.md', '# A\n\n[b](b.md#part) [home](../index.md)\n');
  const html = await (await app.request('/w/page/wiki/topics/a.md', { headers: { cookie } })).text();
  assert.match(html, /href="\/w\/page\/wiki\/topics\/b\.md#part"/);
  assert.match(html, /href="\/w\/page\/wiki\/index\.md"/);
});
