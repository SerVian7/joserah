import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import type { JobRecord } from '../jobs.ts';
import { JOB_TYPES, workspaceLang } from '../config.ts';
import { listPages } from '../pages.ts';
import { shell, esc, jmark, LABELS, type Lang } from '../layout.ts';
import { APP_JS } from '../client.ts';
import { streamLines } from './jobs.ts';
import { presence, type Presence } from '../presence.ts';
import { kindWord, stateWord, errorText, STATES } from '../i18n.ts';

const CSS = '';
const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(4)}` : '—');

export function jobLine(j: JobRecord, lang: Lang = 'en'): string {
  return `<li data-job="${esc(j.id)}" data-state="${esc(j.state)}"><a href="/jobs/${esc(j.id)}">${esc(j.rowTitle)}</a> <span class="state">${esc(stateWord(lang, j.state))}</span><span class="last muted"></span></li>`;
}

/** What the presence says, in the owner's language: what waits on them first, then what is running, else that all is calm. */
export function sayings(p: Presence, lang: Lang): string[] {
  const L = LABELS[lang]; const n = (one: string, many: string, k: number) => (k === 1 ? one : many.replace('{n}', String(k)));
  const out: string[] = [];
  if (p.waiting.length) out.push(n(L.waiting1, L.waitingN, p.waiting.length));
  if (p.running.length) out.push(n(L.working1, L.workingN, p.running.length));
  return out.length ? out : [L.here];
}

export function waitingList(p: Presence, lang: Lang, max = 4): string {
  const L = LABELS[lang];
  const items = p.waiting.slice(0, max).map((w) => `<li><a href="${esc(w.url)}">${esc(w.title)}</a>${w.small ? `<span>${esc(w.small)}</span>` : ''}</li>`).join('');
  const more = p.waiting.length > max ? `<li class="more-n"><a href="/p/tracker">${esc(L.more.replace('{n}', String(p.waiting.length - max)))}</a></li>` : '';
  return items + more;
}

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  app.get('/_/app.js', (c) => c.body(APP_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }));
  app.get('/api/presence', (c) => c.json(presence(deps)));
  app.get('/', (c) => {
    const lg = lang(); const L = LABELS[lg]; const h = deps.engineHealth;
    const blocked = h && (!h.installed || !h.signedIn) ? h.detail : '';
    const p = presence(deps);
    const running = deps.jobs.list().filter((j) => j.state === 'running' || j.state === 'queued');
    const pages = listPages(deps.workspace).map((pg) => `<li><a href="${esc(pg.url)}">${esc(pg.title)}</a><span class="d">${esc(pg.day)}</span>${pg.reports.length ? `<span class="rp">${pg.reports.map((r) => `<a href="${esc(pg.url + encodeURIComponent(r))}">${esc(r)}</a>`).join('')}</span>` : ''}</li>`).join('');
    const body = `<div class="home">
