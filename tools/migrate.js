#!/usr/bin/env node
/**
 * migrate.js — carry a Joserah workspace to the current note format.
 * Usage: node migrate.js <workspace-root> [--dry-run]
 *
 * Additive by contract: it may add a frontmatter block and append a
 * `## Relations` section. It never edits a line of the owner's prose, never
 * enters a nested workspace, and never touches raw/, directives.md or keys/.
 * It creates directives.md when it is missing, and brings AGENTS.md current
 * when that is safe (see lib/prompt.js) — the two files an update is supposed
 * to carry. Running it twice in a row must produce no second-run change.
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
const { stampKey, removeKey } = require('./lib/config-stamp');
const { spawnSync } = require('child_process');
const { resolvePromptSource, promptState, decidePromptAction, installPrompt, compareVersions } = require('./lib/prompt');
const { installClaudeMd, CLAUDE_MD_IMPORTS } = require('../hooks/lib/standing-context');

const TEMPLATES = path.join(__dirname, '..', 'templates');
const PLUGIN_ROOT = path.join(__dirname, '..');

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

// Computed regardless of --dry-run so the decision (and non-decision) is the
// same in both modes; only the write itself is gated. A config already at
// the target version is not opened for writing at all, not even a no-op
// rewrite, so its mtime and every byte are left exactly as the owner has
// them.
const cfgStamp = stampKey(fs.readFileSync(cfgPath, 'utf8'), 'formatVersion', FORMAT_VERSION);
if (cfgStamp.changed && !dryRun) fs.writeFileSync(cfgPath, cfgStamp.text, 'utf8');

// 0.15.0 (owner, 2026-09-30): keys the plugin no longer reads are removed,
// by the same narrow text edit. ownerIsDeveloper: how technical the talk is
// belongs in the workspace's own directives.md, not in a switch.
const RETIRED_KEYS = ['ownerIsDeveloper'];
let configKeysRemoved = 0;
for (const key of RETIRED_KEYS) {
  const r = removeKey(dryRun && cfgStamp.changed ? cfgStamp.text : fs.readFileSync(cfgPath, 'utf8'), key);
  if (!r.changed) continue;
  configKeysRemoved++;
  if (!dryRun) fs.writeFileSync(cfgPath, r.text, 'utf8');
}

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

// directives.md is the owner's file — the one place a workspace-specific rule
// belongs, which is exactly why a plugin update must never rewrite it. But a
// workspace scaffolded before the file existed never got one, and AGENTS.md
// now points at it by name, so the missing case is installed from the
// template here (the only token it carries is the workspace name) and an
// existing file is never opened for writing at all.
const directivesPath = path.join(root, '.joserah', 'directives.md');
if (!fs.existsSync(directivesPath)) {
  created.push('.joserah/directives.md');
  if (!dryRun) {
    const tpl = fs.readFileSync(path.join(TEMPLATES, '.joserah', 'directives.md'), 'utf8');
    const name = (cfgForKind && cfgForKind.workspaceName) || path.basename(root);
    fs.writeFileSync(directivesPath, tpl.replace(/{{WORKSPACE_NAME}}/g, name), 'utf8');
  }
}

// Three plugin files live INSIDE the workspace: the link checker, the vault
// tool the prompt calls by that path, and the shared library the checker
// requires. scaffold.js writes them and refuses to run on a workspace that
// already exists, so before 0.13.0 the only way an existing workspace got a
// new copy was a person following a written list — and doctor byte-compares
// all three while the list named two. Carried here, beside the other two files
// migrate exists to carry. Reported apart from `changed`, which counts amended
// notes, and apart from `created`, which is about the workspace's own files.
const LOCAL_TOOLS = [
  ['verify-links.js'],
  ['lib', 'untouchable.js'],
  ['secret.js'],
];
const refreshed = [];
for (const rel of LOCAL_TOOLS) {
  const src = path.join(PLUGIN_ROOT, 'tools', ...rel);
  const dst = path.join(root, '.joserah', 'tools', ...rel);
  let same = false;
  try {
    same = fs.readFileSync(dst, 'utf8').replace(/\r\n/g, '\n')
      === fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
  } catch { /* missing or unreadable: either way it is not current */ }
  if (same) continue;
  refreshed.push('.joserah/tools/' + rel.join('/'));
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

