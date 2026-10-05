import fs from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { jsonError } from '../app.ts';
import { pageDir } from '../pages.ts';
import { answersLib } from '../cjs.ts';
import { SHIM_JS } from '../shim.ts';

/** The shim, the page's answers (the artifact runtime's `db`, collection `answers`), the page stamp for polling, and /api/me. */
export function register(app: App, deps: AppDeps): void {
  app.get('/_/shim.js', (c) => c.body(SHIM_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }));
  app.get('/api/me', (c) => c.json({ ok: true }));
  app.get('/api/db/:day/:folder/answers', (c) => {
    const dir = pageDir(deps.workspace, c.req.param('day'), c.req.param('folder'));
    if (!dir) return jsonError(c, 404, 'not-found');
    return c.json({ docs: answersLib.list(dir).map(({ id, ...data }) => ({ id, data })) });
  });
  app.put('/api/db/:day/:folder/answers/:id', async (c) => {
    const { day, folder, id } = c.req.param();
    if (!pageDir(deps.workspace, day, folder)) return jsonError(c, 404, 'not-found');
    let body: unknown;
    try { body = await c.req.json(); } catch { return jsonError(c, 400, 'bad-doc'); }
    let r: ReturnType<AppDeps['store']['putAnswer']>;
    try { r = deps.store.putAnswer(`${day}/${folder}`, id, body); } catch (e) {
      // The shared lock held past its wait, or taken over by another writer: try again later. Anything else: the write failed.
      const busy = /held by another writer|taken over/.test((e as Error).message);
      console.error(`joserah: answer ${day}/${folder}/${id} not written: ${(e as Error).message}`);
      return jsonError(c, busy ? 503 : 500, busy ? 'busy' : 'write-failed');
    }
    if (r.ok) return c.json({ ok: true });
    return jsonError(c, r.code === 'not-yours' ? 409 : 400, r.code);
  });
  app.get('/api/stamp/:day/:folder', (c) => {
    const dir = pageDir(deps.workspace, c.req.param('day'), c.req.param('folder'));
    if (!dir) return jsonError(c, 404, 'not-found');
    const stamp = ['index.html', 'rows.json', 'trail.json', 'cases.json'].reduce((m, f) => { try { return Math.max(m, fs.statSync(path.join(dir, f)).mtimeMs); } catch { return m; } }, 0);
    return c.json({ stamp });
  });
}
