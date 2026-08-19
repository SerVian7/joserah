#!/usr/bin/env node
/**
 * Create a Joserah workspace from templates/.
 * Usage: node scaffold.js --target DIR --workspace NAME
 *                         [--owner NAME] [--language LANG] [--role LINE] [--git] [--force]
 *        node scaffold.js --settings-only --target DIR [--force]
 *        node scaffold.js --identity-only --target DIR [--owner NAME] [--language LANG] [--role LINE]
 *
 * Refuses to touch a target where any file it would write already exists,
 * unless --force is given. Nothing is written until that check has passed.
 *
 * `--owner`, `--language` and `--role` are optional at creation time so a
 * workspace can be created and verified (`doctor.js`) before its owner is
 * interviewed — the `install` skill asks location first, creates and checks
 * the workspace, then asks who the owner is. Omitted values are substituted
 * as an empty string (never invented), and `--identity-only` fills them in
 * afterwards by re-rendering the three files that carry them.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');

function parseArgs(argv) {
  const out = { git: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--git') { out.git = true; continue; }
    if (a === '--force') { out.force = true; continue; }
    if (a === '--settings-only') { out.settingsOnly = true; continue; }
    if (a === '--identity-only') { out.identityOnly = true; continue; }
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// Permission rules — plugins cannot ship these, so the workspace carries them.
// tools/lib/permission-deny.js is the single source of truth for the set;
// `--settings-only` exists so a restore of an older backup can write exactly
// these rules again rather than an agent inventing a plausible-looking set.
const { PERMISSION_DENY } = require('./lib/permission-deny');

// Permission rules are the workspace's guard on keys/ — they must exist from
// the first minute, so scaffold creates .claude/ itself. (Claude Code also
// creates that directory on its own; the two coexist fine.)
function writeSettings(dir, force) {
  const claudeDir = path.join(dir, '.claude');
  const file = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(file) && !force) {
    console.error(`scaffold: ${file} already exists — refusing to overwrite`);
    console.error('scaffold: read it first; re-run with --force only if the owner agreed to replace it.');
    process.exit(1);
  }
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ permissions: { deny: PERMISSION_DENY } }, null, 2) + '\n', 'utf8');
  return file;
}

// Strips a leading UTF-8 BOM before parsing — PowerShell redirection and some
// Windows editors write one, and JSON.parse rejects it outright otherwise.
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

function localISODate() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// `--settings-only --target DIR`: writes just .claude/settings.json; used by
// the backup skill's restore path.
// Scoped to actual Joserah workspaces: a target that has never been
// scaffolded (no `.joserah/config.json`) has no business getting a
// `.claude/settings.json` written into it by this tool.
if (args.settingsOnly) {
  if (!args.target) { console.error('scaffold: --settings-only needs --target DIR'); process.exit(1); }
  const dir = path.resolve(args.target);
  if (!fs.existsSync(path.join(dir, '.joserah', 'config.json'))) {
    console.error(`scaffold: ${dir} is not a Joserah workspace (no .joserah/config.json found) — refusing to write settings`);
    process.exit(1);
  }
  console.log(JSON.stringify({ settings: writeSettings(dir, args.force), rules: PERMISSION_DENY.length }));
  process.exit(0);
}

// `--identity-only --target DIR [--owner --language --role]`: used by the
// `install` skill after `doctor` has passed on a workspace created without
// these three values. Re-renders exactly the files that carry them —
// AGENTS.md, .joserah/personal/profile.md, .joserah/conventions.md — fresh
// from templates/, using the workspace name and creation date already on
// record in config.json. Safe only because nothing else has touched those
// files yet at this point in the install flow; it is not a general-purpose
// re-template command and must not be offered once onboarding has begun.
if (args.identityOnly) {
  if (!args.target) { console.error('scaffold: --identity-only needs --target DIR'); process.exit(1); }
  const dir = path.resolve(args.target);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error(`scaffold: ${dir} is not a Joserah workspace (no .joserah/config.json found)`);
    process.exit(1);
  }
  const cfg = readJson(cfgPath);
  const owner = args.owner || '';
  const language = args.language || '';
  const role = args.role || '';
  const subs = {
    '{{OWNER_NAME}}': owner,
    '{{WORKSPACE_NAME}}': cfg.workspaceName || '',
    '{{DIALOGUE_LANGUAGE}}': language,
    '{{OWNER_ROLE_LINE}}': role,
    '{{SETUP_DATE}}': cfg.created || '',
  };
  function sub(text) {
    let out = text;
    for (const [token, value] of Object.entries(subs)) out = out.split(token).join(value);
    return out;
  }
  const rewritten = [
    'AGENTS.md',
    path.join('.joserah', 'personal', 'profile.md'),
    path.join('.joserah', 'conventions.md'),
  ];
  const updated = [];
  for (const rel of rewritten) {
    const src = path.join(TEMPLATES, rel);
    const dst = path.join(dir, rel);
    if (!fs.existsSync(src)) continue;
    fs.writeFileSync(dst, sub(fs.readFileSync(src, 'utf8')), 'utf8');
    updated.push(rel.split(path.sep).join('/'));
  }
  cfg.ownerName = owner;
  cfg.dialogueLanguage = language;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ updated }));
  process.exit(0);
}

for (const req of ['target', 'workspace']) {
  if (!args[req]) {
    console.error(`scaffold: missing --${req}`);
    process.exit(1);
  }
}
// Owner, language and role are not required up front — see the file header.
// Never invented: an omitted value is substituted as an empty string, filled
// in later by --identity-only.
args.owner = args.owner || '';
args.language = args.language || '';
args.role = args.role || '';

const root = path.resolve(args.target);
if (fs.existsSync(path.join(root, '.joserah', 'config.json')) && !args.force) {
  console.error(`scaffold: ${root} is already a Joserah workspace — refusing to overwrite`);
  console.error('scaffold: pass --force only if the owner has explicitly asked for it.');
  process.exit(1);
}

// --- Collision check -------------------------------------------------------
// Every file this run would write, computed before a single byte is written.
// Scaffolding into a directory that already holds the owner's own README.md,
// CLAUDE.md, .gitignore or .claude/settings.json must not silently destroy
// them — losing a .gitignore can expose whatever it was hiding.
function plannedTemplateFiles(from, to, acc) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) plannedTemplateFiles(src, dst, acc);
    else acc.push(dst);
  }
  return acc;
}

const PLANNED = plannedTemplateFiles(TEMPLATES, root, [
  path.join(root, '.joserah', 'config.json'),
  path.join(root, '.claude', 'settings.json'),
  path.join(root, '.gitignore'),
  path.join(root, '.joserah', 'tools', 'verify-links.js'),
]);

const conflicts = PLANNED.filter((p) => fs.existsSync(p))
  .map((p) => path.relative(root, p).split(path.sep).join('/'))
  .sort();

if (conflicts.length && !args.force) {
  console.error(`scaffold: ${root} already contains ${conflicts.length} file(s) this would overwrite — nothing was written:`);
  for (const c of conflicts) console.error('  ' + c);
  console.error('scaffold: choose an empty directory, move these aside, or re-run with --force');
  console.error('scaffold: --force overwrites them in place, with no backup.');
  process.exit(1);
}

const today = localISODate();
const SUBS = {
  '{{OWNER_NAME}}': args.owner,
  '{{WORKSPACE_NAME}}': args.workspace,
  '{{DIALOGUE_LANGUAGE}}': args.language,
  '{{OWNER_ROLE_LINE}}': args.role,
  '{{SETUP_DATE}}': today,
};

function substitute(text) {
  let out = text;
  for (const [token, value] of Object.entries(SUBS)) out = out.split(token).join(value);
  return out;
}

let filesCreated = 0;
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyTree(src, dst);
    else if (e.name.endsWith('.md')) {
      fs.writeFileSync(dst, substitute(fs.readFileSync(src, 'utf8')), 'utf8');
      filesCreated++;
    } else {
      fs.copyFileSync(src, dst);
      filesCreated++;
    }
  }
}

copyTree(TEMPLATES, root);

// Journal year dir so the first session has somewhere to land.
fs.mkdirSync(path.join(root, '.joserah', 'desk', 'daily', String(new Date().getFullYear())), { recursive: true });

// Workspace marker.
fs.mkdirSync(path.join(root, '.joserah'), { recursive: true });
fs.writeFileSync(path.join(root, '.joserah', 'config.json'), JSON.stringify({
  workspaceName: args.workspace,
  ownerName: args.owner,
  dialogueLanguage: args.language,
  created: today,
  createdByPluginVersion: readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')).version,
  lastBackup: null,
}, null, 2) + '\n', 'utf8');
// Note: the capture hook also honours an optional `captureTriggers` array in
// this file. It is deliberately not written here — absent means "use the
// built-in bilingual defaults", and an owner who wants their own phrases adds
// the key by hand. Writing the defaults out would fork them into two places
// that then drift.

// Permission rules (see PERMISSION_DENY above — the one source of truth).
writeSettings(root, true);

// Workspace .gitignore. The project/runtime rule is expressed as a pattern,
// never an enumerated list, so it holds in anyone's workspace.
fs.writeFileSync(path.join(root, '.gitignore'), [
  '# secrets — never in history',
  'keys/*',
  '!keys/AGENTS.md',
  '.env',
  '.env.*',
  '*.env',
  '*.env.*',
  '.envrc',
  '*.envrc',
  '!.env.example',
  '!*.env.example',
  '',
  '# Project and runtime trees: contents are never tracked here. Each project',
  '# carries its own git history; runtime stacks hold state, not knowledge.',
  '# Only the file documenting each tree\'s convention is kept.',
  'projects/*',
  '!projects/AGENTS.md',
  'docker-stack/*',
  '# docker-stack/README.md is created by the owner if they adopt that convention',
  '!docker-stack/README.md',
  '',
  '# scratch directories tools create unbidden',
  '.superpowers/',
  '',
  '# machine-local',
  '.joserah/last-time-inject',
  'node_modules/',
  '.venv/',
  '',
  '# OS noise',
  '.DS_Store',
  'Thumbs.db',
  '',
].join('\n'), 'utf8');

// Local copy of the link checker so the workspace can verify itself.
fs.mkdirSync(path.join(root, '.joserah', 'tools'), { recursive: true });
fs.copyFileSync(path.join(PLUGIN_ROOT, 'tools', 'verify-links.js'),
  path.join(root, '.joserah', 'tools', 'verify-links.js'));

if (args.git) {
  const { spawnSync } = require('child_process');
  spawnSync('git', ['init'], { cwd: root, stdio: 'ignore' });
}

console.log(JSON.stringify({ root, filesCreated }));
