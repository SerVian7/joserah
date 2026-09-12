#!/usr/bin/env node
/**
 * relocate.js — bring a workspace's source material to today's layout with one
 * command, whichever historical location it is frozen at.
 *
 *   .joserah/knowledge/raw/    (before 2026-08-31)  --leg 1-->  raw/
 *   raw/ at the workspace root (before 2026-09-12)  --leg 2-->  imports/
 *
 * A driver, not a rewrite. Each leg keeps its own recovery semantics —
 * relocate-raw.js reports which entries moved and whether a re-run is safe or
 * will be refused by design, and that message is the one the owner acts on, so
 * it is passed through unchanged rather than summarised.
 *
 * Usage: node relocate.js <workspace-root> [--dry-run]
 * Exit 0 = the workspace is at today's layout (possibly by doing nothing).
 * Exit 1 = a leg failed, or <root> is not a Joserah workspace.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());

if (!fs.existsSync(path.join(root, '.joserah', 'config.json'))) {
  console.error(`relocate: ${root} is not a Joserah workspace`);
  process.exit(1);
}

function runLeg(tool) {
  const r = spawnSync(process.execPath,
    [path.join(__dirname, tool), root, ...(dryRun ? ['--dry-run'] : [])], { encoding: 'utf8' });
  if (r.stderr) process.stderr.write(r.stderr);
  let out = null;
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  if (last) { try { out = JSON.parse(last); } catch { out = null; } }
  return { tool, status: r.status, out };
}

const num = (leg, key) => (leg.out && typeof leg.out[key] === 'number' ? leg.out[key] : 0);

const legs = [];
const one = runLeg('relocate-raw.js');
legs.push(one);
if (one.status !== 0) {
  console.log(JSON.stringify({ ok: false, dryRun, failedAt: one.tool, legs }));
  process.exit(1);
}

// In a real run leg 1 has just created root raw/ and leg 2 moves it on. In a
// --dry-run nothing moved, so on a workspace still at the oldest layout leg 2
// would look at an absent raw/ and report "nothing to do" — which would be a
// preview of the wrong thing. Say that instead of printing it.
let two;
if (dryRun && !fs.existsSync(path.join(root, 'raw'))) {
  two = { tool: 'relocate-imports.js', status: 0, out: null,
    skipped: 'runs after relocate-raw.js; nothing at raw/ yet, so this leg cannot be previewed' };
} else {
  two = runLeg('relocate-imports.js');
}
legs.push(two);
if (two.status !== 0) {
  console.log(JSON.stringify({ ok: false, dryRun, failedAt: two.tool, legs }));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  dryRun,
  moved: legs.some((l) => l.out && l.out.moved === true),
  linksRewritten: num(one, 'linksRewritten') + num(two, 'linksRewritten'),
  notesTouched: num(one, 'notesTouched') + num(two, 'notesTouched'),
  flattened: num(two, 'flattened'),
  preservedReadme: (one.out && one.out.preservedReadme) || null,
  legs,
}));
