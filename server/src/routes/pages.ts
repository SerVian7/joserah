import fs from 'node:fs';
import path from 'node:path';
import type { Context } from 'hono';
import type { App, Env } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { pageDir, indexOf, ensureFresh, resolveAsset, preparePage, ARTIFACTS } from '../pages.ts';
import { renderMarkdown } from '../markdown.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };
// The raw request path inside a page: day and folder segments, then the rest, all still percent-encoded.
const IN_PAGE = /^\/p\/([^/]+)\/([^/]+)\/(.*)$/;

/** The page's index.html, re-rendered first when stale; null when it is no longer a regular file inside the page folder. */
export function serveIndex(dir: string, page: string, mode: 'page' | 'tv'): string | null {
  ensureFresh(dir);
  const index = indexOf(dir);
  return index ? preparePage(fs.readFileSync(index, 'utf8'), { page, mode }) : null;
}

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  // The Tracker is one living page (desk/artifacts/tracker/) drawn from the job files; /p/tracker and the TV view lead to it.
  const TRACKER_FILES: Record<string, string> = { '': 'index.html', 'index.html': 'index.html', 'style.css': 'style.css', 'jobs.js': 'jobs.js' };
  const TRACKER_TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  const trackerHome = (c: Context<Env>) => c.redirect('/tracker/', 302);
  app.get('/p/tracker', trackerHome);
  app.get('/tv', trackerHome);
  app.get('/tracker', trackerHome);
  const trackerFile = (c: Context<Env>) => {
    const name = c.req.param('name') ?? '';
    const f = Object.hasOwn(TRACKER_FILES, name) ? TRACKER_FILES[name] : undefined;
    const file = f && path.join(deps.workspace, ARTIFACTS, 'tracker', f);
    if (!file || !fs.existsSync(file)) return c.html(shell({ title: LABELS[lang()].tracker, lang: lang(), body: `<p>${esc(LABELS[lang()].noTracker)}</p>` }));
    return c.body(fs.readFileSync(file), 200, { 'Content-Type': TRACKER_TYPES[path.extname(f)], 'Cache-Control': 'no-store' });
  };
  app.get('/tracker/', trackerFile);
  app.get('/tracker/:name', trackerFile);
  // The job files the page polls: a listing and the flat .json files of desk/jobs (the server's own job records sit in day folders there).
  const JOBS = () => path.join(deps.workspace, '.joserah', 'desk', 'jobs');
  const JOB_FILE = /^[^.][^/\\]*\.json$/;
  app.get('/jobs/index.json', (c) => {
    let list: Array<{ n: string; t: number }> = [];
    try { list = fs.readdirSync(JOBS()).filter((n) => JOB_FILE.test(n)).map((n) => ({ n, t: fs.statSync(path.join(JOBS(), n)).mtimeMs })); } catch { /* no jobs yet */ }
    return c.json(list, 200, { 'Cache-Control': 'no-store' });
  });
  app.get('/jobs/:name', (c, next) => {
    const n = c.req.param('name');
    if (!JOB_FILE.test(n)) return next();
    try { return c.body(fs.readFileSync(path.join(JOBS(), n)), 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); } catch { return c.notFound(); }
  });
  // Only a real page gets its slash added; anything else is a plain 404, so no redirect is ever built from an unchecked name.
  app.get('/p/:day/:folder', (c) => {
    const { day, folder } = c.req.param();
    return pageDir(deps.workspace, day, folder) ? c.redirect(`/p/${day}/${folder}/`, 302) : c.notFound();
  });
  const inPage = (c: Context<Env>) => {
    // Day, folder and sub path come from the raw path and are decoded exactly once here (Review Focus 1).
    const m = IN_PAGE.exec(new URL(c.req.url).pathname);
    if (!m) return c.notFound();
    let day: string, folder: string, sub: string;
    try { day = decodeURIComponent(m[1]); folder = decodeURIComponent(m[2]); sub = decodeURIComponent(m[3]); } catch { return c.notFound(); }
    const dir = pageDir(deps.workspace, day, folder);
    if (!dir) return c.notFound();
    const prefix = `/p/${day}/${folder}/`;
    if (sub === '' || sub === 'index.html') { const html = serveIndex(dir, `${day}/${folder}`, 'page'); return html ? c.html(html) : c.notFound(); }
    const file = resolveAsset(dir, sub);
    if (!file) return c.notFound();
    if (file.endsWith('.md')) {
      const html = renderMarkdown(fs.readFileSync(file, 'utf8'), { resolveHref: (h) => (h.includes('..') ? null : h.startsWith('/') ? h : prefix + h) });
      return c.html(shell({ title: path.basename(file), lang: lang(), body: html }));
    }
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return c.body(fs.readFileSync(file), 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' });
    // An SVG opened on its own could run script on this origin; as a download it cannot (an <img> ignores the disposition).
    const extra: Record<string, string> = type === 'image/svg+xml' ? { 'Content-Disposition': 'attachment' } : {};
    return c.body(fs.readFileSync(file), 200, { 'Content-Type': type, ...extra });
  };
  app.get('/p/:day/:folder/', inPage);   // explicit: Hono is strict about the trailing slash
  app.get('/p/:day/:folder/*', inPage);
}
