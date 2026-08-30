#!/usr/bin/env node
/**
 * migrate.js — carry a Joserah workspace to the current note format.
 * Usage: node migrate.js <workspace-root> [--dry-run]
 *
 * Additive by contract: it may add a frontmatter block and append a
 * `## Relations` section. It never edits a line of the owner's prose, never
 * enters a nested workspace, and never touches raw/, directives.md or keys/.
 * Running it twice in a row must produce no second-run change.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scanWorkspace } = require('./lib/workspace-scan');
const { ensureFrontmatter, FORMAT_VERSION } = require('./lib/note-format');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());

const cfgPath = path.join(root, '.joserah', 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error(`migrate: ${root} is not a Joserah workspace (no .joserah/config.json found)`);
  process.exit(1);
}

// Folder decides the note type. Longest prefix wins, so people/ and
// wiki/entities/ beat the generic knowledge/ fallback.
const TYPE_BY_PREFIX = [
  ['.joserah/knowledge/people/', 'person'],
  ['.joserah/knowledge/wiki/entities/', 'entity'],
  ['.joserah/knowledge/wiki/', 'reference'],
  ['.joserah/desk/daily/', 'journal'],
  ['.joserah/desk/tasks/', 'tasks'],
  ['.joserah/desk/inbox/', 'tasks'],
  ['.joserah/plans/', 'plan'],
  ['.joserah/specs/', 'spec'],
  ['.joserah/personal/', 'personal'],
];

function typeFor(rel) {
  let best = ['', 'note'];
  for (const [prefix, type] of TYPE_BY_PREFIX) {
    if (rel.startsWith(prefix) && prefix.length > best[0].length) best = [prefix, type];
  }
  return best[1];
}

// The title is the file's own H1 when it has one — that is what the owner
// called it. Otherwise the filename, which is always in kebab-case here.
function titleFor(rel, text) {
  const m = /^#\s+(.+?)\s*$/m.exec(text);
  if (m) return m[1];
  return path.basename(rel, '.md');
}

const { files, boundaries } = scanWorkspace(root);
let changed = 0;

for (const rel of files) {
  const abs = path.join(root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  const next = ensureFrontmatter(text, { title: titleFor(rel, text), type: typeFor(rel) });
  if (!next.changed) continue;
  changed++;
  if (!dryRun) fs.writeFileSync(abs, next.text, 'utf8');
}

// A workspace carries AGENTS.md only, so it is not tied to one vendor's tool.
const removed = [];
const claudeMd = path.join(root, 'CLAUDE.md');
if (fs.existsSync(claudeMd)) {
  removed.push('CLAUDE.md');
  if (!dryRun) fs.unlinkSync(claudeMd);
}

if (!dryRun) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
  cfg.formatVersion = FORMAT_VERSION;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

console.log(JSON.stringify({ root, scanned: files.length, changed, boundaries, removed }));