<section id="presence"><canvas id="field" aria-hidden="true"></canvas><button type="button" class="stage" id="calm" aria-pressed="false" aria-label="${esc(L.calm)}" data-calm="${esc(L.calm)}" data-move="${esc(L.move)}">${jmark('big hero')}</button>
<div class="say" aria-live="polite"><p id="say-now">${sayings(p, lg).map((s) => `<span>${esc(s)}</span>`).join(' ')}</p><p id="say-live" class="live"></p><ul id="waiting">${waitingList(p, lg)}</ul></div></section>
<div class="work">
<form id="job" class="bar"><fieldset${blocked ? ' disabled' : ''}>${blocked ? `<p class="err">${esc(L.disabled)}: ${esc(blocked)}</p>` : ''}
<textarea name="text" required maxlength="8000" rows="1" placeholder="${esc(L.prompt)}" aria-label="${esc(L.newJob)}"></textarea>
<div class="row"><select name="type" aria-label="${esc(L.kind)}">${JOB_TYPES.map((t) => `<option value="${t}"${t === 'task' ? ' selected' : ''}>${esc(kindWord(lg, t))}</option>`).join('')}</select><button>${esc(L.send)}</button><span class="err"></span></div></fieldset></form>
<p id="cost">${esc(L.cost)}: ${esc(money(deps.jobs.todayCostUsd()))} (${esc(L.estimate)}) · ${esc(L.cap)} $${deps.config().dailyBudgetUsd.toFixed(2)}</p>
<h2>${esc(L.running)}</h2><ul id="running" class="jobs">${running.length ? running.map((j) => jobLine(j, lg)).join('') : `<li class="muted empty">${esc(L.none)}</li>`}</ul>
<h2>${esc(L.tracker)}</h2><iframe class="trk" src="/p/tracker" title="${esc(L.tracker)}"></iframe>
<h2>${esc(L.pages)}</h2><ul class="pages">${pages}</ul></div></div>`;
    return c.html(shell({ title: 'Joserah', lang: lg, head: CSS, here: '/', state: p.mode, bodyClass: 'is-home', body: body + '<script src="/_/app.js"></script>' }));
  });
  app.get('/jobs', (c) => {
    const L = LABELS[lang()];
    return c.html(shell({ title: L.jobs, lang: lang(), head: CSS, here: '/jobs', body: `<h1>${esc(L.jobs)}</h1><ul class="jobs">${deps.jobs.list().slice(0, 100).map((j) => jobLine(j, lang())).join('')}</ul><script src="/_/app.js"></script>` }));
  });
  app.get('/jobs/:id', (c) => {
    const lg = lang(); const L = LABELS[lg]; const j = deps.jobs.get(c.req.param('id'));
    if (!j) return c.notFound();
    const lines = streamLines(deps.jobs.logTail(j.id, 400)).map((l) => `<li class="${l.kind}">${esc(l.kind === 'tool' ? `· ${l.text}` : l.text)}</li>`).join('');
    const btn = (act: string, label: string) => `<button data-act="${act}" data-id="${esc(j.id)}">${esc(label)}</button>`;
    const acts = [
      ...(j.state === 'running' || j.state === 'queued' ? [btn('cancel', L.cancel)] : []),
      ...(j.state === 'needs-approval' ? [btn('approve', L.approve)] : []),
      ...(['failed', 'interrupted', 'cancelled', 'refused'].includes(j.state) ? [btn('retry', L.retry)] : []),
    ].join(' ');
    const body = `<h1>${esc(j.rowTitle)}</h1>
<p class="meta" data-job="${esc(j.id)}" data-state="${esc(j.state)}"><span class="state">${esc(stateWord(lg, j.state))}</span><span>${esc(kindWord(lg, j.type))}</span><span>${esc(j.model)}</span><span>${esc(money(j.costUsd))} (${esc(L.estimate)})</span>${j.error ? `<span class="err">${esc(errorText(lg, j.error))}</span>` : ''}</p>
<p class="ask">${esc(j.text)}</p><div class="row">${acts}</div>
${j.resultText ? `<h2>${esc(L.result)}</h2><p>${esc(j.resultText)}</p>` : ''}
${j.changed?.length ? `<h2>${esc(L.changed)}</h2><ul>${j.changed.map((f) => `<li>${esc(f.status)} ${esc(f.path)}</li>`).join('')}</ul>` : ''}
${j.flags?.length ? `<ul class="err">${j.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
${j.type === 'query' && j.state === 'done' && j.resultText ? `<p><input id="file-title" value="${esc(j.text.slice(0, 120))}" aria-label="${esc(L.fileTitle)}"> ${btn('file', L.fileIt)}</p>` : ''}
<ol class="stream" data-job="${esc(j.id)}">${lines}</ol>
${['done', 'failed', 'needs-approval', 'interrupted'].includes(j.state) ? `<p><textarea id="reply-text" maxlength="8000" aria-label="${esc(L.reply)}"></textarea></p><p>${btn('reply', L.reply)}</p>` : ''}
<script src="/_/app.js"></script>`;
    return c.html(shell({ title: j.rowTitle, lang: lang(), head: CSS, here: '/jobs', body }));
  });
}
