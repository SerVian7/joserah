import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signedIn, ORIGIN } from './helpers.ts';
import { scanUpload, safeName, slug } from '../src/wiki-books.ts';
import { ingestBookkeeping } from '../src/wiki-books.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

function upload(cookie: string, name: string, content: string | Uint8Array<ArrayBuffer>) {
  const fd = new FormData();
  fd.append('file', new Blob([content]), name);
  return { method: 'POST', headers: { cookie, origin: ORIGIN }, body: fd };
}
const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('names are made safe; the scan names patterns, never the secret', () => {
  assert.equal(safeName('../../x/rapor:2026?.pdf'), 'rapor-2026-.pdf');
  assert.equal(safeName('.hidden'), null);
  assert.equal(safeName(''), null);
  assert.deepEqual(scanUpload(Buffer.from('nothing here, just notes about İstanbul')), []);
  const hits = scanUpload(Buffer.from('api_key = sk-abcdefghijklmnop1234'));
  assert.ok(hits.length >= 1);
  assert.ok(!hits.join(' ').includes('sk-abcdefghijklmnop1234'));
  assert.equal(slug('Kaç kanal var? İç yayın'), 'kac-kanal-var-ic-yayin');
});

test('a credential-shaped upload is quarantined verbatim, with an owner row and no job', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const r = await app.request('/api/ingest', upload(cookie, 'creds.txt', 'password: hunter2hunter2'));
  assert.equal(r.status, 202);
  const j = await r.json();
  assert.equal(j.path, `imports/${DAY}-quarantine/creds.txt`);
  assert.equal(fs.readFileSync(path.join(deps.workspace, j.path), 'utf8'), 'password: hunter2hunter2', 'verbatim');
  assert.equal(deps.jobs.list().length, 0, 'no model reads it');
  const rows = JSON.parse(fs.readFileSync(path.join(deps.workspace, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8'));
  const row = (Array.isArray(rows) ? rows : rows.rows).find((x: { title: string }) => /creds\.txt/.test(x.title));
  assert.equal(row.state, 'you');
  assert.ok(!JSON.stringify(rows).includes('hunter2'));
});

test('a clean upload is copied verbatim, registered, and starts a restricted ingest job', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const r = await app.request('/api/ingest', upload(cookie, 'notes.md', '# Notes\n\nThe encoder runs at 50 fps.\n'));
  assert.equal(r.status, 201);
  const { id, path: rel } = await r.json();
  assert.equal(rel, `imports/${DAY}-upload/notes.md`);
  const job = deps.jobs.get(id)!;
  assert.equal(job.type, 'ingest');
  assert.equal(job.pointers![0], rel);
  const reg = JSON.parse(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/sources.json'), 'utf8'));
  assert.equal(reg.sources[rel].status, 'raw');
  assert.equal(reg.sources[rel].job, id);
  await deps.jobs.idle();
});

test('after an ingest job the server marks the source compiled, rebuilds the index and logs it', async (t) => {
  const { deps } = await signedIn(t);
  const rel = `imports/${DAY}-upload/notes.md`;
  deps.store.importVerbatim(Buffer.from('# n'), rel);
  const done = { id: 'j-1', day: DAY, type: 'ingest', target: 'server', text: `Ingest ${rel}`, state: 'done', createdAt: '', model: 'sonnet', budgetUsd: 2, rowTitle: 'x', turns: 1,
    pointers: [rel], changed: [{ status: 'A', path: '.joserah/knowledge/wiki/sources/notes.md' }, { status: 'M', path: '.joserah/knowledge/wiki/entities/enc.md' }], flags: [] } as const;
  fs.mkdirSync(path.join(deps.workspace, '.joserah/knowledge/wiki/sources'), { recursive: true });
  fs.writeFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/sources/notes.md'), '---\ntitle: Notes\ntype: source\n---\n');
  const job = structuredClone(done) as unknown as import('../src/jobs.ts').JobRecord;
  ingestBookkeeping({ store: deps.store, workspace: deps.workspace })(job);
  const reg = JSON.parse(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/sources.json'), 'utf8'));
  assert.equal(reg.sources[rel].status, 'compiled');
  assert.deepEqual(reg.sources[rel].compiled_to, ['.joserah/knowledge/wiki/entities/enc.md', '.joserah/knowledge/wiki/sources/notes.md']);
  assert.match(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/index.md'), 'utf8'), /\[Notes\]\(sources\/notes\.md\)/);
  assert.match(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/log.md'), 'utf8'), /^## \[2026-10-06\] ingest \| notes\.md$/m);
  const none = { ...structuredClone(done), changed: [] } as unknown as import('../src/jobs.ts').JobRecord;
  ingestBookkeeping({ store: deps.store, workspace: deps.workspace })(none);
  assert.deepEqual(none.flags, ['ingest wrote no wiki page']);
});

test('a question runs a read-only query job; a good answer is filed as a page', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const r = await app.request('/api/query', json(cookie, { question: 'Kaç kanal var?' }));
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.equal(deps.jobs.get(id)!.type, 'query');
  await deps.jobs.idle();
  const f = await app.request(`/api/query/${id}/file`, json(cookie, { title: 'Kaç kanal var?' }));
  assert.equal(f.status, 201);
  const { path: rel } = await f.json();
  assert.equal(rel, '.joserah/knowledge/wiki/answers/kac-kanal-var.md');
  const text = fs.readFileSync(path.join(deps.workspace, rel), 'utf8');
  assert.match(text, /^title: Kaç kanal var\?$/m); assert.match(text, /^type: answer$/m); assert.match(text, new RegExp(`^source: job ${id}$`, 'm'));
  assert.match(text, /> Asked: Kaç kanal var\?/); assert.match(text, /Done\./);
  assert.match(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/log.md'), 'utf8'), /query \| Kaç kanal var\?/);
  const again = await app.request(`/api/query/${id}/file`, json(cookie, { title: 'Kaç kanal var?' }));
  assert.equal((await again.json()).path, '.joserah/knowledge/wiki/answers/kac-kanal-var-2.md');
});

test('uploads over the limit and without a file are refused', async (t) => {
  const { app, cookie } = await signedIn(t);
  assert.equal((await app.request('/api/ingest', { method: 'POST', headers: { cookie, origin: ORIGIN }, body: new FormData() })).status, 400);
  assert.equal((await app.request('/api/ingest', upload(cookie, 'big.bin', new Uint8Array(25 * 1024 * 1024 + 1)))).status, 413);
});

test('a done query job page offers "file it"; an unfinished or unknown job cannot be filed', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const { id } = await (await app.request('/api/query', json(cookie, { question: 'Kaç kanal var?' }))).json();
  assert.equal((await app.request(`/api/query/${id}/file`, json(cookie, { title: 'x' }))).status, 409, 'still queued');
  assert.doesNotMatch(await (await app.request(`/jobs/${id}`, { headers: { cookie } })).text(), /id="file-title"/);
  await deps.jobs.idle();
  const page = await (await app.request(`/jobs/${id}`, { headers: { cookie } })).text();
  assert.match(page, /id="file-title"/);
  assert.match(page, /data-act="file"/);
  assert.equal((await app.request('/api/query/j-nope/file', json(cookie, { title: 'x' }))).status, 404);
});

test('the scan also reads UTF-16 text; a JSON null body is a 400, not a 500', async (t) => {
  assert.ok(scanUpload(Buffer.from('﻿password: hunter2hunter2', 'utf16le')).length >= 1);
  assert.deepEqual(scanUpload(Buffer.from('﻿just notes', 'utf16le')), []);
  const { app, cookie } = await signedIn(t);
  assert.equal((await app.request('/api/query', json(cookie, null))).status, 400);
});
