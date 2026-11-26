#!/usr/bin/env node
/**
 * sweep-scope.js — which of the owner's notes and records a sweep has to read.
 * backup-scope.js --changed-since prints a count from a date and no list; this
 * prints the list, by content, so a sweep reads what changed and nothing else.
 *
 *   node sweep-scope.js <workspace> list [--seed-commit <rev> | --seed-last-sweep <ISO-8601> | --seed-since <ISO-8601>]
 *   node sweep-scope.js <workspace> stamp [--wrote <path> ...]
 *
 * `list` prints the notes and records (markdown under knowledge, personal, the
 * journal, the inbox and tasks) whose content differs from the ledger, or that
 * are new, one workspace-relative path per line; nothing else is ever listed
 * (crew logs, artifacts, job files, source material).
 * `stamp` records what `list` saw, plus what the sweep itself wrote (--wrote:
 * stamped as they stand now, so they never come back). Run it only after the
 * sweep's finishing checks pass. A file changed between `list` and `stamp` is
 * not stamped, so it is listed next time.
 *
 * The ledger is .joserah/desk/sweep-ledger.json. With no ledger the first
 * `list` needs a seed: --seed-commit lists the in-scope files that differ from
 * that commit (working tree and untracked included); --seed-last-sweep <the last
 * sweep's stamp> takes the sweep's own commit as that commit when there is one, else
 * falls to the date rule; --seed-since uses the
 * rule backup-scope.js has today (committed after the instant plus uncommitted
 * now; file times outside a repository). A ledger, once there, ignores seeds.
 *
 * Exit 0 · 2 the tool could not run (same meaning as backup-scope.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { JUNK_NAMES, SOURCE_MATERIAL_REL, isUnder, isHiddenForeignDir } = require('./lib/untouchable');
const { isOwnRepoRoot } = require('./lib/git-root');

const ROOTS = ['.joserah/knowledge', '.joserah/personal', '.joserah/desk/daily',
  '.joserah/desk/inbox', '.joserah/desk/tasks'];
const LEDGER_REL = '.joserah/desk/sweep-ledger.json';

function die(msg) { console.error(`sweep-scope: ${msg}`); process.exit(2); }

const hashOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const abs = (root, rel) => path.join(root, ...rel.split('/'));

function inList(rel) {
  return /\.md$/i.test(rel) && !isUnder(rel, SOURCE_MATERIAL_REL)
    && ROOTS.some((r) => isUnder(rel, [r]));
}

// rel -> content hash, for every file the sweep may read right now.
function current(root) {
  const out = new Map();
  (function walk(rel) {
    let entries;
    try { entries = fs.readdirSync(abs(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!JUNK_NAMES.includes(e.name) && !isHiddenForeignDir(e.name) && !isUnder(child, SOURCE_MATERIAL_REL)) walk(child);
      } else if (e.isFile() && inList(child)) {
        try { out.set(child, hashOf(abs(root, child))); } catch { /* vanished mid-walk */ }
      }
    }
  })('.joserah');
  return out;
}

function readLedger(root) {
  let text;
  try { text = fs.readFileSync(abs(root, LEDGER_REL), 'utf8'); } catch { return null; }
  try {
    const led = JSON.parse(text);
    if (led && typeof led.files === 'object' && led.files) return led;
  } catch { /* fall through */ }
  die(`${LEDGER_REL} is not readable (delete it to start from a seed)`);
}

function writeLedger(root, led) {
  const f = abs(root, LEDGER_REL);
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  const body = { version: 1, files: sorted(led.files) };
  if (led.stamped) body.stamped = true;
  if (led.seeded) body.seeded = [...led.seeded].sort();
  if (led.pending) body.pending = { files: sorted(led.pending.files) };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(body, null, 1) + '\n');
  fs.renameSync(f + '.tmp', f);
}

// ------------------------------------------------------------------ seeds

const gitOut = (root, args) => spawnSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });

