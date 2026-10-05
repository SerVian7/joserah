#!/usr/bin/env node
/**
 * sync.js — the start and the end of every session in this memory.
 * Usage: node tools/sync.js                   pull (rebase), then say the sweep-due line if due
 *        (the pull also prints one checks line: broken links, malformed claim lines, and a
 *        projects line when a knowledge page carries repo: — tools/project-drift.js)
 *        node tools/sync.js --push [--who X]  commit members/<me>/, inbox/ and questions/, then push
 *        node tools/sync.js --push --sweep    the sweeper after a sweep: commit everything, then push
 *        node tools/sync.js --redo            after a conflict (exit 4): take the remote's state, keep your
 *                                             commits on a redo-<time> branch, bring back your own files,
 *                                             and list the notes whose ingest must be re-applied
 *
 * Continuous recording (.memory/config.json "recording": "continuous", RECORDING.md): --push also
 * stages knowledge/, regenerates knowledge/index.md and refuses the push until
 * "node tools/ingest.js check" passes. A pull that hits a real conflict never leaves the clone
 * mid-rebase: the rebase is aborted, the files are named, and sync exits 4.
 *
 * --push first prints a "Push notice" naming its target (shared memory <folder> and
 * its origin URL) and every file about to go out, one line each, then exits 3. The
 * assistant shows that list to the member, waits for their yes, and only then runs
 * the same command again with --yes.
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
const { driftLine } = require('./project-drift');
const ingest = require('./ingest');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
function die(msg, code = 1) { console.error(`sync: ${msg}`); process.exit(code); }
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(root, '.memory', 'config.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* reported by doctor */ }
const continuous = cfg.recording === 'continuous';
const rebasing = () => ['rebase-merge', 'rebase-apply'].some((d) => fs.existsSync(path.resolve(root, git('rev-parse', '--git-path', d).stdout.trim())));

const hasUpstream = git('rev-parse', '--abbrev-ref', '@{u}').status === 0;
const hasOrigin = git('remote', 'get-url', 'origin').status === 0;
// The push target, named in every notice and report: "shared memory <folder name>".
const target = `shared memory ${path.basename(root)}`;
const originUrl = hasOrigin ? git('remote', 'get-url', 'origin').stdout.trim() : 'no remote';
function pull() {
  if (!hasUpstream) return 'no remote to pull from';
  const before = git('rev-parse', 'HEAD').stdout.trim();
  const r = git('pull', '--rebase', '--autostash', '--quiet');
  if (r.status !== 0) {
    if (!rebasing()) die(`pull failed — ${(r.stderr || r.stdout).trim()}`);
    // Someone pushed a change to the same lines first: abort, never leave a half state.
    const files = git('diff', '--name-only', '--diff-filter=U').stdout.split(/\r?\n/).filter(Boolean);
    git('rebase', '--abort');
    die(`conflict with the remote on: ${files.join(', ') || '(unknown files)'} — your commit is kept, nothing was pushed. ` +
      'Run node tools/sync.js --redo, then re-apply the notes it lists onto the fresh pages (RECORDING.md §3).', 4);
  }
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
    const fm = (k) => ((new RegExp('^' + k + ':[ \\t]*(.+)$', 'm').exec(head) || [])[1] || '').trim();
    const line = `  questions/${f} - ${((/## Question\s+([^\n]+)/.exec(text) || [])[1] || f).slice(0, 80)}`;
    if (fm('to') === me && fm('status') === 'open') open.push(line);
    if (fm('from') === me && fm('status') === 'answered') answered.push(line);
  }
  return [`Questions for ${me}: ${open.length} open`, ...open, `Answers to your questions: ${answered.length}`, ...answered];
}

if (flag('--redo')) redo();

if (!flag('--push')) {
  console.log(pull());
  if (continuous && ingest.writeIndex(root)) console.log('index: regenerated after the pull — it goes out with your next push');
  console.log(checks());
  // Project pages against their repos' HEAD (.memory/repos.json); a report, never a failure.
  try { const d = driftLine(root); if (d) console.log(d); } catch { /* the pull still stands */ }
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
  if (continuous) ingest.writeIndex(root);
  for (const p of [path.join('members', me), 'inbox', 'questions', 'AGENTS.md', 'README.md', 'RECORDING.md', 'tools', ...(continuous ? ['knowledge'] : [])]) {
    if (fs.existsSync(path.join(root, p))) git('add', '--', p);
  }
}
// Continuous recording: the gate runs before anything is shown or committed.
if (continuous) {
  const r = ingest.check(root, me);
  if (r.errors.length) { console.log(ingest.checkLine(r)); process.exit(1); }
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
    `Show this list to the member in their language and wait for their yes; only then run the same command again with --yes.`);
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
  // Both sides' index lines survive a union merge; the generated list is put right before it leaves.
  if (continuous && ingest.writeIndex(root)) {
    git('add', '--', ingest.INDEX);
    git('commit', '-q', '-m', `${me}: index`);
  }
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

/** --redo: after a conflict, re-derive instead of hand-merging (RECORDING.md §3). */
function redo() {
  const who = detectMember(root);
  if (!who) die('who is this? write your first name, lowercase, into .memory/me');
  if (!hasUpstream) die('nothing to redo against: no remote');
  if (git('status', '--porcelain', '--untracked-files=no').stdout.trim()) die('uncommitted changes — push them first (node tools/sync.js --push), then --redo');
  const f = git('fetch', '--quiet');
  if (f.status !== 0) die(`fetch failed — ${(f.stderr || f.stdout).trim()}`);
  if (git('rev-list', '--count', '@{u}..HEAD').stdout.trim() === '0') { console.log('nothing to redo: no commit of yours waits to be pushed'); process.exit(0); }
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const backup = `redo-${stamp}`;
  if (git('branch', backup, 'HEAD').status !== 0) die(`could not keep your commits on ${backup}`);
  const fork = git('merge-base', 'HEAD', '@{u}').stdout.trim();
  const mine = git('diff', '--name-only', `${fork}..${backup}`).stdout.split(/\r?\n/).filter(Boolean)
    .filter((p) => p.startsWith(`members/${who}/`) || p.startsWith('inbox/') || p.startsWith('questions/'));
  const had = new Set(ingest.parseLog(git('show', `${fork}:${ingest.LOG}`).stdout || '').map((e) => e.block));
  const redoList = ingest.parseLog(git('show', `${backup}:${ingest.LOG}`).stdout || '').filter((e) => !had.has(e.block));
  const r = git('reset', '--hard', '--quiet', '@{u}');
  if (r.status !== 0) die(`reset failed — ${(r.stderr || r.stdout).trim()}; your commits are on ${backup}`);
  for (const p of mine) {
    if (git('cat-file', '-e', `${backup}:${p}`).status === 0) git('checkout', backup, '--', p);
    else if (fs.existsSync(path.join(root, p))) git('rm', '-q', '--', p);
  }
  console.log(`redo: the clone is on the remote's state; your commits are kept on branch ${backup}`);
  console.log(`kept: ${mine.length} file(s) of yours${mine.length ? ' — ' + mine.join(', ') : ''}`);
  for (const e of redoList.filter((x) => x.op === 'ingest' || x.op === 'fix')) {
    console.log(`re-apply: ${e.title} — source ${e.source || '(none)'} — touched ${e.touched.join(', ') || '(none)'}`);
  }
  process.exit(0);
}
