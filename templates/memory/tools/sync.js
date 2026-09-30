#!/usr/bin/env node
/**
 * sync.js — the start and the end of every session in this memory.
 * Usage: node tools/sync.js                   pull (rebase), then say the sweep-due line if due
 *        (the pull also prints one checks line: broken links, malformed claim lines)
 *        node tools/sync.js --push [--who X]  commit members/<me>/, inbox/ and questions/, then push
 *        node tools/sync.js --push --sweep    the sweeper after a sweep: commit everything, then push
 *
 * --push first prints a "Push notice" naming its target (shared memory <folder> and
 * its origin URL) and every file about to go out, one line each, then exits 3. The
 * assistant shows that list to the member and runs the same command again with --yes;
 * it waits for the member only when the list holds a deletion or a file outside
 * members/<me>/, inbox/ and questions/.
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
const { brokenLinks } = require('./verify-links');
const { checkClaims } = require('./claims');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
function die(msg) { console.error(`sync: ${msg}`); process.exit(1); }

const hasUpstream = git('rev-parse', '--abbrev-ref', '@{u}').status === 0;
const hasOrigin = git('remote', 'get-url', 'origin').status === 0;
// The push target, named in every notice and report: "shared memory <folder name>".
const target = `shared memory ${path.basename(root)}`;
const originUrl = hasOrigin ? git('remote', 'get-url', 'origin').stdout.trim() : 'no remote';
function pull() {
  if (!hasUpstream) return 'no remote to pull from';
  const before = git('rev-parse', 'HEAD').stdout.trim();
  const r = git('pull', '--rebase', '--autostash', '--quiet');
  if (r.status !== 0) die(`pull failed — ${(r.stderr || r.stdout).trim()}`);
  const n = git('rev-list', '--count', `${before}..HEAD`).stdout.trim();
  return n === '0' ? 'up to date' : `pulled ${n} commit(s)`;
}

// Links and claim lines, checked after every pull; a finding is told, never a reason to fail.
function checks() {
  try {
    const links = brokenLinks(root), claims = checkClaims(root);
    if (!links.length && !claims.errors.length) return `checks: links ok, claims ${claims.total} ok`;
    return `checks: ${links.length} broken link(s), ${claims.errors.length} claim error(s) — node tools/verify-links.js / node tools/claims.js`;
  } catch (e) { return `checks: could not run (${e.message})`; }
}

// questions/<date>-<from>-<to>-<slug>.md: frontmatter from, to, status open|answered, then "## Question".
function questions(me) {
  const dir = path.join(root, 'questions');
  const open = [], answered = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.md')) : []) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r/g, '');
    const head = (/^---\n([\s\S]*?)\n---/.exec(text) || [])[1] || '';
    const fm = (k) => ((new RegExp('^' + k + ':\s*(.+)$', 'm').exec(head) || [])[1] || '').trim();
    const line = `  questions/${f} - ${((/## Question\s+([^\n]+)/.exec(text) || [])[1] || f).slice(0, 80)}`;
    if (fm('to') === me && fm('status') === 'open') open.push(line);
    if (fm('from') === me && fm('status') === 'answered') answered.push(line);
  }
  return [`Questions for ${me}: ${open.length} open`, ...open, `Answers to your questions: ${answered.length}`, ...answered];
}

if (!flag('--push')) {
  console.log(pull());
  console.log(checks());
  const line = sweepLine(sweepState(root));
  if (line) console.log(line);
  const who = detectMember(root);
  if (who) console.log(questions(who).join('\n'));
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
  // AGENTS.md, README.md and tools/ arrive from --refresh-memory; a member's push carries them too.
for (const p of [path.join('members', me), 'inbox', 'questions', 'AGENTS.md', 'README.md', 'tools']) {
    if (fs.existsSync(path.join(root, p))) git('add', '--', p);
  }
}
// The notice: staged files plus commits not yet pushed, against where we diverged from the remote.
const base = hasUpstream ? git('merge-base', 'HEAD', '@{u}').stdout.trim() : 'HEAD';
const changes = git('diff', '--cached', '--name-status', base).stdout.split(/\r?\n/).filter(Boolean).map((l) => {
  const [st, ...f] = l.split('\t');
  const file = f[f.length - 1];
  const status = st[0] === 'A' ? 'added' : st[0] === 'D' ? 'deleted' : 'modified';
  let what = '';
  try { what = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).map((x) => x.replace(/^#+\s*/, '').trim()).find(Boolean) || ''; } catch { /* deleted */ }
  const refresh = /^(AGENTS\.md|README\.md|tools\/)/.test(file) ? ' (refresh)' : '';
  return `  ${file} (${status})${what ? ` - ${what.slice(0, 80)}` : ''}${refresh}`;
});
if (!changes.length && (!hasUpstream || git('rev-list', '--count', '@{u}..HEAD').stdout.trim() === '0')) {
  console.log('nothing new to push');
  process.exit(0);
}
if (!flag('--yes')) {
  console.log(`Push notice — ${target} (${originUrl}): ${changes.length} file(s)\n${changes.join('\n')}\n` +
    `Show this list to the member in their language, then run the same command again with --yes; wait for them only when it holds a deletion or a file outside members/${me}/, inbox/ and questions/.`);
  process.exit(3);
}
const staged = git('diff', '--cached', '--quiet').status !== 0;
if (staged) {
  const c = git('commit', '-q', '-m', subject);
  if (c.status !== 0) die(`commit failed — ${(c.stderr || c.stdout).trim()}`);
}
let pushed = `committed locally, not pushed (no remote configured for ${target})`;
if (hasUpstream) {
  pull();
  const p = git('push', '--quiet');
  if (p.status !== 0) die(`push failed — ${(p.stderr || p.stdout).trim()}`);
  pushed = `pushed to ${target}`;
} else if (hasOrigin) {
  const p = git('push', '--quiet', '-u', 'origin', 'HEAD');
  if (p.status !== 0) die(`push failed — ${(p.stderr || p.stdout).trim()}`);
  pushed = `pushed to ${target}`;
}
const head = git('rev-parse', '--short', 'HEAD').stdout.trim();
console.log(staged ? `${pushed}: ${head} ${subject}` : `nothing new to commit; ${pushed}`);
