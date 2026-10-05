import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import type { JobRecord } from '../jobs.ts';
import { JOB_TYPES, workspaceLang } from '../config.ts';
import { listPages } from '../pages.ts';
import { localDay } from '../paths.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { APP_JS } from '../client.ts';
import { streamLines } from './jobs.ts';

const CSS = '<style>#job textarea{min-height:6em}.jobs li,.stream li{padding:6px 0;border-bottom:1px solid var(--line)}.jobs,.stream{padding-left:0;list-style:none}.stream .tool{color:var(--muted)}iframe.trk{width:100%;height:70vh;border:1px solid var(--line)}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}fieldset{border:0;padding:0;margin:0;min-width:0}</style>';
const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(4)}` : '—');

export function jobLine(j: JobRecord): string {
  return `<li data-job="${esc(j.id)}"><a href="/jobs/${esc(j.id)}">${esc(j.rowTitle)}</a> · <span class="state">${esc(j.state)}</span><br><span class="last muted"></span></li>`;
}

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  app.get('/_/app.js', (c) => c.body(APP_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }));
  app.get('/', (c) => {
    const L = LABELS[lang()]; const h = deps.engineHealth;
    const blocked = h && (!h.installed || !h.signedIn) ? h.detail : '';
    const running = deps.jobs.list().filter((j) => j.state === 'running' || j.state === 'queued');
    const today = deps.jobs.list(localDay()).reduce((sum, j) => sum + (typeof j.costUsd === 'number' ? j.costUsd : 0), 0);
    const pages = listPages(deps.workspace).map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> <span class="muted">${esc(p.day)}</span>${p.reports.map((r) => ` · <a href="${esc(p.url + encodeURIComponent(r))}">${esc(r)}</a>`).join('')}</li>`).join('');
    const body = `<h2>${esc(L.newJob)}</h2>
<form id="job"><fieldset${blocked ? ' disabled' : ''}>${blocked ? `<p class="err">${esc(L.disabled)}: ${esc(blocked)}</p>` : ''}
<textarea name="text" required maxlength="8000"></textarea>
<div class="row"><select name="type">${JOB_TYPES.map((t) => `<option${t === 'task' ? ' selected' : ''}>${t}</option>`).join('')}</select><button>${esc(L.send)}</button><span class="err"></span></div></fieldset></form>
<p class="muted">${esc(L.cost)}: ${esc(money(today))} (${esc(L.estimate)})</p>
<h2>${esc(L.running)}</h2><ul id="running" class="jobs">${running.length ? running.map(jobLine).join('') : `<li class="muted">${esc(L.none)}</li>`}</ul>
<h2>${esc(L.tracker)}</h2><iframe class="trk" src="/p/tracker" title="${esc(L.tracker)}"></iframe>
<h2>${esc(L.pages)}</h2><ul>${pages}</ul>`;
    return c.html(shell({ title: 'Joserah', lang: lang(), head: CSS, body: body + '<script src="/_/app.js"></script>' }));
  });
  app.get('/jobs', (c) => {
    const L = LABELS[lang()];
    return c.html(shell({ title: L.jobs, lang: lang(), head: CSS, body: `<h1>${esc(L.jobs)}</h1><ul class="jobs">${deps.jobs.list().slice(0, 100).map(jobLine).join('')}</ul><script src="/_/app.js"></script>` }));
  });
  app.get('/jobs/:id', (c) => {
    const L = LABELS[lang()]; const j = deps.jobs.get(c.req.param('id'));
    if (!j) return c.notFound();
    const lines = streamLines(deps.jobs.logTail(j.id, 400)).map((l) => `<li class="${l.kind}">${esc(l.kind === 'tool' ? `· ${l.text}` : l.text)}</li>`).join('');
    const btn = (act: string, label: string) => `<button data-act="${act}" data-id="${esc(j.id)}">${esc(label)}</button>`;
    const acts = [
      ...(j.state === 'running' || j.state === 'queued' ? [btn('cancel', L.cancel)] : []),
      ...(j.state === 'needs-approval' ? [btn('approve', L.approve)] : []),
      ...(['failed', 'interrupted', 'cancelled', 'refused'].includes(j.state) ? [btn('retry', L.retry)] : []),
    ].join(' ');
    const body = `<h1>${esc(j.rowTitle)}</h1>
<p data-job="${esc(j.id)}"><span class="state">${esc(j.state)}</span> · ${esc(j.type)} · ${esc(j.model)} · ${esc(money(j.costUsd))} (${esc(L.estimate)})${j.error ? ` · <span class="err">${esc(j.error)}</span>` : ''}</p>
<p>${esc(j.text)}</p><div class="row">${acts}</div>
${j.resultText ? `<h2>${esc(L.result)}</h2><p>${esc(j.resultText)}</p>` : ''}
${j.changed?.length ? `<h2>${esc(L.changed)}</h2><ul>${j.changed.map((f) => `<li>${esc(f.status)} ${esc(f.path)}</li>`).join('')}</ul>` : ''}
${j.flags?.length ? `<ul class="err">${j.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
<ol class="stream" data-job="${esc(j.id)}">${lines}</ol>
${['done', 'failed', 'needs-approval', 'interrupted'].includes(j.state) ? `<p><textarea id="reply-text" maxlength="8000"></textarea></p><p>${btn('reply', L.reply)}</p>` : ''}
<script src="/_/app.js"></script>`;
    return c.html(shell({ title: j.rowTitle, lang: lang(), head: CSS, body }));
  });
}
