#!/usr/bin/env node
/**
 * case.js — builds a Case research page from a cases.json file.
 *
 *   node tools/case.js init <dir> --title "<text>" [--lang en|tr] [--eyebrow "<text>"]
 *                      [--logo <png|svg file>] [--accent #rrggbb] [--force]
 *       Writes <dir>/cases.json (a starter) and renders <dir>/index.html from
 *       templates/case. Refuses, exit 1, if cases.json exists unless --force.
 *       --logo copies the file next to index.html as logo.png|svg; the page
 *       references it by relative path (never embedded).
 *
 *   node tools/case.js render <dir>
 *       Rebuilds <dir>/index.html from <dir>/cases.json. Prints `groups: N cases: M`.
 *
 * cases.json: {
 *   title, lang: "en"|"tr", eyebrow?, labels?: {...overrides},
 *   brand?: { logo?: "logo.png", accent?: "#rrggbb" },
 *   job?: "text"            only while a job runs; remove it when done
 *   update?: { date?, items: [{state: ok|wait|no, text, date?}], links: [{label, url}] }
 *            always open; short summary, latest first, one line per item
 *   groups: [ { name, note?, cases: [ { title, sub?, status: ok|wait|no, why?, picked?,
 *            rec?, price?, priceNote?, pro?: [], con?: [], image?: "file.jpg",
 *            specs?: [[k, v]], links?: [{label, url}] } ] } ]   newest group FIRST
 * }
 * The first group is open on load, the others closed; a closed group renders no
 * note, chips or card. Images sit next to index.html and are referenced by
 * relative path. Only http(s) links are kept. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LABELS = {
  en: { ok: 'Fits', wait: 'Open', no: 'Does not fit', picked: 'SELECTED', rec: 'Recommendation', details: 'Details', prev: 'Previous', next: 'Next', update: 'Update', link: 'link' },
  tr: { ok: 'Uygun', wait: 'Açık', no: 'Uymuyor', picked: 'SEÇİLDİ', rec: 'Öneri', details: 'Ayrıntı', prev: 'Önceki', next: 'Sonraki', update: 'Güncelleme', link: 'bağlantı' },
};

const die = (msg) => { console.error(`case: ${msg}`); process.exit(1); };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TPL = path.join(__dirname, '..', 'templates', 'case');
// The Theme (tools/lib/theme.js): the brand's tokens, light and dark, and the console base, as on every page.
const theme = require('./lib/theme');

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opt.force = true;
    else if (/^--(title|lang|logo|accent|eyebrow)$/.test(a)) opt[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) die(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, opt };
}

function render(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`${dir} is not a directory`);
  const file = path.join(dir, 'cases.json');
  if (!fs.existsSync(file)) die(`${file} not found (run init first)`);
  let D;
  try { D = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`cases.json is not valid JSON: ${e.message}`); }
  if (!D || !Array.isArray(D.groups)) die('cases.json needs a "groups" array');
  const lang = D.lang || 'en';
  if (!LABELS[lang]) die(`unknown language ${lang} (en or tr)`);
  D.groups.forEach((g, i) => {
    if (!g || !g.name || !Array.isArray(g.cases)) die(`group ${i + 1}: needs "name" and a "cases" array`);
    g.cases.forEach((c, j) => {
      if (!c || !c.title) die(`group ${i + 1}, case ${j + 1}: needs a "title"`);
      if (c.status && !/^(ok|wait|no)$/.test(c.status)) die(`case "${c.title}": status must be ok, wait or no`);
    });
  });
  const brand = D.brand || {};
  if (brand.accent && !/^#[0-9a-f]{3,8}$/i.test(brand.accent)) die('brand.accent must be a #hex colour');
  if (brand.logo && /^[a-z]+:|^\/|\.\./i.test(brand.logo)) die('brand.logo must be a relative file name');
  D.labels = { ...LABELS[lang], ...(D.labels || {}) };
  const view = require(path.join(TPL, 'client.js'))(D, D.labels, 0, 0);
  const cli = fs.readFileSync(path.join(TPL, 'client.js'), 'utf8');
  const data = JSON.stringify(D).replace(/</g, "\\u003c").replace(new RegExp("["+String.fromCharCode(0x2028,0x2029)+"]", "g"), (c) => "\\u" + c.charCodeAt(0).toString(16));
  const band = brand.logo ? `<div class="band"><div class="in"><img src="${esc(brand.logo)}" alt=""></div></div>` : '';
  const title = D.title || 'Case research';
  const html = fs.readFileSync(path.join(TPL, 'index.html'), 'utf8')
    .replace('<html lang="en">', () => `<html lang="${lang}">`)
    .replace('<!--case:title-->', () => esc(title))
    .replace('<!--case:theme-->', () => theme.css())
    .replace('<!--case:accent-->', () => brand.accent || '#8B0D32')
    .replace('<!--case:band-->', () => band)
    .replace('<!--case:eyebrow-->', () => esc(D.eyebrow || ''))
    .replace('<!--case:heading-->', () => esc(title))
    .replace('<!--case:list-->', () => view.list)
    .replace('<!--case:update-->', () => view.update)
    .replace('<!--case:data-->', () => data)
    .replace('<!--case:client-->', () => cli);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`groups: ${D.groups.length} cases: ${D.groups.reduce((n, g) => n + g.cases.length, 0)}`);
}

function init(dir, opt) {
  if (!dir) die('usage: case.js init <dir> --title "<text>" [--lang en|tr] [--eyebrow t] [--logo file] [--accent #hex] [--force]');
  if (!opt.title) die('--title is required');
  const lang = opt.lang || 'en';
  if (!LABELS[lang]) die(`unknown language ${lang} (en or tr)`);
  const file = path.join(dir, 'cases.json');
  if (fs.existsSync(file) && !opt.force) die(`${file} already exists (use --force to overwrite)`);
  const brand = {};
  if (opt.accent) brand.accent = opt.accent;
  fs.mkdirSync(dir, { recursive: true });
  if (opt.logo) {
    const ext = path.extname(opt.logo).toLowerCase();
    if (!['.png', '.svg'].includes(ext)) die('--logo must be a .png or .svg file');
    let buf;
    try { buf = fs.readFileSync(opt.logo); } catch (e) { die(`cannot read logo ${opt.logo}`); }
    brand.logo = `logo${ext}`;
    fs.writeFileSync(path.join(dir, brand.logo), buf);
  }
  const D = { title: opt.title, lang, eyebrow: opt.eyebrow || '', brand, update: { items: [], links: [] }, groups: [{ name: 'Options', cases: [{ title: 'First option', status: 'wait', why: '', specs: [], links: [] }] }] };
  fs.writeFileSync(file, JSON.stringify(D, null, 1) + '\n');
  render(dir);
}

const { pos, opt } = parseArgs(process.argv.slice(2));
if (pos[0] === 'init') init(pos[1], opt);
else if (pos[0] === 'render') render(pos[1]);
else die('usage: case.js init <dir> --title "<text>" [...]  |  case.js render <dir>');
