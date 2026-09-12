#!/usr/bin/env node
/**
 * backup-scope.js — the one statement of what a backup carries and what it
 * must never carry. skills/backup/SKILL.md used to write this list out five
 * times; it now runs this tool at each of those points. The path knowledge
 * itself comes from lib/untouchable.js, so there is one source for it in the
 * whole plugin.
 *
 *   node backup-scope.js <workspace> --route zip|repo [--json]
 *   node backup-scope.js <workspace> --check gitignore
 *   node backup-scope.js <workspace> --check history
 *   node backup-scope.js <workspace> --changed-since <ISO-8601>
 *
 * Exit 0 clean · 1 a finding the owner must see · 2 the check could not run.
 * Two is not a pass: a gate that did not run must never read as a gate that
 * passed (same rule as secret-scan.js).
 *
 * The checks run the git commands themselves rather than printing a pathspec
 * for the assistant to paste. The backup skill deliberately works in plain
 * PowerShell as well as bash, and a pathspec printed for pasting would need
 * command substitution that PowerShell spells differently — so the pathspec
 * never leaves this file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ARCHIVE_KEYS_PREFIXES, ARCHIVE_EXCLUDE_ROOT_REL,
  SOURCE_MATERIAL_REL, SOURCE_MATERIAL_GITIGNORED_REL,
  WALK_SKIP_NAMES, JUNK_NAMES,
} = require('./lib/untouchable');
const { isOwnRepoRoot } = require('./lib/git-root');

// The .env family, described once. tools/archive.js is the IMPLEMENTATION —
// its ENV_ALLOW/ENV_DENY regexes decide what a zip actually drops; these
// strings are the description of that behaviour, for reading aloud to the
// owner. They are deliberately NOT in lib/untouchable.js: that library is
// about paths, and these are file-NAME rules, which is a different kind of
// thing and must not be run through isUnder().
const ENV_PATTERNS = ['.env', '.env.*', '*.env', '*.env.*', '.envrc', '*.envrc'];
const ENV_KEPT = ['.env.example', '*.env.example'];

// The credential file that always rides along: it is the plugin's own note
// saying the folder must never be read, not a credential.
const KEYS_DOC = 'keys/AGENTS.md';

// The two documentation files that live inside an otherwise out-of-scope
// tree and are therefore exempt from the history check.
const SCOPE_EXEMPT = ['projects/AGENTS.md', 'docker-stack/README.md'];

// The .gitignore lines a repository-route backup depends on, in the order the
// scaffold writes them. `imports/` is the one that matters most: without it,
// `git add -A` tracks source material commit after commit, and the history
// check below is left to find it afterwards instead of never seeing any.
const REQUIRED_GITIGNORE = [
  'keys/*', '.env', '.env.*', '*.env', '*.env.*', '.envrc', '*.envrc',
  'projects/*', 'docker-stack/*', 'imports/',
];

function die(msg) { console.error(`backup-scope: cannot check — ${msg}`); process.exit(2); }

// The route report is read aloud to the owner, so it is wrapped to a width a
// terminal will not re-fold at an arbitrary point mid-path.
function wrap(text, firstPrefix, restPrefix, width = 78) {
  const lines = [];
  let line = firstPrefix;
  let prefix = firstPrefix;
  for (const word of text.split(' ')) {
    if (line.length > prefix.length && line.length + 1 + word.length > width) {
      lines.push(line);
      prefix = restPrefix;
      line = restPrefix + word;
    } else {
      line += (line.length > prefix.length ? ' ' : '') + word;
    }
  }
  lines.push(line);
  return lines;
}

// ---------------------------------------------------------------- --route

function routeReport(route) {
  const zip = route === 'zip';
  const excluded = {
    keys: [...ARCHIVE_KEYS_PREFIXES],
    keysException: KEYS_DOC,
    envFiles: [...ENV_PATTERNS],
    envKept: [...ENV_KEPT],
    foreign: [...ARCHIVE_EXCLUDE_ROOT_REL],
    foreignExceptions: [...SCOPE_EXEMPT],
    scratch: [...JUNK_NAMES],
    // The one difference between the two routes, and the reason this tool
    // takes a route at all.
    sourceMaterial: zip ? [] : [...SOURCE_MATERIAL_REL],
  };

  const dirs = (a) => a.map((p) => p + '/').join(', ');
  const legacySource = SOURCE_MATERIAL_REL[SOURCE_MATERIAL_REL.length - 1];

  const out = [
    `Credentials: everything under ${ARCHIVE_KEYS_PREFIXES.map((p) => p + '/').join(' and ')} ` +
      '(the second is the pre-0.3.0 location, which older workspaces still have). The one ' +
      `exception is ${KEYS_DOC}, carried through because it is the note saying the folder must ` +
      'never be read, not a credential itself.',
    `Environment files, anywhere in the workspace: ${ENV_PATTERNS.join(', ')} — ` +
      `but ${ENV_KEPT.join(' and ')} are kept, they hold no secret.`,
    `Project and runtime trees: ${dirs(ARCHIVE_EXCLUDE_ROOT_REL)} each carry their own git ` +
      `history, or none at all. Only ${SCOPE_EXEMPT.join(' and ')} — the files documenting the ` +
      'convention — stay in.',
    `Disposable scratch, at any depth: ${JUNK_NAMES.join(', ')}.`,
  ];
  if (!zip) {
    out.push(`Source material — the owner's own originals: ${dirs(SOURCE_MATERIAL_REL)} ` +
      '— the current folder first, then the two names it had before. The workspace .gitignore ' +
      `keeps ${SOURCE_MATERIAL_GITIGNORED_REL.map((p) => p + '/').join(' and ')} out of ` +
      `\`git add -A\`, but it never covered ${legacySource}/ — which is why --check history ` +
      'has to read the past as well as the present.');
  }

  const inc = [];
  if (zip) {
    inc.push(`Source material: ${dirs(SOURCE_MATERIAL_REL)} — the owner's own originals ride ` +
      'along, because a zip carries binaries without consequence. The repository route leaves ' +
      'them out.');
  }
  inc.push('Everything else in the workspace: the whole .joserah/ tree and the root files beside it.');

  const lines = [
    zip ? 'Backup route: a single zip file.' : 'Backup route: a private git repository.',
    '', 'Left OUT of this backup:', ...out.flatMap((s) => wrap(s, '  - ', '    ')),
    '', 'Carried IN by this backup:', ...inc.flatMap((s) => wrap(s, '  - ', '    ')),
  ];
  return { route: zip ? 'zip' : 'repository', excluded, included: inc, lines };
}

// ------------------------------------------------------- --check gitignore

function checkGitignore(root) {
  const file = path.join(root, '.gitignore');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { die(`there is no .gitignore at ${root} to read`); }
  const present = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = REQUIRED_GITIGNORE.filter((l) => !present.has(l));
  if (missing.length === 0) {
    console.log('.gitignore carries every line a repository backup depends on.');
    process.exit(0);
  }
  console.log('Missing from .gitignore — add each of these before backing up:');
  for (const l of missing) console.log(l);
  process.exit(1);
}

// --------------------------------------------------------- --check history

// Out of scope for a backup: project and runtime trees, plus source material
// under every name the folder has ever had. The two documentation files are
// excluded from the pathspec rather than filtered out of the results, so git
// itself does the deciding and nothing has to be re-matched by hand.
function scopePathspec() {
  return [
    ...[...ARCHIVE_EXCLUDE_ROOT_REL, ...SOURCE_MATERIAL_REL].map((p) => p + '/'),
    ...SCOPE_EXEMPT.map((p) => `:(exclude)${p}`),
  ];
}

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

function checkHistory(root) {
  // A workspace nested inside some ancestor repository would have git answer
  // for the ancestor, and a clean answer about the wrong repository is worse
  // than no answer at all. isOwnRepoRoot also returns false when git is not
  // on PATH, which is the same "could not check" outcome.
  if (!isOwnRepoRoot(root)) die(`${root} is not a git repository of its own, or git is unavailable`);
  const spec = scopePathspec();
  const tracked = git(root, ['ls-files', '--', ...spec]);
  if (tracked === null) die('`git ls-files` failed');
  const inHistory = git(root, ['log', '--all', '--oneline', '--', ...spec]);
  if (inHistory === null) die('`git log --all` failed');

  if (!tracked && !inHistory) {
    console.log('In scope: no project work, runtime state or source material is tracked here,');
    console.log('and none appears anywhere in this repository\'s history.');
    process.exit(0);
  }
  if (tracked) {
    console.log('Out of scope, tracked right now (git ls-files):');
    for (const l of tracked.split('\n')) console.log(`  ${l}`);
    console.log('');
  }
  if (inHistory) {
    // The whole reason a second probe exists. Once the files are moved or
    // deleted, `add -A` stages only the deletion and ls-files goes quiet
    // forever, while every past commit still serves the material.
    console.log('Out of scope, sitting in this repository\'s history (git log --all):');
    for (const l of inHistory.split('\n')) console.log(`  ${l}`);
    console.log('');
    console.log('Deleting the files does not remove them from history — anyone with a clone,');
    console.log('or access to the remote, still has every commit.');
  }
  process.exit(1);
}

// --------------------------------------------------------- --changed-since

function changedSince(root, iso) {
  const since = new Date(iso).getTime();
  if (!Number.isFinite(since)) die(`"${iso}" is not a date this tool can read (use an ISO-8601 instant)`);
  // WALK_SKIP_NAMES, at any depth — the same list doctor's placeholder walk
  // uses. Nothing under one of those directories is the owner's own work, so
  // counting it would only ever overstate how much has changed.
  const skip = new Set(WALK_SKIP_NAMES);
  let n = 0;
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(full);
      } else if (e.isFile()) {
        try { if (fs.statSync(full).mtimeMs > since) n++; } catch { /* vanished mid-walk */ }
      }
    }
  })(root);
  console.log(String(n));
  process.exit(0);
}

// ------------------------------------------------------------------- main

const USAGE = `usage:
  node backup-scope.js <workspace> --route zip|repo [--json]
  node backup-scope.js <workspace> --check gitignore|history
  node backup-scope.js <workspace> --changed-since <ISO-8601>`;

const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') flags.json = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
  else positional.push(a);
}
const root = path.resolve(positional[0] || process.cwd());
if (!fs.existsSync(path.join(root, '.joserah', 'config.json'))) {
  console.error(`backup-scope: cannot check — ${root} is not a Joserah workspace`);
  process.exit(2);
}

if (flags.route !== undefined) {
  if (!['zip', 'repo', 'repository'].includes(flags.route)) die(`unknown route "${flags.route}" (zip or repo)`);
  const report = routeReport(flags.route === 'zip' ? 'zip' : 'repo');
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(report.lines.join('\n'));
  process.exit(0);
} else if (flags.check !== undefined) {
  if (flags.check === 'gitignore') checkGitignore(root);
  else if (flags.check === 'history') checkHistory(root);
  else die(`unknown check "${flags.check}" (gitignore or history)`);
} else if (flags['changed-since'] !== undefined) {
  changedSince(root, flags['changed-since']);
} else {
  console.error(USAGE);
  process.exit(2);
}
