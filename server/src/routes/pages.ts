import fs from 'node:fs';
import path from 'node:path';
import type { Context } from 'hono';
import type { App, Env } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { pageDir, indexOf, ensureFresh, resolveAsset, todayTrackerPage, preparePage, listPages } from '../pages.ts';
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
  app.get('/', (c) => {
    const L = LABELS[lang()];
    const items = listPages(deps.workspace).map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> <span class="muted">${esc(p.day)} · ${esc(p.kind)}</span>${p.reports.map((r) => ` · <a href="${esc(p.url + encodeURIComponent(r))}">${esc(r)}</a>`).join('')}</li>`).join('');
    return c.html(shell({ title: 'Joserah', lang: lang(), body: `<h1>${esc(L.pages)}</h1><ul>${items}</ul>` }));
  });
  app.get('/p/tracker', (c) => {
    const t = todayTrackerPage(deps.workspace);
    if (t && pageDir(deps.workspace, t.day, t.folder)) return c.redirect(`/p/${t.day}/${t.folder}/`, 302);
    return c.html(shell({ title: LABELS[lang()].tracker, lang: lang(), body: `<p>${esc(LABELS[lang()].noTracker)}</p>` }));
  });
  app.get('/tv', (c) => {
    const t = todayTrackerPage(deps.workspace);
    const dir = t && pageDir(deps.workspace, t.day, t.folder);
    const html = t && dir ? serveIndex(dir, `${t.day}/${t.folder}`, 'tv') : null;
    if (!html) return c.html(shell({ title: 'TV', lang: lang(), nav: false, tv: true, head: '<meta name="joserah-mode" content="tv"><meta http-equiv="refresh" content="60">', body: `<p>${esc(LABELS[lang()].noTracker)}</p>` }));
    return c.html(html);
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
