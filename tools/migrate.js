#!/usr/bin/env node
/**
 * migrate.js — carry a Joserah workspace to the current note format.
 * Usage: node migrate.js <workspace-root> [--dry-run]
 *
 * Additive by contract: it may add a frontmatter block and append a
 * `## Relations` section. It never edits a line of the owner's prose, never
 * enters a nested workspace, and never touches raw/, directives.md or keys/.
 * Running it twice in a row must produce no second-run change.
 *
 * A note whose bytes are not plain UTF-8 is refused rather than migrated —
 * see byteOrderMark below. The contract is "never mangle", not "always
 * migrate", so the refusal is reported in `skipped` and the file is left
 * exactly as its owner left it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scanWorkspace } = require('./lib/workspace-scan');
const { ensureFrontmatter, extractWikilinks, renderRelations, stripCode, detectEol, FORMAT_VERSION, roleFor } = require('./lib/note-format');

const TEMPLATES = path.join(__dirname, '..', 'templates');

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

// config.json is a file the owner hand-edits, same as a note's prose — an
// inline array, unusual indentation, whatever they chose. A round-trip
// through JSON.stringify would reflow every one of those choices just to
// stamp one key, which is exactly the class of harm ensureFrontmatter
// already refuses to do to a note. So this performs the narrowest text edit
// that lands formatVersion at the target value and touches nothing else —
// same discipline, applied to JSON instead of a frontmatter block.
function stampFormatVersion(text, version) {
  let cfg;
  try {
    cfg = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    // Malformed JSON is not migrate's to repair — splicing text into a
    // syntax error risks compounding it into real corruption, and doctor.js
    // already surfaces an unparsable config as its own failing check. Leave
    // the bytes exactly as the owner left them.
    return { text, changed: false };
  }
  // config.json is only ever an object in practice; anything else has no
  // key to stamp.
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
    return { text, changed: false };
  }
  if (cfg.formatVersion === version) return { text, changed: false };

  // The key may already exist (just stale) — replace only its value, in
  // place, rather than treating "already present" the same as "missing".
  const KEY_RE = /"formatVersion"\s*:\s*[^,}\r\n]*/;
  if (KEY_RE.test(text)) {
    return { text: text.replace(KEY_RE, `"formatVersion": ${version}`), changed: true };
  }

  // No existing key: insert one as the object's first property. The eol and
  // indent are read off the line the first existing key already sits on, so
  // a CRLF, tab-indented, or 4-space file gets a line in its own style
  // rather than an assumed one; an empty object falls back to a bare `\n`
  // with no indent, since there is no sibling line to match.
  const braceIdx = text.indexOf('{');
  const afterBrace = text.slice(braceIdx + 1);
  const lineMatch = /^(\r?\n)([ \t]*)/.exec(afterBrace);
  const trimmed = afterBrace.replace(/^\s+/, '');
  const hasSibling = trimmed.length > 0 && trimmed[0] !== '}';
  const eol = lineMatch ? lineMatch[1] : '\n';
  const indent = lineMatch ? lineMatch[2] : '';
  const insertion = lineMatch
    ? `${eol}${indent}"formatVersion": ${version}${hasSibling ? ',' : ''}`
    : `"formatVersion": ${version}${hasSibling ? ', ' : ''}`;
  return { text: text.slice(0, braceIdx + 1) + insertion + text.slice(braceIdx + 1), changed: true };
}

