#!/usr/bin/env node
/**
 * secret-scan.js — find credential-shaped content in a workspace's text files
 * before it is committed or pushed. Filename-level exclusions (keys/, .env)
 * keep credential FILES out of git; this catches credentials pasted INTO
 * notes. Exit 0 clean (every file readable, no hits), 1 hits found, 2 could
 * not scan — either the file list itself couldn't be built, or one or more
 * files could not be read. A file that couldn't be read must never be
 * reported as clean: exit 2 wins over exit 0 whenever any file was skipped.
 * Output masks every match: first 4 chars + "…[masked]".
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SPECIFIC } = require('../hooks/lib/redactions');
const { isOwnRepoRoot } = require('./lib/git-root');
const { SECRET_SCAN_SKIP_REL, isUnder,
  isHiddenForeignDir, scopeFrom, inScope } = require('./lib/untouchable');

const root = path.resolve(process.argv[2] || process.cwd());
const staged = process.argv.includes('--staged');
// Composed in lib/untouchable.js. Every entry is matched as a workspace-
// relative path, so the junk names in it exclude only a root-level one — that
// is how this tool has always behaved. The legacy `.joserah/knowledge/raw`
// source-material location is deliberately absent: nothing ever gitignored
// it, so a workspace that still has it tracks it in git and this scan must
// keep reading it.
const SKIP = SECRET_SCAN_SKIP_REL;
const TEXT_EXT = new Set(['.md', '.json', '.txt', '.yml', '.yaml', '.toml']);

function isSkipped(rel) {
  return isUnder(rel, SKIP);
}

// The owner's own selection of what the workspace is. Read here, not in the
// pure library; a missing or malformed config reads as no selection, and the
// scan covers everything exactly as it always did. Note this narrows only the
// filesystem walk: a tracked-file scan reads whatever git reports, because a
// secret committed to the repository is the repository's problem wherever it
// sits.
function readConfig(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8').replace(/^﻿/, '')); }
  catch { return {}; }
}
const SCOPE = scopeFrom(readConfig(root));

// A placeholder has the SHAPE of a secret slot, not of a secret: the vendor
// doc's `api_key=bbbbbb`, the wiki's `<SIFRE>`, the sample's `changeme`.
// 474 of Yusuf's 478 hits were these (P2-1) — a scan nobody reads protects nobody.
function isPlaceholder(rawValue) {
  const v = String(rawValue).trim().replace(/^["']|["']$/g, '');
  if (!v) return true;
  if (/^(.)\1+$/.test(v)) return true;                       // bbbbbb, xxxx, ******
  if (/^[<[{].*[>\]}]$/.test(v)) return true;                // <SIFRE>, [api_key], {token}
  if (/^\$\{?[A-Za-z0-9_]+\}?$/.test(v)) return true;         // $VAR, ${VAR}
  if (/^(YOUR|MY|EXAMPLE|SAMPLE|DUMMY|TEST|CHANGE|REPLACE|INSERT|TODO|PLACEHOLDER)[_-]/i.test(v)) return true;
  // Exact-word list: every entry here must be a word that CANNOT be a live
  // credential, not merely a word that often ISN'T one. "changeme",
  // "change-me", "password" and "secret" were deliberately dropped from this
  // list (review, 2026-08-31): they are dictionary words at the top of every
  // published weak-password list, and `password: password` / `secret: secret`
  // / `passwd: changeme` are real, working credentials — reporting them
  // clean is the exact failure this tool exists to prevent. Do not re-add
  // them "for symmetry" with `admin`; the same reasoning that keeps `admin`
  // out keeps these out too. A false negative here costs more than a false
  // positive.
  if (/^(redacted|masked|placeholder|todo|tbd|none|null|empty)$/i.test(v)) return true;
  return false;
}

// Returns null — not an empty array — when `git diff --cached` itself fails
// (not a repository, or git unavailable): the caller must exit 2, not treat
// "nothing staged" and "can't tell what's staged" as the same thing.
function stagedFiles() {
  const r = spawnSync('git', ['-C', root, 'diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter(Boolean);
}

// Returns null — not an empty array — whenever the tracked-file list would
// otherwise be empty, so the caller's `trackedFiles() || walkedFiles()` falls
// back to a real filesystem walk. `git ls-files` succeeds with empty stdout
// on a freshly `git init`-ed repository (nothing staged yet), and an empty
// array is truthy: without this, `files` would stop at `[]`, the scan loop
// never runs, and a workspace full of untracked secrets is reported clean.
// A scan that examined zero files must never report clean.
function trackedFiles() {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const files = r.stdout.split('\0').filter(Boolean);
  return files.length ? files : null;
}
function walkedFiles() {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (isSkipped(childRel) || !inScope(childRel, SCOPE)) continue;
      if (e.isDirectory()) {
        if (isHiddenForeignDir(e.name)) continue;
        walk(path.join(dir, e.name), childRel);
      } else out.push(childRel);
    }
  })(root, '');
  return out;
}

let files;
try {
  if (staged) {
    // `git diff --cached --name-only` reports paths relative to the
    // repository ROOT, not to `root` here — unlike `git ls-files` below,
    // which is cwd-relative and so already scoped correctly even when
    // nested. A workspace that is not its repository's own toplevel (nested
    // inside an ancestor repo, e.g. a `.joserah` folder living a few levels
    // under some other project's git root) would have every staged path
    // miss `path.join(root, rel)`, read as ENOENT, and get silently dropped
    // by the staged-deletion allowance below — scanning zero files while
    // reporting clean. "Cannot scan" must win over "clean" here too.
    if (!isOwnRepoRoot(root)) {
      console.error(`secret-scan: --staged requires ${root} to be a git repository's own toplevel ` +
        '— it is either not a repository at all, or nested inside an ancestor repository, in which ' +
        'case staged file paths would not resolve against it. Nothing was scanned.');
      process.exit(2);
    }
    const list = stagedFiles();
    if (list === null) {
      console.error('secret-scan: --staged needs a git repository — nothing was scanned.');
      process.exit(2);
    }
    files = list.filter((f) => !isSkipped(f) && TEXT_EXT.has(path.extname(f).toLowerCase()));
  } else {
    files = (trackedFiles() || walkedFiles())
      .filter((f) => !isSkipped(f) && TEXT_EXT.has(path.extname(f).toLowerCase()));
  }
} catch (err) {
  console.error(`secret-scan: cannot scan: ${err.message}`);
  process.exit(2);
}

let hits = 0;
const unreadable = [];
for (const rel of files) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, rel), 'utf8');
  } catch (err) {
    // `--staged` lists `git diff --cached --name-only`, which includes a
    // path staged for deletion — it has no working-tree content because the
    // owner deleted it on purpose, not because something went wrong. Skip it
    // silently rather than calling it unreadable, or a plain "delete a note,
    // stage it" turns into a false "exit 2, could not scan" for the backup
    // gate. Outside --staged, a tracked file missing from disk is exactly
    // the corruption case exit 2 exists to catch, so that path is untouched.
    if (staged && err.code === 'ENOENT') continue;
    unreadable.push(rel);
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [re] of SPECIFIC) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const value = m[3] !== undefined ? m[3] : m[0].replace(/^\S+\s+/, '');
        if (isPlaceholder(value)) {
          if (m[0].length === 0) re.lastIndex++;
          continue;
        }
        hits++;
        const shown = m[0].slice(0, 4) + '…[masked]';
        console.log(`${rel}:${i + 1}: ${shown}`);
        // A zero-length match would spin forever; none of SPECIFIC's
        // patterns can match empty, but advance defensively anyway.
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  });
}

for (const rel of unreadable) {
  console.error(`secret-scan: could not read ${rel} — treating the workspace as unscanned, not clean.`);
}

if (hits) {
  const noun = hits === 1 ? 'string' : 'strings';
  console.log(`\n${hits} credential-shaped ${noun} found. Move them to keys/ before any repository backup.`);
  process.exit(1);
}
if (unreadable.length) {
  process.exit(2);
}
console.log('No credential-shaped content found.');
