#!/usr/bin/env node
/**
 * tracker.js — keeps a small status page (a "Tracker") from a rows.json file.
 *
 *   node tools/tracker.js init <dir> --title "<text>" [--date DD.MM.YYYY]
 *                         [--lang en|tr] [--logo <png|svg file>] [--force]
 *       Writes <dir>/index.html from templates/tracker/index.html (one small
 *       header line "<title> · <date>", date defaults to today) and
 *       <dir>/rows.json as [] if absent. Refuses, exit 1, if index.html exists
 *       unless --force. --logo copies the file next to index.html as logo.png|svg
 *       and references it by relative path (the page stays small; publish the
 *       file with it); without it the page has no logo and no wordmark.
 *
 *   node tools/tracker.js row <dir> --title "<text>" --state run|you|wait|ok|plan
 *                         [--small "<text>"] [--url <http(s)>] [--label "<text>"]
 *       [--group "<text>"]: a plan row's heading in the plans list; the Plans fold
 *       then holds one closed fold per group.
 *       Upserts ONE row by title (case and outer spaces ignored) into rows.json
 *       and re-renders; nothing has to be read first. A changed row loses its
 *       `time` and is re-stamped now; small/url/label not given are cleared.
 *       [--parent "<title>"]: the row's main job (a row title, case and outer
 *       spaces ignored); its finished sub-jobs fold under it. One level only: a
 *       row with a parent cannot be a parent, nor its own. A row re-run without
 *       --parent keeps the one it had; --parent "" ungroups it. A refused row is
 *       not written.
 *
 *   node tools/tracker.js crew <dir> --role voice|lead|architect|builder|scout|sentry
 *                         --job "<text>" --state work|owner|idle
 *                         [--reason decision|sign-in|connection|approval] [--url <http(s)>]
 *       Upserts ONE entry of the Crew strip by role + job (case and outer spaces
 *       ignored), stamps its `time` now, re-renders. reason/url not given are
 *       cleared. rows.json then becomes { rows: [...], crew: [...] }; a legacy
 *       array is read as { rows, crew: [] } and kept an array until a crew entry
 *       exists. The strip shows only in developer mode.
 *
 *   node tools/tracker.js <dir>
 *       Renders. rows.json is the FULL inventory: an array of
 *       {match?, state, title, small?, url?, label?, group?, parent?, time?}, state one of
 *       run (a background agent is working on it right now) | you (the owner's
 *       decision or action) | wait (waiting on someone outside, no AI working) |
 *       ok (done) | plan. The <ol> is rebuilt from it, so a row
 *       removed from the file disappears. A row without `time` is stamped once
 *       with the current local HH:MM and that stamp is written back to
 *       rows.json; a row with `time` keeps it. Groups, in this order: agent
 *       working (run), owner (you), done (ok) in the list; waiting (wait) and plans (plan) as closed groups above it;
 *       chronological inside a group (done: newest first), ties keep file order, an empty group gets no heading. Only http(s)
 *       urls become links. Rows with a `parent` fold under their main job in the
 *       finished sections (done, and inside the waiting and plans folds); an
 *       active (run, you) sub-job never folds and shows its main job as a label.
 *       Every fold is closed; top-level folds share name="trk" (one open at a
 *       time), nested ones trk-2, trk-3. Only the <ol> and the page's "updated" stamp
 *       (data-t) change; every other byte stays. Prints `rows: N`.
 *       Exit 1 on a missing dir or rows.json, invalid JSON, unknown state, or two
 *       rows with the same title (case and outer spaces ignored): one job, one row.
 *
 * Developer mode (`devMode: true` in the workspace's .joserah/config.json, found
 * by walking up from <dir>) shows the crew: the run state reads "Agent working".
 * Off (the default, and outside any workspace) it reads "In progress" and the
 * page carries no agent wording.
 *
 * Labels follow <html lang> (en, tr). Tests may fix the clock with
 * JOSERAH_NOW=<ISO timestamp>. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LABELS = {
  en: { reasons: { decision: 'decision', 'sign-in': 'sign-in', connection: 'connection', approval: 'approval' }, run: 'Agent working', runPlain: 'In progress', you: 'Owner', wait: 'Waiting', plan: 'Plan', ok: 'Done', groups: ['Agent working', 'Owner', 'Waiting', 'Done', 'Plans'], link: 'page', other: 'Other', upd: 'updated' },
  tr: { reasons: { decision: 'karar', 'sign-in': 'oturum açma', connection: 'bağlantı', approval: 'onay' }, run: 'Ajan çalışıyor', runPlain: 'Sürüyor', you: 'Sizde', wait: 'Beklemede', plan: 'Plan', ok: 'Bitti', groups: ['Ajan çalışıyor', 'Sizde', 'Beklemede', 'Bitenler', 'Planlar'], link: 'sayfa', other: 'Diğer', upd: 'güncelleme' },
};
const GROUP = { run: 0, you: 1, wait: 2, ok: 3, plan: 4 };
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');

const CREW_ROLES = ['voice', 'lead', 'architect', 'builder', 'scout', 'sentry'];
const CREW_STATES = ['work', 'owner', 'idle'];
const CREW_REASONS = ['decision', 'sign-in', 'connection', 'approval'];
const { ICONS } = require('./lib/crew-icons');
const ROLE_NAME = { voice: 'Voice', lead: 'Lead', architect: 'Architect', builder: 'Builder', scout: 'Scout', sentry: 'Sentry' };
// The strip's look, theme tokens only (owner, 2026-10-05: calm, no new hues): icons in the muted text
// token; working pulses slowly; owner takes the page's owner colour; idle is dimmed; reduced motion,
// no pulse. The template carries the same line; a page made before the strip gets it once.
const CREW_CSS = '.crew{padding:8px 0 6px;border-bottom:1px solid var(--line)}'
  + '.crew-sum{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:2px 0 6px}'
  + '.crew-sum span{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted)}'
  + '.crew svg{width:18px;height:18px;flex:none;color:var(--muted)}'
  + '.crew ul{list-style:none;margin:0;padding:0}'
  + '.crew li.crew-line{display:flex;align-items:center;gap:8px;padding:3px 0;margin:0;background:none;border:0;border-radius:0;font-size:13px}'
  + '.crew-line span{flex:1;min-width:0;overflow-wrap:anywhere}.crew-line a{color:inherit}'
  + '.crew-line em{font-style:normal;color:var(--you)}'
  + '.crew-line.work svg,.crew-sum .work svg{animation:crew-pulse 2.4s ease-in-out infinite}'
  + '.crew-line.owner svg{color:var(--you)}.crew-sum .owner svg{color:var(--you)}'
  + '.crew-line.idle,.crew-sum .idle{opacity:.5}'
  + '@keyframes crew-pulse{50%{opacity:.4}}'
  + '@media (prefers-reduced-motion: reduce){.crew-line.work svg,.crew-sum .work svg{animation:none}}';

// Developer mode decides only whether the owner sees the crew; no workspace → off.
function devModeFor(dir) {
  const root = findWorkspace(dir);
  const cfg = root && readConfig(root);
  return !!(cfg && cfg.devMode === true);
}

const die = (msg) => { console.error(`tracker: ${msg}`); process.exit(1); };
const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const key = (t) => String(t ?? '').trim().toLowerCase();
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opt.force = true;
    else if (/^--(title|date|lang|logo|state|small|url|label|group|role|job|reason|parent)$/.test(a)) opt[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) die(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, opt };
}

function init(dir, opt) {
  if (!dir) die('usage: tracker.js init <dir> --title "<text>" [--date DD.MM.YYYY] [--lang en|tr] [--logo file] [--force]');
  if (!opt.title) die('--title is required');
  const lang = opt.lang || 'en';
  if (!LABELS[lang]) die(`unknown language ${lang} (en or tr)`);
  const out = path.join(dir, 'index.html');
  if (fs.existsSync(out) && !opt.force) die(`${out} already exists (use --force to overwrite)`);
  const d = now();
  const date = opt.date || `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  let logo = '';
  if (opt.logo) {
    const ext = path.extname(opt.logo).toLowerCase();
    if (!['.png', '.svg'].includes(ext)) die('--logo must be a .png or .svg file');
    let buf;
    try { buf = fs.readFileSync(opt.logo); } catch (e) { die(`cannot read logo ${opt.logo}`); }
    const name = `logo${ext}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    logo = `<img alt="" src="${name}">`;
  }
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'tracker', 'index.html'), 'utf8');
  const line = `${opt.title} · ${date}`;
  const html = tpl
    .replace('<html lang="en">', () => `<html lang="${lang}">`)
    .replace('<title>Tracker</title>', () => `<title>${esc(line)}</title>`)
    .replace('<!--tracker:logo-->', () => logo)
    .replace('<!--tracker:line-->', () => esc(line));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, html);
  const rows = path.join(dir, 'rows.json');
  if (!fs.existsSync(rows)) fs.writeFileSync(rows, '[]\n');
  console.log(`tracker: wrote ${out}`);
}

// rows.json is either the legacy array of rows or { rows: [...], crew: [...] }.
function readStore(rowsPath) {
  let j;
  try { j = JSON.parse(fs.readFileSync(rowsPath, 'utf8')); } catch (e) { die(`rows.json is not valid JSON: ${e.message}`); }
  if (Array.isArray(j)) return { rows: j, crew: [] };
  if (!j || typeof j !== 'object' || !Array.isArray(j.rows) || (j.crew !== undefined && !Array.isArray(j.crew))) {
    die('rows.json must be an array, or an object with a "rows" array and a "crew" array');
  }
  return { rows: j.rows, crew: j.crew || [] };
}

// the legacy array shape is kept until a crew entry exists
function writeStore(rowsPath, store) {
  const data = store.crew.length ? { rows: store.rows, crew: store.crew } : store.rows;
  fs.writeFileSync(rowsPath, JSON.stringify(data, null, 1) + '\n');
}

function checkCrew(e, where) {
  if (!e || !CREW_ROLES.includes(e.role)) die(`${where}: unknown role "${e && e.role}" (${CREW_ROLES.join('|')})`);
  if (!CREW_STATES.includes(e.state)) die(`${where}: unknown state "${e.state}" (${CREW_STATES.join('|')})`);
  if (e.reason !== undefined && !CREW_REASONS.includes(e.reason)) die(`${where}: unknown reason "${e.reason}" (${CREW_REASONS.join('|')})`);
  if (!String(e.job ?? '').trim()) die(`${where}: a job is required`);
}

const GROUP_CSS = 'li.grp{display:block;padding:0;background:none;border:0}'
  + '.grp details{padding:4px 0}.grp summary{cursor:pointer;font-size:13px;color:var(--muted)}'
  + '.grp summary b{display:inline;color:var(--ink)}.grp ul{list-style:none;margin:4px 0 0 12px;padding:0}'
  + '.par{display:block;font-size:12px;color:var(--faint);overflow-wrap:anywhere}';

// A row's `parent` names its main job's row: it must exist, must not be the row itself, and must not
// have a parent of its own (one level only).
const hasParent = (r) => !!(r && key(r.parent));
function checkParents(rows) {
  rows.forEach((r, i) => {
    if (!hasParent(r)) return;
    if (key(r.parent) === key(r.title)) die(`row ${i + 1}: "${r.title}" cannot be its own parent`);
    const main = rows.find((x) => x && key(x.title) === key(r.parent));
    if (!main) die(`row ${i + 1}: parent "${r.parent}" is not a row`);
    if (hasParent(main)) die(`row ${i + 1}: one level only (parent "${r.parent}" has a parent itself)`);
  });
}

// summary: Voice first, then one icon per role with an entry, a count when 2+ of it are working or
// waiting on the owner; then one line per entry: icon, "<Role> · <job>", the reason when owner.
function crewStrip(crew, L) {
  const live = (e) => e.state === 'work' || e.state === 'owner';
  const sum = CREW_ROLES.filter((r) => r === 'voice' || crew.some((e) => e.role === r)).map((r) => {
    const mine = crew.filter((e) => e.role === r);
    const n = mine.filter(live).length;
    const st = mine.some((e) => e.state === 'owner') ? 'owner' : mine.some((e) => e.state === 'work') ? 'work' : mine.length ? 'idle' : '';
    return `<span${st ? ` class="${st}"` : ''} data-role="${r}"${n >= 2 ? ` data-count="${n}"` : ''} title="${ROLE_NAME[r]}">${ICONS[r]}${n >= 2 ? n : ''}</span>`;
  }).join('');
  const lines = crew.map((e) => {
    const text = `${ROLE_NAME[e.role]} · ${esc(e.job)}`;
    const body = /^https?:\/\//i.test(String(e.url || '')) ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${text}</a>` : text;
    const why = e.state === 'owner' && e.reason ? ` <em>${esc((L.reasons || {})[e.reason] || e.reason)}</em>` : '';
    return `  <li class="crew-line ${e.state}" data-role="${e.role}">${ICONS[e.role]}<span>${body}${why}</span><time>${esc(e.time)}</time></li>\n`;
  }).join('');
  return `<div class="crew-sum">${sum}</div><ul>\n${lines}</ul>`;
}

function render(dir) {
  const pagePath = path.join(dir, 'index.html');
  const rowsPath = path.join(dir, 'rows.json');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`${dir} is not a directory`);
  if (!fs.existsSync(pagePath)) die(`${pagePath} not found (run init first)`);
  if (!fs.existsSync(rowsPath)) die(`${rowsPath} not found`);
  const store = readStore(rowsPath);
  const { rows, crew } = store;
  let html = fs.readFileSync(pagePath, 'utf8');
  const base = LABELS[(html.match(/<html[^>]*\blang="(\w+)"/) || [])[1]] || LABELS.en;
  const dev = devModeFor(dir);
  const L = dev ? base : { ...base, run: base.runPlain, groups: [base.runPlain, ...base.groups.slice(1)] };
  const clock = now();
  let stamped = false;
  rows.forEach((r, i) => {
    if (!r || !Object.prototype.hasOwnProperty.call(GROUP, r.state)) die(`row ${i + 1}: unknown state "${r && r.state}"`);
    if (r.time === undefined || r.time === null || r.time === '') { r.time = hm(clock); stamped = true; }
  });
  crew.forEach((e, i) => {
    checkCrew(e, `crew ${i + 1}`);
    if (e.time === undefined || e.time === null || e.time === '') { e.time = hm(clock); stamped = true; }
  });
  const seen = new Set();
  rows.forEach((r, i) => {
    const k = String(r.title ?? '').trim().toLowerCase();
    if (k && seen.has(k)) die(`row ${i + 1}: duplicate title "${r.title}" (one job, one row: change the existing row)`);
    seen.add(k);
  });
  checkParents(rows);
  const sorted = rows.map((r, i) => ({ r, i, g: GROUP[r.state] }))
    .sort((a, b) => a.g - b.g || (a.g === GROUP.ok ? -1 : 1) * String(a.r.time).localeCompare(String(b.r.time)) || a.i - b.i);
  // a row's main job (its `parent`, resolved to that row)
  const byTitle = new Map(rows.map((r) => [key(r.title), r]));
  const mainOf = (r) => (hasParent(r) ? byTitle.get(key(r.parent)) : null);
  const ACTIVE = [GROUP.run, GROUP.you];
  const li = (r) => {
    const link = /^https?:\/\//i.test(String(r.url || ''))
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label || L.link)}</a>` : '';
    const small = [r.small ? esc(r.small) : '', link].filter(Boolean).join(' · ');
    // active work never folds: a sub-job being worked on, or waiting on the owner, names its main job instead
    const main = ACTIVE.includes(GROUP[r.state]) && mainOf(r);
    const par = main ? `<span class="par">${esc(main.title)}</span>` : '';
    return `<li><span class="s ${r.state}">${L[r.state]}</span><div>${par}<b>${esc(r.title)}</b>${small ? `<small>${small}</small>` : ''}</div><time>${esc(r.time)}</time></li>`;
  };
  // Finished work (done, waiting, plans): the sub-jobs of one main job fold together, closed, headed by the
  // main job's title and the count of its sub-jobs; the main row heads the fold when it is in the same
  // section, otherwise the summary carries its state. The fold sits where its newest sub-job would sort.
  // `depth` names the fold for one-open-at-a-time: a fold nested in a fold takes the next level's name,
  // because opening a same-named descendant would close its own ancestor.
  const fold = (depth) => (depth === 1 ? '<details name="trk">' : `<details class="sub" name="trk-${depth}">`);
  const items = (it, depth) => {
    const groups = new Map();
    for (const x of it) {
      const m = mainOf(x.r);
      if (!m) continue;
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push(x);
    }
    const heads = new Map(it.filter((x) => groups.has(x.r)).map((x) => [x.r, x]));
    const newestFirst = it.length && it[0].g === GROUP.ok;
    const anchor = new Map([...groups].map(([m, subs]) => [newestFirst ? subs[0] : subs[subs.length - 1], m]));
    const inGroup = new Set([...[...groups.values()].flat(), ...heads.values()]);
    const lines = [];
    for (const x of it) {
      if (anchor.has(x)) {
        const m = anchor.get(x); const subs = groups.get(m); const head = heads.get(m);
        const summary = `<b>${esc(m.title)}</b> ${subs.length}${head ? '' : ` · ${L[m.state]}`}`;
        lines.push(`<li class="grp">${fold(depth)}<summary>${summary}</summary>${ul(head ? [head, ...subs] : subs, depth + 1, false)}</details></li>`);
      } else if (!inGroup.has(x)) lines.push(li(x.r));
    }
    return lines;
  };
  const ul = (it, depth, group = true) => `<ul>\n${(group ? items(it, depth) : it.map(({ r }) => li(r))).map((x) => '  ' + x + '\n').join('')}</ul>`;
  // waiting and plans sit above the list as closed groups; the list carries agent working, owner, done
  const FOLDED = [GROUP.wait, GROUP.plan];
  const out = [];
  for (const g of [GROUP.run, GROUP.you, GROUP.ok]) {
    const it = sorted.filter((x) => x.g === g);
    if (!it.length) continue;
    out.push(`<li class="hd">${L.groups[g]}</li>`);
    out.push(...(g === GROUP.ok ? items(it, 1) : it.map(({ r }) => li(r))));
  }
  const ol = `<ol>\n${out.map((x) => '  ' + x + '\n').join('')}</ol>`;
  // plans may carry a `group` (a heading of the plans list): each group is its own closed fold inside
  const body = (it) => {
    const names = [...new Set(it.map(({ r }) => r.group).filter(Boolean))];
    if (!names.length) return ul(it, 2);
    const part = (name) => { const m = it.filter(({ r }) => (r.group || '') === name); return `${fold(2)}<summary>${esc(name || L.other)} ${m.length}</summary>${ul(m, 3)}</details>`; };
    return [...names, ...(it.some(({ r }) => !r.group) ? [''] : [])].map(part).join('');
  };
  const folds = FOLDED.map((g) => sorted.filter((x) => x.g === g)).filter((it) => it.length)
    .map((it) => `${fold(1)}<summary>${L.groups[it[0].g]} ${it.length}</summary>${body(it)}</details>`);
  const section = folds.length ? `<section class="folds">${folds.join('')}</section>\n` : '';
  if (!/<ol>[\s\S]*?<\/ol>/.test(html) || !/data-t="[^"]*"/.test(html)) die('index.html is not a tracker page');
  html = html.replace(/<section class="folds">[\s\S]*?<\/section>\n?/, '');
  html = html.replace(/<ol>[\s\S]*?<\/ol>/, () => section + ol).replace(/data-t="[^"]*"/, () => `data-t="${clock.toISOString()}"`);
  // pages made before the folds keep working: their style gets the rule once
  if (!html.includes('.folds details{')) html = html.replace('</style>', '.folds details{border-bottom:1px solid var(--line);padding:8px 0}.folds summary{cursor:pointer;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}.folds ul{list-style:none;margin:6px 0 0;padding:0}\n</style>');
  if (!html.includes('.folds details.sub{')) html = html.replace('</style>', '.folds details.sub{border-bottom:0;padding:4px 0 4px 12px}.folds details.sub summary{text-transform:none;letter-spacing:0}\n</style>');
  // row groups and main-job labels get their styles the first time a page shows one, so a page
  // without any `parent` stays byte-identical to what it was before row groups existed
  if (/class="(grp|par)"/.test(section + ol) && !html.includes('.grp summary b{')) html = html.replace('</style>', `${GROUP_CSS}\n</style>`);
  // the Crew strip: developer mode only; without it the page carries no strip at all
  html = html.replace(/<section class="crew">[\s\S]*?<\/section>\n?/, '');
  if (dev && crew.length) {
    if (!html.includes('.crew{')) html = html.replace('</style>', `${CREW_CSS}\n</style>`);
    const strip = `<section class="crew">${crewStrip(crew, L)}</section>\n`;
    if (html.includes('<!-- crew -->\n')) html = html.replace('<!-- crew -->\n', () => `<!-- crew -->\n${strip}`);
    else html = html.replace(/<main>\n?/, (m) => `${m}${strip}`);
  }
  fs.writeFileSync(pagePath, html);
  if (stamped) writeStore(rowsPath, store);
  console.log(`rows: ${rows.length}`);
}

function upsert(dir, opt) {
  if (!dir || !opt.title || !opt.state) die('usage: tracker.js row <dir> --title "<text>" --state run|you|wait|ok|plan [--small t] [--url u] [--label t] [--group t]');
  if (!Object.prototype.hasOwnProperty.call(GROUP, opt.state)) die(`unknown state "${opt.state}"`);
  const rowsPath = path.join(dir, 'rows.json');
  if (!fs.existsSync(rowsPath)) die(`${rowsPath} not found (run init first)`);
  const store = readStore(rowsPath);
  const { rows } = store;
  const row = { state: opt.state, title: opt.title };
  if (opt.small) row.small = opt.small;
  if (opt.url) row.url = opt.url;
  if (opt.label) row.label = opt.label;
  if (opt.group) row.group = opt.group;
  const i = rows.findIndex((r) => r && key(r.title) === key(opt.title));
  // the parent stays unless given: re-running a sub-job's row must not ungroup it
  const parent = opt.parent !== undefined ? opt.parent : (i >= 0 ? rows[i].parent : undefined);
  if (parent) row.parent = parent;
  if (i >= 0) rows[i] = row; else rows.push(row);
  checkParents(rows); // before writing: a refused row leaves rows.json alone
  writeStore(rowsPath, store);
  render(dir);
}

function upsertCrew(dir, opt) {
  if (!dir || !opt.role || !opt.job || !opt.state) die(`usage: tracker.js crew <dir> --role ${CREW_ROLES.join('|')} --job "<text>" --state ${CREW_STATES.join('|')} [--reason ${CREW_REASONS.join('|')}] [--url u]`);
  const entry = { role: opt.role, job: opt.job, state: opt.state };
  if (opt.reason) entry.reason = opt.reason;
  if (opt.url) entry.url = opt.url;
  checkCrew(entry, 'crew');
  entry.time = hm(now());
  const rowsPath = path.join(dir, 'rows.json');
  if (!fs.existsSync(rowsPath)) die(`${rowsPath} not found (run init first)`);
  const store = readStore(rowsPath);
  const i = store.crew.findIndex((e) => e && e.role === entry.role && key(e.job) === key(entry.job));
  if (i >= 0) store.crew[i] = entry; else store.crew.push(entry);
  writeStore(rowsPath, store);
  render(dir);
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos[0] === 'init') init(pos[1], opt);
  else if (pos[0] === 'row') upsert(pos[1], opt);
  else if (pos[0] === 'crew') upsertCrew(pos[1], opt);
  else if (pos.length === 1) render(pos[0]);
  else die('usage: tracker.js init <dir> --title "<text>" [...]  |  tracker.js row <dir> --title t --state s  |  tracker.js crew <dir> --role r --job t --state s  |  tracker.js <dir>');
}

if (require.main === module) main();
module.exports = { devModeFor, LABELS, CREW_CSS };
