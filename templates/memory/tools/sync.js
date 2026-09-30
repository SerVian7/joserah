#!/usr/bin/env node
/**
 * sync.js — the start and the end of every session in this memory.
 * Usage: node tools/sync.js                   pull (rebase), then say the sweep-due line if due
 *        node tools/sync.js --push [--who X]  commit members/<me>/ and inbox/, then push
 *        node tools/sync.js --push --sweep    the sweeper after a sweep: commit everything, then push
 *
 * A member's commit carries only their own folder and the inbox, so two members
 * never touch the same file; anything else stays unstaged. Commit subjects start
 * with "<member>:" — doctor reads that to see who wrote what.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { detectMember } = require('./detect-member');
const { sweepState, sweepLine } = require('./sweep-due');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
function die(msg) { console.error(`sync: ${msg}`); process.exit(1); }

const hasUpstream = git('rev-parse', '--abbrev-ref', '@{u}').status === 0;
const hasOrigin = git('remote', 'get-url', 'origin').status === 0;
function pull() {
  if (!hasUpstream) return 'no remote to pull from';
  const before = git('rev-parse', 'HEAD').stdout.trim();
  const r = git('pull', '--rebase', '--autostash', '--quiet');
  if (r.status !== 0) die(`pull failed — ${(r.stderr || r.stdout).trim()}`);
  const n = git('rev-list', '--count', `${before}..HEAD`).stdout.trim();
  return n === '0' ? 'up to date' : `pulled ${n} commit(s)`;
}

if (!flag('--push')) {
  console.log(pull());
  const line = sweepLine(sweepState(root));
  if (line) console.log(line);
  process.exit(0);
}

const whoAt = args.indexOf('--who');
const me = whoAt !== -1 ? args[whoAt + 1] : detectMember(root);
if (!me) die('who is this? write your first name, lowercase, into .memory/me');
const today = new Date().toISOString().slice(0, 10);
let subject = `${me}: ${today}`;
if (flag('--sweep')) {
  const { sweeper } = JSON.parse(fs.readFileSync(path.join(root, '.memory', 'config.json'), 'utf8'));
  if (me !== sweeper) die(`only the sweeper (${sweeper}) commits a sweep; you are ${me}`);
  git('add', '-A');
  subject = `${me}: sweep ${today}`;
} else {
  for (const p of [path.join('members', me), 'inbox']) {
    if (fs.existsSync(path.join(root, p))) git('add', '--', p);
  }
}
const staged = git('diff', '--cached', '--quiet').status !== 0;
if (staged) {
  const c = git('commit', '-q', '-m', subject);
  if (c.status !== 0) die(`commit failed — ${(c.stderr || c.stdout).trim()}`);
}
let pushed = 'committed locally, no remote configured';
if (hasUpstream) {
  pull();
  const p = git('push', '--quiet');
  if (p.status !== 0) die(`push failed — ${(p.stderr || p.stdout).trim()}`);
  pushed = 'pushed';
} else if (hasOrigin) {
  const p = git('push', '--quiet', '-u', 'origin', 'HEAD');
  if (p.status !== 0) die(`push failed — ${(p.stderr || p.stdout).trim()}`);
  pushed = 'pushed';
}
console.log(staged ? `${pushed}: ${subject}` : `nothing new to commit; ${pushed}`);
