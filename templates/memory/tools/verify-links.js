#!/usr/bin/env node
/**
 * verify-links.js — do the relative markdown links in this memory resolve?
 * Usage: node tools/verify-links.js     exit 0 all resolve · 1 broken ones listed
 *
 * Node built-ins only; scans knowledge/, members/, inbox/, questions/, desk/.
 * Targets are matched with EXACT casing, so a link that works on Windows does
 * not break on Linux. [[Wikilinks]] resolve like the plugin's tool: against note titles
 * (first # heading, else the file name), case-insensitive, `|alias` ignored.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['knowledge', 'members', 'inbox', 'questions', 'desk'];

function* mdFiles(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* mdFiles(p);
    else if (e.name.toLowerCase().endsWith('.md')) yield p;
  }
}

const stripCode = (t) => t
  .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

function* allMd(root) {
  for (const d of DIRS) yield* mdFiles(path.join(root, d));
  for (const e of fs.readdirSync(root)) if (e.toLowerCase().endsWith('.md')) yield path.join(root, e);
}

function existsExact(baseDir, target) {
  let cur = path.resolve(baseDir);
  for (const part of path.normalize(target).split(path.sep)) {
    if (!part || part === '.') continue;
    if (part === '..') { cur = path.dirname(cur); continue; }
    let names;
    try { names = fs.readdirSync(cur); } catch { return false; }
    if (!names.includes(part)) return false;
    cur = path.join(cur, part);
  }
  return true;
}

/** Broken links as "file:line -> target" strings. */
function brokenLinks(root = ROOT) {
  const broken = [];
  const titles = new Set();
  for (const f of allMd(root)) {
    const m = /^#\s+(.+?)\s*$/m.exec(fs.readFileSync(f, 'utf8'));
    titles.add((m ? m[1] : path.basename(f, '.md')).toLowerCase());
  }
  for (const d of DIRS) {
    for (const file of mdFiles(path.join(root, d))) {
      stripCode(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const t = m[1].split('|')[0].trim();
          if (!titles.has(t.toLowerCase())) broken.push(`${path.relative(root, file).split(path.sep).join('/')}:${i + 1} -> [[${t}]] (no note titled "${t}")`);
        }
        for (const m of line.matchAll(/\]\(([^)\n]+)\)/g)) {
          let t = m[1].trim().replace(/\s+["'][^"']*["']$/, '');
          if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1);
          if (/^(https?:|mailto:|tel:|data:|#)/i.test(t)) continue;
          const rel = `${path.relative(root, file).split(path.sep).join('/')}:${i + 1} -> ${m[1]}`;
          if (t.includes('\\')) { broken.push(`${rel} (use / in paths)`); continue; }
          try { t = decodeURIComponent(t.split('#')[0]); } catch { t = t.split('#')[0]; }
          if (t && !existsExact(path.dirname(file), t)) broken.push(rel);
        }
      });
    }
  }
  return broken;
}

module.exports = { brokenLinks, mdFiles };

if (require.main === module) {
  const broken = brokenLinks();
  if (broken.length) {
    console.log(`BROKEN LINKS (${broken.length}):`);
    for (const b of broken) console.log('  ' + b);
    process.exit(1);
  }
  console.log('All internal links OK.');
}
