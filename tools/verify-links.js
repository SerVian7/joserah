#!/usr/bin/env node
/**
 * verify-links.js — internal link checker.
 * Scans .md files under the given directory (default: cwd), extracts relative
 * markdown links, and verifies each target exists with EXACT casing (so a
 * link that works on Windows does not break after a restore onto Linux).
 * Exit 0 = all links resolve. Exit 1 = broken links listed on stdout.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());

// Junk that is junk at any depth — matched by name. '.superpowers' is
// disposable scratch written by the superpowers execution harness
// (plan ledgers, briefs, review packages): it is regenerated on demand,
// listed in the generated workspace .gitignore, and excluded from backups
// by archive.js — so links inside it are not the workspace's health, and a
// broken one there cannot be cleared by the owner.
const SKIP_ANY = new Set(['.git', 'node_modules', '.venv', 'site-packages', 'dist', 'build', '.superpowers']);
// Contracts about the workspace root — matched by workspace-relative path,
// case-insensitively (Windows/macOS filesystems are). `imports/` (formerly
// `raw/`) holds imported snapshots that are immutable by rule: their internal
// links are historical facts, not workspace health. The two `raw` entries are
// the legacy locations — root `raw/` is the 2026-08-31..2026-09-12 name and
// `.joserah/knowledge/raw` the one before it — kept for workspaces the
// relocate tools have not yet touched.
const SKIP_REL = ['keys', '.joserah/keys', 'projects', 'docker-stack', 'imports', 'raw', '.joserah/knowledge/raw'];

function isSkippedRel(rel) {
  const low = rel.split(path.sep).join('/').toLowerCase();
  return SKIP_REL.some((p) => low === p || low.startsWith(p + '/'));
}

function* mdFiles(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_ANY.has(e.name) || isSkippedRel(childRel)) continue;
      yield* mdFiles(path.join(dir, e.name), childRel);
    } else if (e.name.toLowerCase().endsWith('.md')) {
      yield path.join(dir, e.name);
    }
  }
}

// Blank out fenced blocks and inline code so link examples inside backticks
// are not treated as real links.
//
// Deliberately duplicated (also in tools/lib/note-format.js): this file is
// copied verbatim into every workspace by scaffold.js, and doctor.js compares
// the workspace's copy to the plugin's byte-for-byte, so it cannot require a
// sibling library file that would not travel with it.
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

// Capture everything to the closing paren (spaces included), then strip an
// optional  "title"  suffix and optional <> wrapping.
const LINK_RE = /\]\(([^)\n]+)\)/g;
function cleanTarget(raw) {
  let t = raw.trim().replace(/\s+["'][^"']*["']$/, '');
  if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1);
  return t;
}

// existsSync is case-insensitive on Windows/macOS; walk each component with
// readdirSync so casing must match exactly. Directory listings are cached.
const dirCache = new Map();
function listDir(dir) {
  if (!dirCache.has(dir)) {
    try { dirCache.set(dir, new Set(fs.readdirSync(dir))); }
    catch { dirCache.set(dir, null); }
  }
  return dirCache.get(dir);
}
function existsExact(baseDir, target) {
  let cur = path.resolve(baseDir);
  for (const part of path.normalize(target).split(path.sep)) {
    if (!part || part === '.') continue;
    if (part === '..') { cur = path.dirname(cur); continue; }
    const names = listDir(cur);
    if (!names || !names.has(part)) return false;
    cur = path.join(cur, part);
  }
  return true;
}

// SKIP_REL (above) stops this tool WALKING into imports/ — it does not stop a
// link written elsewhere from RESOLVING into it, and existsExact runs on
// every link target regardless of where it lives. imports/ (formerly raw/) is
// gitignored by construction, so a fresh clone or restore
// has none on disk at all — and every wiki citation written the documented
// way (templates/.joserah/knowledge/wiki/README.md,
// templates/.joserah/conventions.md) would go red on the very first machine
// that doesn't have the source material, teaching the owner that doctor red
// is normal. So: a target that resolves under one of these roots is only
// exempted from the existence check when that top-level tree is itself
// absent. Conditioned on absence, not on the child path, on purpose — a
// genuinely mistyped imports/ citation is still caught on the authoring
// machine, where imports/ is present.
//
// "Absent" tolerates an imports/ that holds nothing but its own template
// README.md, not only an imports/ missing outright. scaffold.js's
// --root-shell-only writes imports/README.md on a restore whose backup scope
// never carried imports/ at all (see its own comment) — that write
// materialises the directory, and a bare existsSync would flip every
// citation back to broken on exactly the restore this exemption exists
// for, with the confirming doctor re-run in skills/backup/SKILL.md's own
// restore step landing on the newly-red result. An imports/ holding only that
// one file carries no source material either way, so it is treated the
// same as an imports/ that does not exist yet.
//
// The two raw roots below stay for workspaces not yet migrated: root `raw/`
// was this folder's name from 2026-08-31 to 2026-09-12, and
// `.joserah/knowledge/raw` the name before that.
const RAW_ROOTS = [
  { rel: 'imports', abs: path.join(ROOT, 'imports') },
  { rel: 'raw', abs: path.join(ROOT, 'raw') },
  { rel: '.joserah/knowledge/raw', abs: path.join(ROOT, '.joserah', 'knowledge', 'raw') },
];
function isEffectivelyAbsent(abs) {
  let entries;
  try { entries = fs.readdirSync(abs); }
  catch { return true; } // does not exist (or is not a directory) — absent
  return entries.length === 0 || (entries.length === 1 && entries[0] === 'README.md');
}
function targetsAbsentRaw(fromDir, target) {
  const abs = path.resolve(fromDir, target);
  const rel = path.relative(ROOT, abs).split(path.sep).join('/').toLowerCase();
  for (const r of RAW_ROOTS) {
    if (rel === r.rel || rel.startsWith(r.rel + '/')) return isEffectivelyAbsent(r.abs);
  }
  return false;
}

// Wikilink targets resolve against note TITLES inside this vault — never
// against a path, and never outside the workspace. That containment is the
// point: a hosted workspace's links cannot reach its host.
const ALL_FILES = [...mdFiles(ROOT, '')];
const TITLES = new Set();
for (const f of ALL_FILES) {
  const text = fs.readFileSync(f, 'utf8');
  const m = /^#\s+(.+?)\s*$/m.exec(text);
  TITLES.add((m ? m[1] : path.basename(f, '.md')).toLowerCase());
}
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;

const broken = [];
for (const file of ALL_FILES) {
  const lines = stripCode(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) {
      let target = cleanTarget(m[1]);
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;
      if (target.includes('\\')) {
        broken.push(`${path.relative(ROOT, file)}:${i + 1} → ${m[1]} (backslash separators break on Linux — use /)`);
        continue;
      }
      try { target = decodeURIComponent(target.split('#')[0]); }
      catch { /* a literal %, e.g. %USERPROFILE% — check the raw text */ target = target.split('#')[0]; }
      if (!target) continue;
      if (!existsExact(path.dirname(file), target) && !targetsAbsentRaw(path.dirname(file), target)) {
        broken.push(`${path.relative(ROOT, file)}:${i + 1} → ${m[1]}`);
      }
    }
    // Case-insensitive on purpose, unlike existsExact above: a path names a
    // filesystem entry, where case is part of its identity and a mismatch is
    // a real break on a case-sensitive host; a wikilink names a note's title,
    // a human-written reference where case carries no meaning and enforcing
    // it would only manufacture false breaks.
    for (const m of line.matchAll(WIKILINK_RE)) {
      const target = m[1].split('|')[0].trim();
      if (!TITLES.has(target.toLowerCase())) {
        broken.push(`${path.relative(ROOT, file)}:${i + 1} → [[${target}]] (no note titled "${target}" in this workspace)`);
      }
    }
  });
}

if (broken.length) {
  console.log(`BROKEN LINKS (${broken.length}):`);
  for (const b of broken) console.log('  ' + b);
  process.exit(1);
}
console.log('All internal links OK.');
