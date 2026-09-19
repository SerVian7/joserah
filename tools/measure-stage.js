#!/usr/bin/env node
/**
 * measure-stage.js — report what `git add -A` WOULD stage, before anything is
 * staged. `git add` writes blobs into .git/objects immediately, even if no
 * commit ever follows — measuring by staging is how a workspace ends up
 * carrying gigabytes of orphaned objects. This reads sizes from the working
 * tree instead and writes nothing.
 * Output: { files, totalBytes, over10MB: [{path, bytes}], nonText } — exit 0.
 * Exit 1: not a git repository (or git missing) — the caller must not guess.
 *
 * Known limitation (accepted, not a bug to fix here): `git status --porcelain
 * -z` emits a rename as `R  <new>` followed by the old path as its own
 * NUL-separated field. This loop has no rename awareness, so a rename can be
 * counted twice or a stale old path can be stat'd (and silently skipped when
 * it no longer exists). This tool is an advisory pre-flight measurement —
 * its failure mode is over-reporting, and the gate's response to anything
 * surprising is to stop and ask the owner, not to trust this to the byte. A
 * rename-aware parser was judged more code than the finding is worth.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isOwnRepoRoot } = require('./lib/git-root');

const root = path.resolve(process.argv[2] || process.cwd());
const TEXT_EXT = new Set(['.md', '.txt', '.json', '.yml', '.yaml', '.toml']);

// `git status --porcelain` reports paths relative to the repository ROOT,
// not to `root` here. A workspace nested inside an ancestor repository would
// have every path miss `path.join(root, rel)` below, get statSync'd as
// deleted (see the try/catch in the loop), and this would report an
// all-zero measurement as if the tree really were empty — the exact ancestor
// -repository defect this branch exists to prevent, reproduced inside the
// tool meant to guard against it. So: refuse up front, the same way "not a
// repository at all" already refuses below.
if (!isOwnRepoRoot(root)) {
  console.error(`measure-stage: ${root} is not a git repository's own toplevel — either not a ` +
    'repository at all, or nested inside an ancestor repository, in which case status paths would ' +
    'not resolve against it. Cannot measure.');
  process.exit(1);
}

const r = spawnSync('git',
  ['-C', root, 'status', '--porcelain', '-z', '--untracked-files=all'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) {
  console.error('measure-stage: not a git repository (or git unavailable) — cannot measure.');
  process.exit(1);
}

let files = 0, totalBytes = 0, nonText = 0;
const over10MB = [];
for (const entry of r.stdout.split('\0').filter(Boolean)) {
  // porcelain -z: "XY <path>"; renames emit the target as the next NUL field,
  // which this loop naturally sees as its own entry.
  const rel = entry.length > 3 && entry[2] === ' ' ? entry.slice(3) : entry;
  const abs = path.join(root, rel);
  let st;
  try { st = fs.statSync(abs); } catch { continue; } // deleted — nothing to stage from the tree
  if (!st.isFile()) continue;
  files++;
  totalBytes += st.size;
  if (st.size > 10 * 1048576) over10MB.push({ path: rel, bytes: st.size });
  if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) nonText++;
}
console.log(JSON.stringify({ files, totalBytes, over10MB, nonText }));
