#!/usr/bin/env node
/**
 * verify-links.js — internal link checker.
 * Scans .md files under the given directory (default: cwd), extracts relative
 * markdown links, and verifies each target exists.
 * Exit 0 = all links resolve. Exit 1 = broken links listed on stdout.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'site-packages', 'dist', 'build', 'keys',
]);

function* mdFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* mdFiles(path.join(dir, e.name));
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

const LINK_RE = /\]\(([^)\s]+)\)/g;
const broken = [];

for (const file of mdFiles(ROOT)) {
  const lines = stripCode(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LINK_RE)) {
      let target = m[1];
      if (/^(https?:|mailto:|tel:|#)/i.test(target)) continue;
      target = decodeURIComponent(target.split('#')[0]);
      if (!target) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
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