function seedFromCommit(root, rev) {
  if (!isOwnRepoRoot(root)) die(`--seed-commit needs ${root} to be a git repository of its own`);
  const ok = gitOut(root, ['rev-parse', '--verify', '-q', `${rev}^{commit}`]);
  if (ok.status !== 0) die(`"${rev}" is not a commit of this repository`);
  const diff = gitOut(root, ['diff', '--name-only', '-z', rev, '--']);
  const untracked = gitOut(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (diff.status !== 0 || untracked.status !== 0) die('git could not answer');
  return new Set([...diff.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean));
}

// backup-scope.js's changedFromGit / mtime rule, kept in step by hand: that file
// runs its CLI on load and the backup skill depends on it as it is.
function seedFromDate(root, iso, cur) {
  const since = new Date(iso).getTime();
  if (!Number.isFinite(since)) die(`"${iso}" is not a date this tool can read (use an ISO-8601 instant)`);
  if (isOwnRepoRoot(root)) {
    const paths = new Set();
    if (gitOut(root, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0) {
      const log = gitOut(root, ['log', `--since=${iso}`, '--name-only', '--pretty=format:']);
      if (log.status === 0) for (const l of log.stdout.split(/\r?\n/)) if (l) paths.add(l);
    }
    const st = gitOut(root, ['status', '--porcelain', '-z', '--untracked-files=all']);
    if (st.status === 0) {
      const ent = st.stdout.split('\0');
      for (let i = 0; i < ent.length; i++) {
        if (ent[i].length < 4) continue;
        paths.add(ent[i].slice(3));
        if (/[RC]/.test(ent[i].slice(0, 2))) i++;
      }
      return paths;
    }
  }
  const paths = new Set();
  for (const rel of cur.keys()) {
    try { if (fs.statSync(abs(root, rel)).mtimeMs > since) paths.add(rel); } catch { /* gone */ }
  }
  return paths;
}

// The last sweep's own commit lands seconds after its own stamp (measured: 9 s), so a
// commit made within ten minutes after the stamp is the mark; failing that, the date rule.
function seedFromLastSweep(root, iso, cur) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) die(`"${iso}" is not a date this tool can read (use an ISO-8601 instant)`);
  if (isOwnRepoRoot(root)) {
    const until = new Date(t + 10 * 60 * 1000).toISOString();
    const r = gitOut(root, ['log', `--since=${iso}`, `--until=${until}`, '--format=%H']);
    const own = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
    if (own.length) return seedFromCommit(root, own[own.length - 1]); // the oldest in the window
  }
  return seedFromDate(root, iso, cur);
}

// ------------------------------------------------------------------- list

function list(root, flags) {
  const cur = current(root);
  const led = readLedger(root);
  let changed;
  if (led && led.stamped) {
    changed = [...cur].filter(([p, h]) => led.files[p] !== h).map(([p]) => p);
  } else if (led) {
    // seeded and not yet stamped: a sweep is under way, so the list is the seeded one again,
    // plus whatever differs from what the seeded list saw (pending stays as it was)
    const was = led.pending ? led.pending.files : {};
    const seeded = new Set(led.seeded || []);
    changed = [...cur].filter(([p, h]) => seeded.has(p) || was[p] !== h).map(([p]) => p);
  } else {
    let seed;
    if (flags['seed-commit'] !== undefined) seed = seedFromCommit(root, flags['seed-commit']);
    else if (flags['seed-last-sweep'] !== undefined) seed = seedFromLastSweep(root, flags['seed-last-sweep'], cur);
    else if (flags['seed-since'] !== undefined) seed = seedFromDate(root, flags['seed-since'], cur);
    else die('no ledger yet: seed the first run with --seed-commit <rev>, --seed-last-sweep <ISO-8601> or --seed-since <ISO-8601>');
    changed = [...cur.keys()].filter((p) => seed.has(p));
  }
  // The second run right after a stamp reads and writes nothing: the ledger is
  // touched only when there is a list to remember, or no ledger to seed from.
  if (!led) writeLedger(root, { files: {}, seeded: changed, pending: { files: Object.fromEntries(cur) } });
  else if (led.stamped && changed.length) writeLedger(root, { ...led, pending: { files: Object.fromEntries(cur) } });
  changed.sort();
  if (changed.length) console.log(changed.join('\n'));
}

// ------------------------------------------------------------------ stamp

function stamp(root, wrote) {
  const led = readLedger(root);
  if (!led || !led.pending) die('nothing to stamp: run `list` first');
  const files = { ...led.pending.files };
  for (const w of wrote) {
    const rel = path.relative(root, path.resolve(root, w)).split(path.sep).join('/');
    if (!inList(rel)) continue;
    try { files[rel] = hashOf(abs(root, rel)); } catch { delete files[rel]; }
  }
  writeLedger(root, { files, stamped: true });
}

// ------------------------------------------------------------------- main

const USAGE = `usage:
  node sweep-scope.js <workspace> list [--seed-commit <rev> | --seed-last-sweep <ISO-8601> | --seed-since <ISO-8601>]
  node sweep-scope.js <workspace> stamp [--wrote <path> ...]`;

const argv = process.argv.slice(2);
const positional = [];
const flags = {};
const wrote = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--wrote') { while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) wrote.push(argv[++i]); }
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
  else positional.push(a);
}
const [wsArg, cmd] = positional;
const root = path.resolve(wsArg || '');
if (!wsArg || !fs.existsSync(path.join(root, '.joserah', 'config.json'))) {
  console.error(USAGE);
  die(`${wsArg ? root : 'no workspace given'} is not a Joserah workspace`);
}
if (cmd === 'list') list(root, flags);
else if (cmd === 'stamp') stamp(root, wrote);
else { console.error(USAGE); process.exit(2); }
