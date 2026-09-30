#!/usr/bin/env node
/**
 * sweep.js — the mechanical part of the sweep, for the sweeper. No Joserah needed.
 *   node tools/sweep.js --before   counts the claim lines of every inbox/*.md, stores them in .memory/sweep-state.json
 *   node tools/sweep.js --after    runs claims.js and verify-links.js; every stored claim line must stand in
 *                                  knowledge/ verbatim (whitespace-normalised, struck ones count); exit 1 names
 *                                  the missing ones; on success stamps lastSweep (sweep-due.js --stamp)
 * Nothing here pushes. Node built-ins only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, '.memory', 'sweep-state.json');
const CLAIM = /^\s*-\s+\[(?:measurement|calculation|decision|estimate)\]\s+.+$/;
const norm = (s) => s.trim().replace(/\s+/g, ' ');
const run = (script, args = []) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8' });
const claimLines = (text) => text.split(/\r?\n/).filter((l) => CLAIM.test(l)).map(norm);

function* mdFiles(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* mdFiles(p);
    else if (e.name.toLowerCase().endsWith('.md')) yield p;
  }
}

const mode = process.argv[2];
if (mode === '--before') {
  const files = fs.existsSync(path.join(ROOT, 'inbox')) ? fs.readdirSync(path.join(ROOT, 'inbox')).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, 'inbox', f)) : [];
  const count = Number(run('claims.js', ['--count', ...files]).stdout.trim()) || 0;
  const claims = files.flatMap((f) => claimLines(fs.readFileSync(f, 'utf8')));
  for (const f of files) console.log(`${path.basename(f)}: ${run('claims.js', ['--count', f]).stdout.trim()}`);
  console.log(`inbox: ${files.length} files, ${count} claim lines`);
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ count, claims }, null, 2) + '\n');
} else if (mode === '--after') {
  let state;
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { console.error('sweep: run --before first (no .memory/sweep-state.json)'); process.exit(1); }
  let bad = false;
  for (const [script, label] of [['claims.js', 'claim lines'], ['verify-links.js', 'links']]) {
    const r = run(script);
    process.stdout.write(r.stdout);
    if (r.status !== 0) { bad = true; console.log(`sweep: ${label} not clean`); }
  }
  const have = new Set([...mdFiles(path.join(ROOT, 'knowledge'))].flatMap((f) => claimLines(fs.readFileSync(f, 'utf8'))));
  const missing = state.claims.filter((l) => !have.has(l));
  const carried = state.claims.length - missing.length;
  console.log(missing.length ? `claims: ${carried}/${state.count} carried — ${missing.length} missing:` : `claims: ${carried}/${state.count} carried`);
  for (const l of missing) console.log('  ' + (/\]\s+(.+?)\s+->/.exec(l) || [, l])[1]);
  if (missing.length || bad) process.exit(1);
  process.stdout.write(run('sweep-due.js', ['--stamp']).stdout);
} else {
  console.error('usage: node tools/sweep.js --before | --after');
  process.exit(1);
}
