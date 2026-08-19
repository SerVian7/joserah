#!/usr/bin/env node
/**
 * secret-scan.js — find credential-shaped content in a workspace's text files
 * before it is committed or pushed. Filename-level exclusions (keys/, .env)
 * keep credential FILES out of git; this catches credentials pasted INTO
 * notes. Exit 0 clean, 1 hits found, 2 could not scan.
 * Output masks every match: first 4 chars + "…[masked]".
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SPECIFIC } = require('../hooks/lib/redactions');

const root = path.resolve(process.argv[2] || process.cwd());
const SKIP = ['keys', '.joserah/keys', 'projects', 'docker-stack', 'node_modules', '.git'];
const TEXT_EXT = new Set(['.md', '.json', '.txt', '.yml', '.yaml', '.toml']);

function isSkipped(rel) {
  const low = rel.split(path.sep).join('/').toLowerCase();
  return SKIP.some((p) => low === p || low.startsWith(p + '/'));
}

function trackedFiles() {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter(Boolean);
}
function walkedFiles() {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (isSkipped(childRel)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), childRel);
      else out.push(childRel);
    }
  })(root, '');
  return out;
}

let files;
try {
  files = (trackedFiles() || walkedFiles())
    .filter((f) => !isSkipped(f) && TEXT_EXT.has(path.extname(f).toLowerCase()));
} catch (err) {
  console.error(`secret-scan: cannot scan: ${err.message}`);
  process.exit(2);
}

let hits = 0;
for (const rel of files) {
  let text;
  try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [re] of SPECIFIC) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) {
        hits++;
        const shown = m[0].slice(0, 4) + '…[masked]';
        console.log(`${rel}:${i + 1}: ${shown}`);
      }
    }
  });
}
if (hits) {
  console.log(`\n${hits} credential-shaped string(s) found. Move them to keys/ before any repository backup.`);
  process.exit(1);
}
console.log('No credential-shaped content found.');
