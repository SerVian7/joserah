'use strict';
/**
 * Enumerate the markdown files a migration may touch in one workspace.
 *
 * Three kinds of exclusion, and they are different in kind:
 *  - IMMUTABILITY: imports/ (formerly raw/) is source material the AI never
 *    writes; user/ is the
 *    drop folder the install skill tells owners to leave a CV or a bio in, so
 *    it is source material of exactly the same kind; directives.md is the
 *    workspace's own standing rules and survives every plugin update; keys/
 *    is secret. feedback/ holds notes that are published verbatim as public
 *    GitHub issues, and its filenames are the one string the identifier scan
 *    never reads — a migration that titled such a note from its slug, or
 *    appended `- mentions [[Some Entity]]` to it, would send the owner's data
 *    to a public issue tracker under a heading promising nothing was found.
 *  - OWNERSHIP: projects/ and docker-stack/ belong to other repos, and a
 *    nested .joserah/config.json is somebody else's workspace, which migrates
 *    on its own update and never at a neighbour's hand. .claude/ is Claude
 *    Code's own agent, command and skill definitions — not the owner's prose,
 *    and not this plugin's to splice frontmatter into.
 *  - PLUGIN-OWNERSHIP (R19): the workspace-root AGENTS.md, the workspace-root
 *    JOSERAH-ROLE.md and .joserah/agent.md are files the plugin itself writes
 *    and, in two of the three cases, later compares byte-for-byte — AGENTS.md
 *    is replaced wholesale on every update and must be identical everywhere,
 *    JOSERAH-ROLE.md is checked by doctor.js against its role template. They
 *    are not the owner's prose, so migrate must never add frontmatter to
 *    them; a prior version of this tool did, and a second migration run over
 *    a workspace holding all three then failed doctor on the very files it
 *    had just carried forward. Anchored to the workspace root by relative
 *    path, not by bare filename, so `keys/AGENTS.md` and `projects/AGENTS.md`
 *    — already out of scan through their directory rules above — are never
 *    mistaken for this one, and a same-named file elsewhere in the tree
 *    (e.g. an ordinary note that happens to be called AGENTS.md) still scans
 *    normally.
 */
const fs = require('fs');
const path = require('path');
const { MIGRATION_SKIP_NAMES, MIGRATION_SKIP_REL, isUnder,
  isHiddenForeignDir, scopeFrom, inScope } = require('./untouchable');

// The two directory sets are composed in lib/untouchable.js, the one place
// that states which paths a tool may not walk; the reasons for this tool's
// share of them are the three kinds of exclusion above.
const SKIP_DIR_ANY = new Set(MIGRATION_SKIP_NAMES);
const SKIP_REL = MIGRATION_SKIP_REL;
const SKIP_FILE_REL = new Set([
  '.joserah/directives.md',
  'AGENTS.md',
  'JOSERAH-ROLE.md',
  '.joserah/agent.md',
  // 0.13.3: the plugin's stub or an owner's file for Claude Code — a tool's
  // configuration either way, never a note to give frontmatter to.
  'CLAUDE.md',
]);

// untouchable.js stays pure, so the owner's own `scope` selection is read
// here. A missing or malformed config reads as no selection — everything
// under the root — so a walk is never broken by the marker file.
function readConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.joserah', 'config.json'), 'utf8').replace(/^﻿/, '')); }
  catch { return {}; }
}

function scanWorkspace(root) {
  const files = [];
  const boundaries = [];
  const absRoot = path.resolve(root);
  const scope = scopeFrom(readConfig(absRoot));
  const isSkippedRel = (rel) => isUnder(rel, SKIP_REL) || !inScope(rel, scope);

  function walk(absDir, rel) {
    for (const e of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR_ANY.has(e.name) || isHiddenForeignDir(e.name) || isSkippedRel(childRel)) continue;
        // A nested workspace is a boundary, never a subtree to migrate. `abs`
        // is always a child of `root` here, so this can never mistake the
        // root for its own nested workspace — no `rel !== ''` guard needed.
        if (fs.existsSync(path.join(abs, '.joserah', 'config.json'))) {
          boundaries.push(childRel);
          continue;
        }
        // A LICENSE beside the files marks a vendored copy, not the owner's notes.
        if (fs.readdirSync(abs).some((n) => /^licen[cs]e(\.|$)/i.test(n))) continue;
        walk(abs, childRel);
      } else if (e.name.toLowerCase().endsWith('.md')) {
        if (SKIP_FILE_REL.has(childRel) || isSkippedRel(childRel)) continue;
        files.push(childRel);
      }
    }
  }

  walk(absRoot, '');
  return { files, boundaries };
}

module.exports = { scanWorkspace };