// 0.15.0: one vault format. An old vault under keys/ (vault.json, .env,
// passwords.json — or a secrets.json in a foreign shape) is imported once
// through secret.js --import, so no value passes through this tool or its
// report. Only keys/ is read: a module's own .env (docker-stack, projects) is
// that module's secret and stays where it is (owner, 2026-09-29). A source is
// renamed <name>.imported-<date>, never deleted — the owner deletes it — and
// only when its import was clean; a foreign secrets.json has to move before a
// standard store can take its place, so it is renamed first. `migratedTo`
// decides: a workspace at 0.15.0 or later is not imported again.
const VAULT_SINCE = '0.15.0';
const vaultFrom = cfgForKind && (cfgForKind.migratedTo || cfgForKind.createdByPluginVersion);
let vault = null;
const keysPath = path.join(root, 'keys');
if ((!vaultFrom || compareVersions(vaultFrom, VAULT_SINCE) < 0) && fs.existsSync(keysPath)) {
  const stamp = new Date().toISOString().slice(0, 10);
  const isVault = (f) => /\.json$/i.test(f) || /(^|\.)env$|^\.env\./i.test(f);
  const sources = fs.readdirSync(keysPath, { withFileTypes: true })
    .filter((e) => e.isFile() && isVault(e.name) && e.name !== 'secrets.json')
    .map((e) => e.name);
  const storePath = path.join(keysPath, 'secrets.json');
  let foreignStore = false;
  if (fs.existsSync(storePath)) {
    try {
      const d = JSON.parse(fs.readFileSync(storePath, 'utf8').replace(/^﻿/, ''));
      foreignStore = !(d && d.secrets && typeof d.secrets === 'object' && !Array.isArray(d.secrets));
    } catch { /* unreadable: secret.js reports it; not ours to move */ }
  }
  vault = { sources: [], imported: 0, unchanged: 0, skipped: 0, renamed: [], kept: [] };
  const secretTool = path.join(root, '.joserah', 'tools', 'secret.js');
  const importOne = (name, renameAfter) => {
    vault.sources.push('keys/' + name);
    if (dryRun) return;
    const r = spawnSync(process.execPath, [secretTool, '--import', path.join(keysPath, name)], { cwd: root, encoding: 'utf8' });
    const m = /import: (\d+) imported, (\d+) unchanged, (\d+) skipped/.exec(r.stdout || '');
    if (m) { vault.imported += +m[1]; vault.unchanged += +m[2]; vault.skipped += +m[3]; }
    if (r.status === 0 && renameAfter) {
      fs.renameSync(path.join(keysPath, name), path.join(keysPath, `${name}.imported-${stamp}`));
      vault.renamed.push('keys/' + name);
    } else if (r.status !== 0) vault.kept.push('keys/' + name);
  };
  if (foreignStore) {
    const moved = `secrets.json.imported-${stamp}`;
    if (!dryRun) fs.renameSync(storePath, path.join(keysPath, moved));
    vault.renamed.push('keys/secrets.json');
    importOne(dryRun ? 'secrets.json' : moved, false);
  }
  for (const name of sources) importOne(name, true);
  if (!dryRun) spawnSync(process.execPath, [secretTool, '--index'], { cwd: root, encoding: 'utf8' });
}

// 0.13.3: the workspace-root CLAUDE.md that imports the standing layers (see
// CLAUDE_MD in hooks/lib/standing-context.js). Until 0.13.3 this tool DELETED
// any CLAUDE.md it found, owner-written or not. Now the plugin's own stub is
// installed or refreshed, and a CLAUDE.md without the stub's marker is the
// owner's: never written, never deleted, only reported in `skipped` — the hook
// keeps injecting whatever it does not import, and doctor names the lines to add.
const claudeMdState = installClaudeMd(root, { dryRun });
if (claudeMdState === 'created') created.push('CLAUDE.md');
if (claudeMdState === 'refreshed') refreshed.push('CLAUDE.md');
if (claudeMdState === 'foreign') {
  skipped.push({ file: 'CLAUDE.md', reason: 'owner-written, left as is — to deliver the standing layers through it, add the lines ' +
    CLAUDE_MD_IMPORTS.map((r) => '@' + r).join(', ') });
}

// AGENTS.md is plugin-owned and versioned apart from the plugin (lib/prompt.js).
// The decision is shared with refresh-prompt.js so the two tools agree: a
// missing or pristine-but-behind file is brought current, an unrecorded file
// that already matches is merely recorded, and anything that differs from what
// was recorded is left alone and reported — migrate has no --force, because
// overwriting text it cannot account for is the owner's call, made with the
// diff in front of them, through refresh-prompt.js.
const promptSource = resolvePromptSource();
const promptBefore = promptState(root, cfgForKind, promptSource);
const promptAction = promptSource ? decidePromptAction(promptBefore, { force: false }) : 'none';
const prompt = {
  state: promptBefore.state,
  action: promptAction,
  version: promptBefore.version,
  available: promptSource ? promptSource.version : null,
  reason: promptAction === 'refused'
    ? `AGENTS.md differs from the recorded install (${promptBefore.state}) — compare it with the current prompt, move anything workspace-specific to .joserah/directives.md, then run: node tools/refresh-prompt.js ${root} --force`
    : null,
};
if (promptAction === 'install' && promptBefore.state === 'missing') created.push('AGENTS.md');
if (!dryRun && (promptAction === 'install' || promptAction === 'record')) {
  installPrompt(root, promptSource, { recordOnly: promptAction === 'record' });
}

// `skipped` sits beside changed/created so a --dry-run tells the
// owner what this tool refused to touch and why, rather than leaving the
// refusal silent and indistinguishable from "nothing needed doing".
console.log(JSON.stringify({ root, scanned: files.length, changed, boundaries, created, refreshed, skipped, prompt, vault, configKeysRemoved }));