// scaffold.js and doctor.js already strip a leading U+FEFF before parsing
// config.json, for the same underlying reason: on Windows — this plugin's
// target platform — PowerShell redirection and several editors write an
// encoding mark that nothing downstream expects. A note is not config.json,
// though, and stripping is the wrong answer for one:
//  - a UTF-8 BOM defeats FM_RE's `^---` anchor, so a new frontmatter block
//    lands in FRONT of the mark; on a note already on v2 that means a second,
//    duplicate block, demoting the owner's real one to body prose — and the
//    next run then reports `changed: 0`, so the damage is stable and
//    invisible to the idempotence guarantee this tool is judged by;
//  - a UTF-16 note (PowerShell 5.1's default for `>` redirection) decoded as
//    UTF-8 becomes replacement characters, and writing that back destroys
//    every character above U+007F — every Turkish letter in the file —
//    with no way back.
// Re-encoding somebody's note is a rewrite, which this tool does not do. So
// the mark is detected on the raw bytes and the file is left alone.
const BYTE_ORDER_MARKS = [
  { bytes: [0xEF, 0xBB, 0xBF], reason: 'UTF-8 BOM' },
  { bytes: [0xFF, 0xFE], reason: 'UTF-16LE BOM' },
  { bytes: [0xFE, 0xFF], reason: 'UTF-16BE BOM' },
];

function byteOrderMark(buf) {
  for (const m of BYTE_ORDER_MARKS) {
    if (buf.length >= m.bytes.length && m.bytes.every((b, i) => buf[i] === b)) return m.reason;
  }
  return null;
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

// Partitioned before anything reads a note as text, so a skipped file is also
// kept out of the entity index — a title read out of mis-decoded bytes would
// otherwise put a wrong entity name into every other note in the workspace.
const skipped = [];
const migratable = [];
for (const rel of files) {
  const reason = byteOrderMark(fs.readFileSync(path.join(root, rel)));
  if (reason) skipped.push({ file: rel, reason });
  else migratable.push(rel);
}

const entityIndex = buildEntityIndex(root, migratable);

for (const rel of migratable) {
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
    // A note that ends without a final newline would otherwise get its last
    // prose line and the `## Relations` heading run together on one line —
    // the one remaining case where this tool visibly altered a line the owner
    // wrote, rather than only adding after it.
    if (!/\n$/.test(text)) text += detectEol(original);
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

// Computed regardless of --dry-run so the decision (and non-decision) is the
// same in both modes; only the write itself is gated. A config already at
// the target version is not opened for writing at all, not even a no-op
// rewrite, so its mtime and every byte are left exactly as the owner has
// them.
const cfgStamp = stampFormatVersion(fs.readFileSync(cfgPath, 'utf8'), FORMAT_VERSION);
if (cfgStamp.changed && !dryRun) fs.writeFileSync(cfgPath, cfgStamp.text, 'utf8');

// R17: JOSERAH-ROLE.md and .joserah/agent.md are written only at scaffold
// time — a workspace that predates this plan never got either, and scaffold
// itself refuses to run again on a workspace that already exists. Migrate is
// therefore the only path left to carry such a workspace forward, so it
// installs whichever of the two is still missing. Kept out of the `changed`
// count above (a new file is not an amended one) and, like everything else
// in this tool, gated on `!dryRun` only for the write itself — the decision
// is made the same way in both modes.
let cfgForKind;
try {
  cfgForKind = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
} catch {
  cfgForKind = null;
}
const kind = (cfgForKind && cfgForKind.kind) || 'home';

const created = [];

const rolePath = path.join(root, 'JOSERAH-ROLE.md');
if (!fs.existsSync(rolePath)) {
  created.push('JOSERAH-ROLE.md');
  if (!dryRun) {
    fs.copyFileSync(path.join(TEMPLATES, 'roles', `joserah-${roleFor(kind)}.md`), rolePath);
  }
}

const agentPath = path.join(root, '.joserah', 'agent.md');
if (!fs.existsSync(agentPath)) {
  created.push('.joserah/agent.md');
  if (!dryRun) {
    fs.copyFileSync(path.join(TEMPLATES, '.joserah', 'agent.md'), agentPath);
  }
}

// `skipped` sits beside changed/removed/created so a --dry-run tells the
// owner what this tool refused to touch and why, rather than leaving the
// refusal silent and indistinguishable from "nothing needed doing".
console.log(JSON.stringify({ root, scanned: files.length, changed, boundaries, removed, created, skipped }));
