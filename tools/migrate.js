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
const { ensureFrontmatter, extractWikilinks, renderRelations, stripCode, detectEol, FORMAT_VERSION } = require('./lib/note-format');

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

// Entities are the graph's nodes: one file per person or organisation. Their
// titles are what other notes mention in prose.
const ENTITY_PREFIXES = ['.joserah/knowledge/people/', '.joserah/knowledge/wiki/entities/'];

function buildEntityIndex(rootDir, relFiles) {
  const index = new Map();
  for (const rel of relFiles) {
    if (!ENTITY_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const text = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    const title = titleFor(rel, text);
    if (title.length >= 3) index.set(title.toLowerCase(), title);
  }
  return index;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Whole-word, case-insensitive, and never inside a fenced block or inline
// code — the same defensive reading verify-links.js uses.
function mentionedEntities(text, index, selfTitle) {
  const hay = stripCode(text);
  const found = [];
  for (const [low, title] of index) {
    if (selfTitle && low === selfTitle.toLowerCase()) continue;
    if (new RegExp(`(^|[^\\w\\[])${escapeRe(title)}($|[^\\w\\]])`, 'i').test(hay)) found.push(title);
  }
  return found.sort();
}

const { files, boundaries } = scanWorkspace(root);
let changed = 0;

const entityIndex = buildEntityIndex(root, files);

for (const rel of files) {
  const abs = path.join(root, rel);
  const original = fs.readFileSync(abs, 'utf8');
  const title = titleFor(rel, original);

  const fm = ensureFrontmatter(original, { title, type: typeFor(rel) });
  let text = fm.text;
  let touched = fm.changed;

  const already = new Set(extractWikilinks(text).map((w) => w.toLowerCase()));
  const missing = mentionedEntities(original, entityIndex, title)
    .filter((e) => !already.has(e.toLowerCase()));
  if (missing.length) {
    // The appended block must match the note's own eol, not a hardcoded LF —
    // otherwise a CRLF note ends up with an LF-joined block glued onto CRLF
    // prose. detectEol reads it off the original bytes, before frontmatter
    // (which reuses the same eol) is spliced in.
    text += renderRelations(
      missing.map((e) => ({ type: 'mentions', target: e, context: null })),
      detectEol(original)
    );
    touched = true;
  }

  if (!touched) continue;
  changed++;
  if (!dryRun) fs.writeFileSync(abs, text, 'utf8');
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
