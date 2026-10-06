import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { jsonError } from '../app.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';
import { Refused } from '../jobs.ts';
import { pageUrl } from './wiki.ts';

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  app.post('/api/lint', (c) => c.json({ findings: deps.lint.runDeterministic().length }));
  app.post('/api/lint/llm', (c) => {
    try { const j = deps.lint.runLlm(); return j ? c.json({ id: j.id }, 201) : c.json({ id: null, reason: 'nothing changed' }); }
    catch (e) { if (e instanceof Refused) return jsonError(c, e.code === 'daily-budget' ? 429 : 400, e.code, { message: e.message }); throw e; }
  });
  app.get('/w/lint', (c) => {
    const L = LABELS[lang()]; const latest = deps.lint.latest() ?? { at: '', findings: [] };
    const byKind = new Map<string, typeof latest.findings>();
    for (const f of latest.findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind)!.push(f); }
    // A stale-raw finding names a source under imports/, not a wiki page: no link.
    const where = (f: (typeof latest.findings)[number]) => { const t = `${esc(f.rel)}${f.line ? `:${f.line}` : ''}`; return f.kind === 'stale-raw' ? t : `<a href="${esc(pageUrl(f.rel))}">${t}</a>`; };
    const body = `<h1>${esc(L.lint)}</h1><p class="muted">${esc(latest.at)}</p>
<p><button data-lint="now">${esc(L.lint)}</button> <button data-lint="llm">${esc(L.lint)} (${esc(L.withModel)})</button></p>
${[...byKind].map(([k, fs]) => `<h2>${esc(k)} (${fs.length})</h2><ul>${fs.map((f) => `<li>${where(f)} — ${esc(f.detail)}</li>`).join('')}</ul>`).join('')}
<script>document.querySelectorAll('button[data-lint]').forEach(function(b){b.addEventListener('click',function(){fetch(b.getAttribute('data-lint')==='llm'?'/api/lint/llm':'/api/lint',{method:'POST',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){location.href=j.id?'/jobs/'+j.id:'/w/lint'})})})</script>`;
    return c.html(shell({ title: L.lint, lang: lang(), body }));
  });
}
