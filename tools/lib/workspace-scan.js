'use strict';
/**
 * Enumerate the markdown files a migration may touch in one workspace.
 *
 * Two kinds of exclusion, and they are different in kind:
 *  - IMMUTABILITY: raw/ is source material the AI never writes; directives.md
 *    is the workspace's own standing rules and survives every plugin update;
 *    keys/ is secret.
 *  - OWNERSHIP: projects/ and docker-stack/ belong to other repos, and a
 *    nested .joserah/config.json is somebody else's workspace, which migrates
 *    on its own update and never at a neighbour's hand. .claude/ is Claude
 *    Code's own agent, command and skill definitions — not the owner's prose,
 *    and not this plugin's to splice frontmatter into.
 */
const fs = require('fs');
const path = require('path');

const SKIP_DIR_ANY = new Set(['.git', 'node_modules', '.venv', 'dist', 'build', '.superpowers']);
const SKIP_REL = [
  'keys', 'projects', 'docker-stack', '.claude',
  '.joserah/knowledge/raw', '.joserah/tools', '.joserah/last-time-inject',
];
const SKIP_FILE_REL = new Set(['.joserah/directives.md']);

function isSkippedRel(rel) {
  const low = rel.toLowerCase();
  return SKIP_REL.some((p) => low === p || low.startsWith(p + '/'));
}

function scanWorkspace(root) {
  const files = [];
  const boundaries = [];

  function walk(absDir, rel) {
    for (const e of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR_ANY.has(e.name) || isSkippedRel(childRel)) continue;
        // A nested workspace is a boundary, never a subtree to migrate. `abs`
        // is always a child of `root` here, so this can never mistake the
        // root for its own nested workspace — no `rel !== ''` guard needed.
        if (fs.existsSync(path.join(abs, '.joserah', 'config.json'))) {
          boundaries.push(childRel);
          continue;
        }
        walk(abs, childRel);
      } else if (e.name.toLowerCase().endsWith('.md')) {
        if (SKIP_FILE_REL.has(childRel) || isSkippedRel(childRel)) continue;
        files.push(childRel);
      }
    }
  }

  walk(path.resolve(root), '');
  return { files, boundaries };
}

module.exports = { scanWorkspace };
