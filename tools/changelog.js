#!/usr/bin/env node
/**
 * changelog.js — builds a per-module Changelog page from a changelog.json file.
 *
 *   node tools/changelog.js init <dir> --title "<module name>" --lang tr|en
 *                           [--desc "<one short phrase>"] [--logo <png|svg file>] [--force]
 *       Writes <dir>/changelog.json and renders <dir>/index.html from
 *       templates/changelog. Refuses, exit 1, if changelog.json exists unless --force.
 *       --logo copies the file next to index.html as logo.png|svg and references it
 *       by relative path (never embedded).
 *
 *   node tools/changelog.js add <dir> --date YYYY-MM-DD --line "<text>" [--line "<text>" ...]
 *       Adds the lines to that date's section (created if absent; lines are appended
 *       to an existing one) and re-renders. A section holds 2 to 5 short lines.
 *
 *   node tools/changelog.js render <dir>
 *       Rebuilds <dir>/index.html. Prints `sections: N`.
 *
 * title = the module's full name; description = one short phrase saying what the module is.
 * Page: logo, module name, at most one sentence, then dated sections, newest first,
 * ALL closed (the newest too), plain short lines. Nothing else: no footer, no badge,
 * no open-items list. One page per module. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LANGS = ['en', 'tr'];
const die = (msg) => { console.error(`changelog: ${msg}`); process.exit(1); };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TPL = path.join(__dirname, '..', 'templates', 'changelog');
// The Theme (tools/lib/theme.js): the brand's tokens, light and dark, and the console base, as on every page.
const theme = require('./lib/theme');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv) {
  const pos = []; const opt = { line: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opt.force = true;
    else if (a === '--line') opt.line.push(argv[++i]);
    else if (/^--(title|lang|logo|desc|date)$/.test(a)) opt[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) die(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, opt };
}

const shown = (d) => d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');
const read = (dir) => {
  const file = path.join(dir || '', 'changelog.json');
  if (!dir || !fs.existsSync(file)) die(`${file} not found (run init first)`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`changelog.json is not valid JSON: ${e.message}`); }
};

// The description is one short phrase saying what the module is, never a list of what it shows or does.
function checkDesc(d) {
  if (!d) return;
  const t = String(d).trim();
  if (t.length > 100 || /[\n;:]/.test(t) || /[.!?]\s*\S/.test(t)) die('description must be one short sentence (max 100 characters)');
}

function render(dir) {
  const D = read(dir);
  if (!D || !Array.isArray(D.sections)) die('changelog.json needs a "sections" array');
  if (!LANGS.includes(D.lang)) die('lang must be en or tr');
  checkDesc(D.description);
  const brand = D.brand || {};
  if (brand.logo && /^[a-z]+:|^\/|\.\./i.test(brand.logo)) die('brand.logo must be a relative file name');
  D.sections.forEach((s) => {
    if (!s || !DATE.test(s.date || '')) die('every section needs a date YYYY-MM-DD');
    if (!Array.isArray(s.lines) || s.lines.length < 2 || s.lines.length > 5) die(`section ${s.date}: 2 to 5 lines`);
  });
  const secs = [...D.sections].sort((a, b) => b.date.localeCompare(a.date))
    .map((s) => `<details><summary>${esc(shown(s.date))}</summary><ul>\n${s.lines.map((l) => `<li>${esc(l)}</li>\n`).join('')}</ul></details>`).join('\n');
  const html = fs.readFileSync(path.join(TPL, 'index.html'), 'utf8')
    .replace('<html lang="en">', () => `<html lang="${D.lang}">`)
    .replace('<!--changelog:theme-->', () => theme.css())
    .replace('<!--changelog:title-->', () => esc(D.title))
    .replace('<!--changelog:logo-->', () => (brand.logo ? `<img src="${esc(brand.logo)}" alt="">` : ''))
    .replace('<!--changelog:heading-->', () => esc(D.title))
    .replace('<!--changelog:desc-->', () => (D.description ? `<p>${esc(D.description)}</p>` : ''))
    .replace('<!--changelog:sections-->', () => secs);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`sections: ${D.sections.length}`);
}

function init(dir, opt) {
  if (!dir) die('usage: changelog.js init <dir> --title "<module name>" --lang tr|en [--desc t] [--logo file] [--force]');
  if (!opt.title) die('--title is required');
  if (!LANGS.includes(opt.lang)) die('--lang tr|en is required');
  const file = path.join(dir, 'changelog.json');
  if (fs.existsSync(file) && !opt.force) die(`${file} already exists (use --force to overwrite)`);
  const brand = {};
  fs.mkdirSync(dir, { recursive: true });
  if (opt.logo) {
    const ext = path.extname(opt.logo).toLowerCase();
    if (!['.png', '.svg'].includes(ext)) die('--logo must be a .png or .svg file');
    let buf;
    try { buf = fs.readFileSync(opt.logo); } catch (e) { die(`cannot read logo ${opt.logo}`); }
    brand.logo = `logo${ext}`;
    fs.writeFileSync(path.join(dir, brand.logo), buf);
  }
  const D = { title: opt.title, lang: opt.lang, description: opt.desc || '', brand, sections: [] };
  fs.writeFileSync(file, JSON.stringify(D, null, 1) + '\n');
  render(dir);
}

function add(dir, opt) {
  if (!dir || !DATE.test(opt.date || '') || !opt.line.length) die('usage: changelog.js add <dir> --date YYYY-MM-DD --line "<text>" [--line ...]');
  if (opt.line.some((l) => !l || !String(l).trim())) die('empty line');
  const D = read(dir);
  if (!Array.isArray(D.sections)) die('changelog.json needs a "sections" array');
  let s = D.sections.find((x) => x.date === opt.date);
  if (!s) { s = { date: opt.date, lines: [] }; D.sections.push(s); }
  s.lines.push(...opt.line.map((l) => String(l).trim()));
  if (s.lines.length < 2 || s.lines.length > 5) die(`section ${opt.date} would have ${s.lines.length} lines (2 to 5)`);
  D.sections.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(path.join(dir, 'changelog.json'), JSON.stringify(D, null, 1) + '\n');
  render(dir);
}

const { pos, opt } = parseArgs(process.argv.slice(2));
if (pos[0] === 'init') init(pos[1], opt);
else if (pos[0] === 'add') add(pos[1], opt);
else if (pos[0] === 'render') render(pos[1]);
else die('usage: changelog.js init <dir> --title t --lang tr|en  |  changelog.js add <dir> --date d --line t  |  changelog.js render <dir>');
