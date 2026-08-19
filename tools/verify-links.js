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

// Junk that is junk at any depth — matched by name.
const SKIP_ANY = new Set(['.git', 'node_modules', '.venv', 'site-packages', 'dist', 'build']);
// Contracts about the workspace root — matched by workspace-relative path,
// case-insensitively (Windows/macOS filesystems are). `raw/` holds imported
// snapshots that are immutable by rule: their internal links are historical
// facts, not workspace health.
const SKIP_REL = ['keys', '.joserah/keys', 'projects', 'docker-stack', '.joserah/knowledge/raw'];

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

const broken = [];
for (const file of mdFiles(ROOT, '')) {
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
      if (!existsExact(path.dirname(file), target)) {
        broken.push(`${path.relative(ROOT, file)}:${i + 1} → ${m[1]}`);
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
