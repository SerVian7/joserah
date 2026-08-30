#!/usr/bin/env node
/**
 * relocate-raw.js — move a workspace's immutable source material from the
 * pre-2026-08-31 location (.joserah/knowledge/raw/) to raw/ at the workspace
 * root, and rewrite every markdown link that cited the old location.
 *
 * Deliberately NOT part of migrate.js: migrate's contract forbids editing the
 * owner's prose, and a link rewrite edits lines. This tool is opt-in, run
 * once, and mechanical — it changes link *paths* only, never link text.
 * The files inside raw/ itself are moved, never modified (immutability).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scanWorkspace } = require('./lib/workspace-scan');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());

if (!fs.existsSync(path.join(root, '.joserah', 'config.json'))) {
  console.error(`relocate-raw: ${root} is not a Joserah workspace`);
  process.exit(1);
}

const oldRaw = path.join(root, '.joserah', 'knowledge', 'raw');
const newRaw = path.join(root, 'raw');

if (!fs.existsSync(oldRaw)) {
  console.log(JSON.stringify({ moved: false, linksRewritten: 0, notesTouched: 0 }));
  process.exit(0);
}
// scaffold.js (Tasks 1-3) already creates raw/README.md at the root of every
// new workspace, so newRaw existing with exactly that plugin-owned template
// file is the expected steady state going into a migration, not a conflict.
// Only owner content there (anything else) is a genuine collision.
if (fs.existsSync(newRaw) && fs.readdirSync(newRaw).some((e) => e !== 'README.md')) {
  console.error('relocate-raw: raw/ already exists at the root and is not empty — resolve by hand first.');
  process.exit(1);
}

// Rewrite links first (against the still-existing old tree), then move.
// A markdown link is rewritten when its target resolves inside oldRaw.
const LINK = /\]\(([^)\s]+)\)/g;
let linksRewritten = 0;
let notesTouched = 0;
const edits = [];
const { files } = scanWorkspace(root);
for (const rel of files) {
  const abs = path.join(root, rel);
  const dir = path.dirname(abs);
  const text = fs.readFileSync(abs, 'utf8');
  const next = text.replace(LINK, (whole, href) => {
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith('#')) return whole;
    const target = path.resolve(dir, href.split('#')[0]);
    if (target !== oldRaw && !target.startsWith(oldRaw + path.sep)) return whole;
    const moved = path.join(newRaw, path.relative(oldRaw, target));
    let out = path.relative(dir, moved).split(path.sep).join('/');
    const hash = href.includes('#') ? '#' + href.split('#').slice(1).join('#') : '';
    linksRewritten++;
    return `](${out}${hash})`;
  });
  if (next !== text) { notesTouched++; edits.push([abs, next]); }
}

if (!dryRun) {
  for (const [abs, next] of edits) fs.writeFileSync(abs, next);
  // Plain renameSync(oldRaw, newRaw) only works when newRaw does not yet
  // exist; here it usually already does (scaffold's own README.md — see the
  // check above), so entries are moved in one at a time instead. The only
  // collision possible at this point is oldRaw carrying its own README.md
  // from the pre-migration template describing the old location — that file
  // is plugin-owned prose, not the owner's, so the new root README.md (which
  // documents the current convention) wins and the old copy is discarded.
  fs.mkdirSync(newRaw, { recursive: true });
  for (const entry of fs.readdirSync(oldRaw)) {
    const from = path.join(oldRaw, entry);
    const to = path.join(newRaw, entry);
    if (entry === 'README.md' && fs.existsSync(to)) { fs.rmSync(from); continue; }
    fs.renameSync(from, to);
  }
  fs.rmdirSync(oldRaw);
  // .gitignore: ensure the root exclusion exists (idempotent).
  const giPath = path.join(root, '.gitignore');
  const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  if (!/^raw\/$/m.test(gi)) {
    fs.writeFileSync(giPath, gi.replace(/\s*$/, '\n') +
      '\n# Source material: originals the owner already holds elsewhere. Never in a repository backup.\nraw/\n');
  }
}
console.log(JSON.stringify({ moved: !dryRun, linksRewritten, notesTouched }));
