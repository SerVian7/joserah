#!/usr/bin/env node
/**
 * relocate-imports.js — move a workspace's source material from the
 * 2026-08-31..2026-09-12 location (raw/ at the workspace root) to imports/,
 * flattening raw/imports/<x> to imports/<x>, and rewrite every markdown link
 * that cited the old paths. Link paths only, never link text; files are
 * moved, never modified. Run relocate-raw.js first on a workspace that still
 * has .joserah/knowledge/raw/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scanWorkspace } = require('./lib/workspace-scan');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());

if (!fs.existsSync(path.join(root, '.joserah', 'config.json'))) {
  console.error(`relocate-imports: ${root} is not a Joserah workspace`);
  process.exit(1);
}

const oldRoot = path.join(root, 'raw');
const newRoot = path.join(root, 'imports');
const TEMPLATE_README = fs.readFileSync(path.join(__dirname, '..', 'templates', 'imports', 'README.md'), 'utf8');

if (!fs.existsSync(oldRoot)) {
  console.log(JSON.stringify({ moved: false, linksRewritten: 0, notesTouched: 0, flattened: 0 }));
  process.exit(0);
}
if (fs.existsSync(newRoot) && fs.readdirSync(newRoot).some((e) => e !== 'README.md')) {
  console.error('relocate-imports: imports/ already exists at the root and is not empty — resolve by hand first.');
  process.exit(1);
}

// Where does a path inside raw/ land? raw/imports/X -> imports/X (flatten); raw/Y -> imports/Y.
function mapped(absInsideOld) {
  const rel = path.relative(oldRoot, absInsideOld);
  const parts = rel.split(path.sep);
  if (parts[0] === 'imports') parts.shift();
  return path.join(newRoot, ...parts);
}

const LINK = /\]\(([^)\s]+)\)/g;
let linksRewritten = 0;
const edits = [];
for (const rel of scanWorkspace(root).files) {
  const abs = path.join(root, rel);
  const dir = path.dirname(abs);
  const text = fs.readFileSync(abs, 'utf8');
  const next = text.replace(LINK, (whole, href) => {
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith('#')) return whole;
    const target = path.resolve(dir, href.split('#')[0]);
    if (target !== oldRoot && !target.startsWith(oldRoot + path.sep)) return whole;
    const out = path.relative(dir, mapped(target)).split(path.sep).join('/');
    const hash = href.includes('#') ? '#' + href.split('#').slice(1).join('#') : '';
    linksRewritten++;
    return `](${out}${hash})`;
  });
  if (next !== text) edits.push([abs, next]);
}

let flattened = 0;
const moves = [];
for (const entry of fs.readdirSync(oldRoot)) {
  const from = path.join(oldRoot, entry);
  if (entry === 'README.md') continue; // plugin boilerplate; the template is written fresh below
  if (entry === 'imports' && fs.statSync(from).isDirectory()) {
    for (const inner of fs.readdirSync(from)) { moves.push([path.join(from, inner), path.join(newRoot, inner)]); flattened++; }
  } else {
    moves.push([from, path.join(newRoot, entry)]);
  }
}
for (const [, to] of moves) {
  if (fs.existsSync(to)) { console.error(`relocate-imports: ${path.relative(root, to)} already exists — resolve by hand first.`); process.exit(1); }
}

if (dryRun) {
  console.log(JSON.stringify({ moved: false, dryRun: true, linksRewritten, notesTouched: edits.length, flattened, moves: moves.map(([f, t]) => [path.relative(root, f), path.relative(root, t)]) }));
  process.exit(0);
}

// Order: gitignore (idempotent) → notes (pure string arithmetic) → move (the one non-repeatable stage).
const giPath = path.join(root, '.gitignore');
const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
let nextGi = gi.replace(/^raw\/$/m, 'imports/');
if (!/^imports\/$/m.test(nextGi)) nextGi = nextGi.replace(/\s*$/, '\n') + '\n# Source material: originals the owner already holds elsewhere. Never in a repository backup.\nimports/\n';
if (!/^\.joserah\/conversations\/$/m.test(nextGi)) nextGi = nextGi.replace(/\s*$/, '\n') + '\n# Conversation records: kept in the workspace, never in a repository backup\n.joserah/conversations/\n';
if (nextGi !== gi) fs.writeFileSync(giPath, nextGi);

for (const [abs, next] of edits) fs.writeFileSync(abs, next);

fs.mkdirSync(newRoot, { recursive: true });
for (const [from, to] of moves) fs.renameSync(from, to);
const oldReadme = path.join(oldRoot, 'README.md');
if (fs.existsSync(oldReadme)) fs.rmSync(oldReadme);
const leftover = fs.existsSync(path.join(oldRoot, 'imports')) ? fs.readdirSync(path.join(oldRoot, 'imports')) : [];
if (!leftover.length && fs.existsSync(path.join(oldRoot, 'imports'))) fs.rmdirSync(path.join(oldRoot, 'imports'));
if (!fs.readdirSync(oldRoot).length) fs.rmdirSync(oldRoot);
if (!fs.existsSync(path.join(newRoot, 'README.md'))) fs.writeFileSync(path.join(newRoot, 'README.md'), TEMPLATE_README);

console.log(JSON.stringify({ moved: true, linksRewritten, notesTouched: edits.length, flattened }));
