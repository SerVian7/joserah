#!/usr/bin/env node
/**
 * tracker.js — keeps a small status page (a "Tracker") from a rows.json file.
 *
 *   node tools/tracker.js init <dir> --title "<text>" [--date DD.MM.YYYY]
 *                         [--lang en|tr] [--logo <png|svg file>] [--force]
 *       Writes <dir>/index.html from templates/tracker/index.html (one small
 *       header line "<title> · <date>", date defaults to today) and
 *       <dir>/rows.json as [] if absent. Refuses, exit 1, if index.html exists
 *       unless --force. --logo embeds the file as a data: URI image; without
 *       it the page has no logo and no wordmark.
 *
 *   node tools/tracker.js <dir>
 *       Renders. rows.json is the FULL inventory: an array of
 *       {match?, state, title, small?, url?, label?, time?}, state one of
 *       run (a background agent is working on it right now) | you (the owner's
 *       decision or action) | wait (waiting on someone outside, no AI working) |
 *       ok (done) | plan. The <ol> is rebuilt from it, so a row
 *       removed from the file disappears. A row without `time` is stamped once
 *       with the current local HH:MM and that stamp is written back to
 *       rows.json; a row with `time` keeps it. Groups, in this order: agent
 *       working (run), owner (you), waiting (wait), done (ok), plans (plan);
 *       chronological inside a group, ties keep file order, an empty group gets no heading. Only http(s)
 *       urls become links. Only the <ol> and the page's "updated" stamp
 *       (data-t) change; every other byte stays. Prints `rows: N`.
 *       Exit 1 on a missing dir or rows.json, invalid JSON, unknown state, or two
 *       rows with the same title (case and outer spaces ignored): one job, one row.
 *
 * Labels follow <html lang> (en, tr). Tests may fix the clock with
 * JOSERAH_NOW=<ISO timestamp>. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LABELS = {
  en: { run: 'Agent working', you: 'Owner', wait: 'Waiting', plan: 'Plan', ok: 'Done', groups: ['Agent working', 'Owner', 'Waiting', 'Done', 'Plans'], link: 'page', upd: 'updated' },
  tr: { run: 'Ajan çalışıyor', you: 'Sizde', wait: 'Beklemede', plan: 'Plan', ok: 'Bitti', groups: ['Ajan çalışıyor', 'Sizde', 'Beklemede', 'Bitenler', 'Planlar'], link: 'sayfa', upd: 'güncelleme' },
};
const GROUP = { run: 0, you: 1, wait: 2, ok: 3, plan: 4 };

const die = (msg) => { console.error(`tracker: ${msg}`); process.exit(1); };
const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opt.force = true;
    else if (/^--(title|date|lang|logo)$/.test(a)) opt[a.slice(2)] = argv[++i];
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
    const mime = { '.png': 'image/png', '.svg': 'image/svg+xml' }[ext];
    if (!mime) die('--logo must be a .png or .svg file');
    let buf;
    try { buf = fs.readFileSync(opt.logo); } catch (e) { die(`cannot read logo ${opt.logo}`); }
    logo = `<img alt="" src="data:${mime};base64,${buf.toString('base64')}">`;
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

function render(dir) {
  const pagePath = path.join(dir, 'index.html');
  const rowsPath = path.join(dir, 'rows.json');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`${dir} is not a directory`);
  if (!fs.existsSync(pagePath)) die(`${pagePath} not found (run init first)`);
  if (!fs.existsSync(rowsPath)) die(`${rowsPath} not found`);
  let rows;
  try { rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8')); } catch (e) { die(`rows.json is not valid JSON: ${e.message}`); }
  if (!Array.isArray(rows)) die('rows.json must be an array');
  let html = fs.readFileSync(pagePath, 'utf8');
  const L = LABELS[(html.match(/<html[^>]*\blang="(\w+)"/) || [])[1]] || LABELS.en;
  const clock = now();
  let stamped = false;
  rows.forEach((r, i) => {
    if (!r || !Object.prototype.hasOwnProperty.call(GROUP, r.state)) die(`row ${i + 1}: unknown state "${r && r.state}"`);
    if (r.time === undefined || r.time === null || r.time === '') { r.time = hm(clock); stamped = true; }
  });
  const seen = new Set();
  rows.forEach((r, i) => {
    const k = String(r.title ?? '').trim().toLowerCase();
    if (k && seen.has(k)) die(`row ${i + 1}: duplicate title "${r.title}" (one job, one row: change the existing row)`);
    seen.add(k);
  });
  const sorted = rows.map((r, i) => ({ r, i, g: GROUP[r.state] }))
    .sort((a, b) => a.g - b.g || String(a.r.time).localeCompare(String(b.r.time)) || a.i - b.i);
  const out = [];
  sorted.forEach(({ r, g }, k) => {
    if (k === 0 || g !== sorted[k - 1].g) out.push(`<li class="hd">${L.groups[g]}</li>`);
    const link = /^https?:\/\//i.test(String(r.url || ''))
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label || L.link)}</a>` : '';
    const small = [r.small ? esc(r.small) : '', link].filter(Boolean).join(' · ');
    out.push(`<li><span class="s ${r.state}">${L[r.state]}</span><div><b>${esc(r.title)}</b>${small ? `<small>${small}</small>` : ''}</div><time>${esc(r.time)}</time></li>`);
  });
  const ol = `<ol>\n${out.map((x) => '  ' + x + '\n').join('')}</ol>`;
  if (!/<ol>[\s\S]*?<\/ol>/.test(html) || !/data-t="[^"]*"/.test(html)) die('index.html is not a tracker page');
  html = html.replace(/<ol>[\s\S]*?<\/ol>/, () => ol).replace(/data-t="[^"]*"/, () => `data-t="${clock.toISOString()}"`);
  fs.writeFileSync(pagePath, html);
  if (stamped) fs.writeFileSync(rowsPath, JSON.stringify(rows, null, 1) + '\n');
  console.log(`rows: ${rows.length}`);
}

const { pos, opt } = parseArgs(process.argv.slice(2));
if (pos[0] === 'init') init(pos[1], opt);
else if (pos.length === 1) render(pos[0]);
else die('usage: tracker.js init <dir> --title "<text>" [...]  |  tracker.js <dir>');
