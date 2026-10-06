import fs from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { wikiLib, type WikiPage } from '../cjs.ts';
import { renderMarkdown } from '../markdown.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';

const GENERATED = new Set(['wiki/index.md', 'wiki/log.md']);
const SEG = /^[^\\/:*?"<>|\0]{1,160}$/;
const CSS = '<style>table.claims td,table.claims th{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}tr.struck{color:var(--muted)}.speaks{color:var(--ok)}#ask textarea{min-height:4em}form{margin:12px 0}</style>';

/** A page path from the URL: decoded once, `.md` only, no dot, backslash, colon or empty segment. Anything else is null (404). */
export function pageRel(raw: string): string | null {
  let rel: string; try { rel = decodeURIComponent(raw); } catch { return null; }
  const segs = rel.split('/');
  if (!rel.endsWith('.md') || segs.some((s) => !SEG.test(s) || s === '.' || s === '..' || s.startsWith('.'))) return null;
  return rel;
}

/** The URL of a page, each segment escaped (parentheses too, so they cannot end a Markdown link early). */
export function pageUrl(rel: string): string {
  return '/w/page/' + rel.split('/').map((s) => encodeURIComponent(s).replace(/[()]/g, (ch) => (ch === '(' ? '%28' : '%29'))).join('/');
}

export function wikiHtml(page: WikiPage, pages: WikiPage[]): string {
  const withWikilinks = page.body.replace(/\[\[([^\]]+)\]\]/g, (_m, name: string) => {
    const r = wikiLib.resolveWikilink(pages, name);
    const label = name.split('|').pop()!.trim();
    return r ? `[${label.replace(/[[\]]/g, '')}](${pageUrl(r)})` : label;
  });
  return renderMarkdown(withWikilinks, { resolveHref: (h) => {
    if (h.startsWith('/w/page/')) return h;
    const r = wikiLib.resolveLink(page.rel, h);
    const frag = /#[^?]*$/.exec(h.split('?')[0]);
    return r && r.kind === 'page' && (GENERATED.has(r.rel) || pages.some((p) => p.rel === r.rel)) ? pageUrl(r.rel) + (frag ? encodeURI(frag[0]) : '') : null;
  } });
}

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  const nav = (L: (typeof LABELS)[keyof typeof LABELS]) => `<p><a href="/w/claims">${esc(L.claims)}</a> · <a href="/w/lint">${esc(L.lint)}</a> · <a href="/w/log">${esc(L.log)}</a></p>`;
  app.get('/w', (c) => c.redirect('/w/', 302));
  app.get('/w/', (c) => {
    const L = LABELS[lang()]; const pages = wikiLib.scan(deps.workspace);
    const groups = new Map<string, WikiPage[]>();
    for (const p of pages) { const g = p.rel.split('/').slice(0, -1).join('/') || '.'; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(p); }
    const list = [...groups].map(([g, ps]) => `<h3>${esc(g)}</h3><ul>${ps.map((p) => `<li><a href="${esc(pageUrl(p.rel))}">${esc(p.title)}</a> <span class="muted">${esc(p.description)}</span></li>`).join('')}</ul>`).join('');
    const body = `<h1>${esc(L.wiki)}</h1>${nav(L)}
<form method="get" action="/w/search"><input name="q" type="search" aria-label="${esc(L.search)}"> <button>${esc(L.search)}</button></form>
<form id="ask"><textarea name="question" required maxlength="4000" aria-label="${esc(L.ask)}"></textarea><button>${esc(L.ask)}</button><span class="err"></span></form>
<form id="upload"><input type="file" name="file" required aria-label="${esc(L.upload)}"> <button>${esc(L.upload)}</button><span class="err"></span></form>${list}<script src="/_/app.js"></script>`;
    return c.html(shell({ title: L.wiki, lang: lang(), head: CSS, here: '/w/', body }));
  });
  app.get('/w/page/*', (c) => {
    const rel = pageRel(new URL(c.req.url).pathname.slice('/w/page/'.length));
    if (!rel) return c.notFound();
    let base: string; let real: string;
    try { base = fs.realpathSync(path.join(deps.workspace, wikiLib.KNOWLEDGE)); real = fs.realpathSync(path.join(base, ...rel.split('/'))); } catch { return c.notFound(); }
    const r = path.relative(base, real);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return c.notFound();
    const pages = wikiLib.scan(deps.workspace);
    const page = pages.find((p) => p.rel === rel) ?? (rel === 'wiki/index.md' || rel === 'wiki/log.md'
      ? { rel, title: path.posix.basename(rel), type: '', description: '', body: fs.readFileSync(real, 'utf8'), links: [], wikilinks: [], bytes: 0, mtimeMs: 0, sha1: '', hasFrontmatter: false, unclosed: false, bodyLine: 0 } : undefined);
    if (!page) return c.notFound();
    const back = (wikiLib.backlinks(pages).get(rel) ?? []).map((b) => pages.find((p) => p.rel === b)!).filter(Boolean);
    const L = LABELS[lang()];
    const body = `${wikiHtml(page, pages)}${back.length ? `<h2>←</h2><ul>${back.map((p) => `<li><a href="${esc(pageUrl(p.rel))}">${esc(p.title)}</a></li>`).join('')}</ul>` : ''}${nav(L)}`;
    return c.html(shell({ title: page.title, lang: lang(), head: CSS, here: '/w/', body }));
  });
  app.get('/w/claims', (c) => {
    const L = LABELS[lang()];
    const all = wikiLib.claims(wikiLib.scan(deps.workspace));
    const order: Record<string, number> = { measurement: 0, calculation: 1, decision: 2, estimate: 3 };
    const bySubject = new Map<string, typeof all>();
    for (const cl of all) { const k = wikiLib.fold(cl.subject); if (!bySubject.has(k)) bySubject.set(k, []); bySubject.get(k)!.push(cl); }
    const rows = [...bySubject.values()].map((list) => {
      list.sort((a, b) => Number(a.struck) - Number(b.struck) || (order[a.type] ?? 4) - (order[b.type] ?? 4));
      const live = list.filter((x) => !x.struck);
      const speaks = live.some((x) => x.type === 'measurement') && live.some((x) => x.type === 'calculation');
      return list.map((x) => {
        const v = esc(`${x.subject}${x.value !== null ? ` -> ${x.value}` : ''}`);
        return `<tr class="${x.struck ? 'struck' : ''}"><td>${esc(x.type)}${speaks && x.type === 'measurement' && !x.struck ? ' <span class="speaks">· measurement speaks</span>' : ''}</td><td>${x.struck ? `<s>${v}</s>` : v}${x.fields.superseded ? `<br><span class="muted">superseded: ${esc(x.fields.superseded)}</span>` : ''}</td><td>${esc(x.fields.condition ?? '')}</td><td>${esc(x.fields.date ?? '')}</td><td>${esc(x.fields.source ?? '')}</td><td><a href="${esc(pageUrl(x.page))}">${esc(x.page)}</a></td></tr>`;
      }).join('');
    }).join('');
    return c.html(shell({ title: L.claims, lang: lang(), head: CSS, body: `<h1>${esc(L.claims)}</h1><table class="claims"><tr><th>kind</th><th>claim</th><th>condition</th><th>date</th><th>source</th><th>page</th></tr>${rows}</table>` }));
  });
  app.get('/w/search', (c) => {
    const L = LABELS[lang()]; const q = c.req.query('q') ?? '';
    const hits = wikiLib.search(wikiLib.scan(deps.workspace), q);
    return c.html(shell({ title: L.search, lang: lang(), body: `<h1>${esc(L.search)}: ${esc(q)}</h1><ul>${hits.map((h) => `<li><a href="${esc(pageUrl(h.rel))}">${esc(h.title)}</a><br><span class="muted">${esc(h.snippet)}</span></li>`).join('')}</ul>` }));
  });
  app.get('/w/log', (c) => {
    const L = LABELS[lang()];
    const p = path.join(deps.workspace, wikiLib.KNOWLEDGE, 'wiki', 'log.md');
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '# Wiki log\n';
    return c.html(shell({ title: L.log, lang: lang(), body: renderMarkdown(text) }));
  });
}
