/* Tracker page: reads the job files (../jobs/*.json via ../jobs/index.json) and _agents.json, fills the DOM.
   Layout lives in style.css, markup in index.html; this file only decides what goes where. */
(function () {
  'use strict';
  const STR = {
    tr: { other: 'Diğer', done: 'Biten', open: 'açık', state: { run: 'sürüyor', you: 'sizde', wait: 'bekliyor', plan: 'plan', done: 'bitti' }, nobody: 'üstünde kimse yok', none: 'Açık iş yok.', archiveNone: 'Arşiv boş.', bad: 'okunamayan iş', rec: 'önerilen', started: 'başladı', finished: 'bitti', ctx: 'bağlam', working: 'çalışıyor' },
    en: { other: 'Other', done: 'Done', open: 'open', state: { run: 'running', you: 'on you', wait: 'waiting', plan: 'plan', done: 'done' }, nobody: 'nobody on it', none: 'No open jobs.', archiveNone: 'The archive is empty.', bad: 'unreadable job', rec: 'recommended', started: 'started', finished: 'finished', ctx: 'context', working: 'working' },
  };
  const STATES = ['you', 'run', 'wait', 'plan', 'done'];
  const dayOf = (iso) => String(iso || '').slice(0, 10);
  const hm = (iso) => String(iso || '').slice(11, 16);
  const dm = (iso) => `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}`;
  const dmy = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

  /** A child line never repeats its band's name: a leading "<project>" / "<project>:" / "<project> -" goes. */
  function stripParent(title, project) {
    const t = String(title || '').trim(); const p = String(project || '').trim();
    if (!p || !t.toLowerCase().startsWith(p.toLowerCase())) return t;
    const rest = t.slice(p.length);
    if (/^[\p{L}\p{N}]/u.test(rest)) return t; // a longer word, not the name
    return rest.replace(/^[\s:\-\u2013\u2014.]+/, '') || t;
  }

  const valid = (j) => j && typeof j === 'object' && typeof j.title === 'string' && j.title.trim() && STATES.includes(j.state);
  const startOf = (j) => j.started || j.finished || '';

  /** files: {name: text}; returns what the page shows. */
  function build(files, today, lang) {
    const S = STR[lang] || STR.en;
    const jobs = []; const bad = []; let agents = {};
    for (const [name, text] of Object.entries(files)) {
      let j; try { j = JSON.parse(text); } catch { j = null; }
      if (name === '_agents.json') { if (j && typeof j === 'object') agents = j; continue; }
      if (name.startsWith('_')) continue;
      const slug = name.replace(/\.json$/, '');
      if (valid(j)) jobs.push({ slug, ...j, project: String(j.project || '').trim() }); else bad.push(slug);
    }
    const working = Object.entries(agents).filter(([, a]) => a && a.state === 'work').map(([id, a]) => ({ id, ...a }));
    const bands = new Map();
    for (const j of jobs) {
      j.agents = working.filter((a) => a.job === j.slug);
      const key = j.project || S.other;
      if (!bands.has(key)) bands.set(key, { project: key, active: [], done: [] });
      const b = bands.get(key);
      if (j.state !== 'done') b.active.push(j); else if (dayOf(j.finished) === today) b.done.push(j);
    }
    const byTime = (f) => (a, b) => (f(b) > f(a) ? 1 : f(b) < f(a) ? -1 : 0);
    const list = [...bands.values()].filter((b) => b.active.length || b.done.length);
    for (const b of list) {
      b.active.sort((x, y) => STATES.indexOf(x.state) - STATES.indexOf(y.state) || byTime(startOf)(x, y));
      b.done.sort(byTime((j) => j.finished || ''));
      const roles = {};
      for (const j of b.active) for (const a of j.agents) (roles[a.role] = roles[a.role] || []).push(j.title);
      b.icons = Object.entries(roles).map(([role, titles]) => ({ role, count: titles.length, titles }));
      b.rank = b.active.length ? Math.min(...b.active.map((j) => STATES.indexOf(j.state))) : 9;
    }
    list.sort((a, b) => a.rank - b.rank || a.project.localeCompare(b.project));
    const days = {};
    for (const j of jobs) if (j.state === 'done' && dayOf(j.finished) < today) (days[dayOf(j.finished)] = days[dayOf(j.finished)] || []).push(j);
    const archive = Object.keys(days).sort().reverse().map((day) => ({ day, jobs: days[day].sort(byTime((j) => j.finished || '')) }));
    return { bands: list, archive, bad };
  }

  // ---- DOM ------------------------------------------------------------------------------------
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
    for (const c of kids) if (c != null) e.append(c);
    return e;
  }
  const safeUrl = (u) => (/^(https?:\/\/|\.{0,2}\/)/.test(u || '') ? u : null);
  const icon = (role, count, tip) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', `#r-${role}`); s.append(u);
    return el('span', { class: 'ico', 'data-role': role, 'data-tip': tip, tabindex: '0' }, s, count > 1 ? el('b', {}, String(count)) : null);
  };
  const agentTip = (a, S) => [a.role, a.model, a.effort, a.ctx ? `${S.ctx} ${Math.round(a.ctx / 1000)}k` : null].filter(Boolean).join(' · ');

  function row(j, ctx, note) {
    const S = ctx.S;
    const body = el('div', { class: 'body' });
    if (j.note) body.append(el('p', {}, j.note));
    if (Array.isArray(j.options) && j.options.length) {
      body.append(el('ul', { class: 'opts' }, ...j.options.map((o) => el('li', { 'data-rec': o.key === j.recommend }, `${o.key}: ${o.label || ''}${o.text ? ' — ' + o.text : ''}`))));
      if (j.why) body.append(el('p', { class: 'why' }, `${S.rec}: ${j.recommend} — ${j.why}`));
    }
    const url = safeUrl(j.url);
    if (url) body.append(el('a', { class: 'go', href: url, target: '_blank', rel: 'noopener' }, j.label || url));
    body.append(el('div', { class: 'meta' }, [j.started && `${S.started} ${dm(j.started) === dm(ctx.today) ? '' : dm(j.started) + ' '}${hm(j.started)}`, j.finished && `${S.finished} ${dm(j.finished)} ${hm(j.finished)}`].filter(Boolean).join(' · ')));
    const first = j.state === 'done' ? null : j.agents.length ? j.agents.map((a) => icon(a.role, 1, agentTip(a, S))) : (j.state === 'run' && !j.unattended ? [el('span', { class: 'nobody' }, S.nobody)] : []);
    const when = j.state === 'done' ? j.finished : j.started;
    const t = dayOf(when) === ctx.today ? hm(when) : when ? dm(when) : '';
    const shown = ctx.archive ? [j.project, note].filter(Boolean).join(' — ') : note;
    return el('details', { class: 'job', 'data-k': `j:${j.slug}`, 'data-s': j.state },
      el('summary', {}, el('span', { class: 'dot', 'data-s': j.state, title: S.state[j.state] }),
        el('span', { class: 'tt' }, el('b', {}, ctx.archive ? j.title : stripParent(j.title, j.project)), el('i', {}, shown || '')),
        el('span', { class: 'ag' }, ...(first || [])), el('span', { class: 'tm' }, t)),
      body);
  }
  const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s/)[0];

  function render(root, m, ctx) {
    const S = ctx.S;
    root.replaceChildren();
    for (const slug of m.bad) root.append(el('div', { class: 'bad' }, `${S.bad}: ${slug}.json`));
    if (ctx.archive) {
      if (!m.archive.length) root.append(el('p', { class: 'empty' }, S.archiveNone));
      for (const d of m.archive) root.append(el('details', { class: 'fold', name: 'archive', 'data-k': `d:${d.day}` }, el('summary', {}, `${dmy(d.day)} · ${d.jobs.length}`), el('div', { class: 'kids' }, ...d.jobs.map((j) => row(j, ctx, firstSentence(j.note))))));
      return;
    }
    if (!m.bands.length) root.append(el('p', { class: 'empty' }, S.none));
    for (const b of m.bands) {
      const open = b.active.length;
      const head = el('header', {}, el('h2', {}, b.project),
        ...b.icons.map((i) => icon(i.role, i.count, `${i.role} × ${i.count}\n${i.titles.join('\n')}`)),
        el('span', { class: 'n' }, open ? `${open} ${S.open}` : ''));
      const kids = el('div', { class: 'kids' }, ...b.active.map((j) => row(j, ctx, firstSentence(j.note))));
      if (b.done.length) {
        kids.append(el('details', { class: 'fold', name: 'done', 'data-k': `f:${b.project}` }, el('summary', {}, `${S.done} · ${b.done.length}`),
          el('div', { class: 'kids' }, ...b.done.map((j) => row(j, ctx, firstSentence(j.note))))));
      }
      root.append(el('section', { class: 'band' }, head, kids));
    }
  }

  function init() {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'tr';
    const BASE = new URL('../jobs/', location.href).href;
    const root = document.getElementById('list');
    const cache = {}; const openKeys = new Set(); let last = '';
    root.addEventListener('toggle', (e) => { const k = e.target.dataset && e.target.dataset.k; if (k) (e.target.open ? openKeys.add(k) : openKeys.delete(k)); }, true);
    const today = () => new Date().toLocaleDateString('sv-SE');
    async function poll() {
      try {
        const idx = await (await fetch(BASE + 'index.json', { cache: 'no-store' })).json();
        for (const n of Object.keys(cache)) if (!idx.some((f) => f.n === n)) delete cache[n];
        for (const f of idx) if (!cache[f.n] || cache[f.n].t !== f.t) cache[f.n] = { t: f.t, text: await (await fetch(`${BASE}${encodeURIComponent(f.n)}?t=${f.t}`, { cache: 'no-store' })).text() };
        const archive = location.hash === '#archive';
        const sig = JSON.stringify([idx, today(), archive]);
        if (sig === last) return;
        last = sig;
        const files = {}; for (const [n, c] of Object.entries(cache)) files[n] = c.text;
        render(root, build(files, today(), lang), { S: STR[lang], today: today(), archive });
        for (const d of root.querySelectorAll('details[data-k]')) if (openKeys.has(d.dataset.k)) d.open = true;
        document.getElementById('today').textContent = dmy(today());
        document.getElementById('nav-now').toggleAttribute('aria-current', !archive);
        document.getElementById('nav-arch').toggleAttribute('aria-current', archive);
      } catch (e) { console.error(e); /* server not reachable: keep what is shown */ }
    }
    window.addEventListener('hashchange', () => { last = ''; poll(); });
    poll(); setInterval(poll, 3000);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { stripParent, build, dmy };
  else init();
})();
