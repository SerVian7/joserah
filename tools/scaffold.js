#!/usr/bin/env node
/**
 * Create a Joserah workspace from templates/.
 * Usage: node scaffold.js --target DIR --workspace NAME
 *                         [--owner NAME] [--language LANG] [--role LINE] [--git] [--force]
 *                         [--trust owner|guest] [--kind home|hosted|shared] [--assistant NAME]
 *                         [--host-path DIR] [--consent-model NAME]
 *                         [--feedback auto|manual|off] [--github USER]
 *                         [--identity-mode auto|manual|off]
 *        node scaffold.js --settings-only --target DIR [--force]
 *        node scaffold.js --root-shell-only --target DIR
 *        node scaffold.js --identity-only --target DIR [--owner NAME] [--language LANG]
 *                         [--role LINE] [--consent-model NAME]
 *                         [--feedback auto|manual|off] [--github USER]
 *                         [--identity-mode auto|manual|off]
 *
 * `--feedback`/`--identity-mode` record whether the owner has been asked
 * about self-improvement feedback notes and about .joserah/agent.md keeping
 * itself current — same non-destructive rule as `--consent-model`: both are
 * accepted on both entry points, and omitting either flag on a later
 * --identity-only call leaves an existing block untouched rather than
 * clearing it. They differ on which entry point the install flow actually
 * uses, because the two questions sit at different points in the interview:
 * feedback is asked after consent, so the create call always runs first and
 * --identity-only is the only path that ever carries it for real; the
 * self-update question is asked before creation, alongside --trust and
 * --assistant, so the install flow passes --identity-mode on the main
 * create call instead — never held across the consent question, where a
 * "no" would otherwise drop an answer the owner already gave.
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

// Workspace .gitignore. The project/runtime rule is expressed as a pattern,
// never an enumerated list, so it holds in anyone's workspace. Shared
// between the main create path and `--root-shell-only` (a .joserah-only
// restore has no other way to get this file back) — one source of truth,
// so the two paths cannot silently drift apart.
const GITIGNORE_LINES = [
  '# secrets — never in history',
  'keys/*',
  '!keys/AGENTS.md',
  '# pre-0.3.0 legacy location — excluded forever, belt-and-braces',
  '.joserah/keys/*',
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
  '# Source material: originals the owner already holds elsewhere (statements,',
  '# vendor PDFs, firmware). Root location, outside .joserah/ — never in a',
  '# repository backup; the zip route still carries it. (Was raw/ before 2026-09-12.)',
  'imports/',
  '',
  '# Conversation records: kept in the workspace, never in a repository backup',
  '.joserah/conversations/',
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
];

function parseArgs(argv) {
  const out = { git: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--git') { out.git = true; continue; }
    if (a === '--force') { out.force = true; continue; }
    if (a === '--settings-only') { out.settingsOnly = true; continue; }
    if (a === '--root-shell-only') { out.rootShellOnly = true; continue; }
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
const { PERMISSION_DENY, denyFor, hostPathsFor, defaultTrustFor } = require('./lib/permission-deny');
const { FORMAT_VERSION, roleFor } = require('./lib/note-format');
const { readPromptVersion, promptSha } = require('./lib/prompt');
const { installClaudeMd } = require('../hooks/lib/standing-context');

// `--feedback` and `--identity-mode` share one three-value vocabulary.
// Defined once, up here, so both the main create path and --identity-only
// (below) can validate before either writes a single byte — an unknown value
// must be refused, never silently coerced or guessed.
const THREE_MODES = ['auto', 'manual', 'off'];
function validateThreeMode(flag, value) {
  if (value !== undefined && !THREE_MODES.includes(value)) {
    console.error(`scaffold: --${flag} must be "auto", "manual" or "off" (got ${value})`);
    process.exit(1);
  }
}

// Permission rules are the workspace's guard on keys/ — they must exist from
// the first minute, so scaffold creates .claude/ itself. (Claude Code also
// creates that directory on its own; the two coexist fine.)
function writeSettings(dir, force, rules) {
  const claudeDir = path.join(dir, '.claude');
  const file = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(file) && !force) {
    console.error(`scaffold: ${file} already exists — refusing to overwrite`);
    console.error('scaffold: read it first; re-run with --force only if the owner agreed to replace it.');
    process.exit(1);
  }
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ permissions: { deny: rules } }, null, 2) + '\n', 'utf8');
  return file;
}

// Strips a leading UTF-8 BOM before parsing — PowerShell redirection and some
// Windows editors write one, and JSON.parse rejects it outright otherwise.
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
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
  const cfgForSettings = readJson(path.join(dir, '.joserah', 'config.json'));
  // A restore reproduces the guest wall from what the workspace recorded at
  // creation time — see the config.json write below. Without `hosting`
  // persisted there, this path silently dropped the three host rules and
  // handed back a workspace with no wall at all.
  // The fallback here must NOT be a bare 'owner': a restore onto a hosted or
  // shared workspace whose config.json has lost its `trust` key would then
  // write the nine-rule owner set — no machine-control rules, no host wall —
  // which is the exact wide-by-default failure defaultTrustFor exists to close.
  const rules = denyFor(cfgForSettings.trust || defaultTrustFor(cfgForSettings.kind),
    { hostPaths: hostPathsFor(cfgForSettings, dir) });
  console.log(JSON.stringify({ settings: writeSettings(dir, args.force, rules), rules: rules.length }));
  process.exit(0);
}

// `--root-shell-only --target DIR`: used by the backup skill's restore path
// when the backup scope was `.joserah/` only. That scope carries the
// knowledge base but none of the root shell — AGENTS.md, JOSERAH-ROLE.md,
// .gitignore, .claude/settings.json — because none of those live under
// .joserah/. Writes only what is missing (never overwrites an owner-edited
// file) and reports one line per file. Scoped to actual Joserah workspaces,
// same as --settings-only: this restores a shell around an existing
// knowledge base, it does not create one.
if (args.rootShellOnly) {
  if (!args.target) { console.error('scaffold: --root-shell-only needs --target DIR'); process.exit(1); }
  const root = path.resolve(args.target);
  const cfgPath = path.join(root, '.joserah', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error(`scaffold: ${root} is not a Joserah workspace (no .joserah/config.json found) — refusing to write a root shell`);
    process.exit(1);
  }
  const cfg = readJson(cfgPath);
  const trust = cfg.trust || defaultTrustFor(cfg.kind);
  const writeIfMissing = (rel, content) => {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) { console.log(`kept ${rel} (already present)`); return; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    console.log(`wrote ${rel}`);
  };
  writeIfMissing('AGENTS.md', fs.readFileSync(path.join(TEMPLATES, 'AGENTS.md')));
  writeIfMissing('JOSERAH-ROLE.md',
    fs.readFileSync(path.join(TEMPLATES, 'roles', `joserah-${roleFor(cfg.kind)}.md`)));
  writeIfMissing('.gitignore', GITIGNORE_LINES.join('\n'));
  // The CLAUDE.md stub: written when missing, refreshed when it is the
  // plugin's, never touched when it is the owner's (see installClaudeMd).
  console.log(`${installClaudeMd(root) === 'foreign' ? 'kept' : 'wrote'} CLAUDE.md`);
  // imports/ is a root shell path too (outside .joserah/, gitignored by
  // construction) — a `.joserah`-only backup never carried it, so a restore
  // leaves the owner with an empty, unexplained folder unless this writes
  // the template's explanation back in.
  writeIfMissing('imports/README.md', fs.readFileSync(path.join(TEMPLATES, 'imports', 'README.md')));
  if (!fs.existsSync(path.join(root, '.claude', 'settings.json'))) {
    writeSettings(root, true, denyFor(trust, { hostPaths: hostPathsFor(cfg, root) }));
    console.log('wrote .claude/settings.json');
  } else {
    console.log('kept .claude/settings.json (already present)');
  }
  process.exit(0);
}

// `--identity-only --target DIR [--owner --language --role]`: used by the
// `install` skill after `doctor` has passed on a workspace created without
// these three values. Re-renders exactly the files that carry them —
// .joserah/personal/profile.md (owner name, role line) and
// .joserah/conventions.md (dialogue language) — fresh from templates/, using
// the --owner/--language/--role values passed on this call. AGENTS.md
// carries no identity (it reads config.json at runtime instead) so it is
// never in this list. Safe only because nothing else has touched those files
// yet at this point in the install flow; it is not a general-purpose
// re-template command and must not be offered once onboarding has begun.
if (args.identityOnly) {
  if (!args.target) { console.error('scaffold: --identity-only needs --target DIR'); process.exit(1); }
  const dir = path.resolve(args.target);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error(`scaffold: ${dir} is not a Joserah workspace (no .joserah/config.json found)`);
    process.exit(1);
  }
  // The install flow's create call runs before the feedback/identity
  // questions are asked, so this is the only entry point that can ever reach
  // them for real — validated before the profile.md/conventions.md rewrite
  // below touches a single file, same as the main path.
  validateThreeMode('feedback', args.feedback);
  validateThreeMode('identity-mode', args['identity-mode']);
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
  // The install skill asks consent in the same dialogue turn as identity and
  // submits both on this one call — see the note at the main config.json
  // write below. Omitted here means the answer wasn't yes on this call; an
  // existing consent record from an earlier call is left untouched.
  if (args['consent-model']) {
    cfg.consent = { askedOn: localISODate(), model: args['consent-model'], version: 1 };
  }
  // Same non-destructive rule as consent above: omitted here means the
  // question wasn't asked on this call, not "off" — an existing block from an
  // earlier call is left exactly as it was.
  if (args.feedback) {
    cfg.feedback = { mode: args.feedback, github: args.github || null, askedOn: localISODate() };
  }
  if (args['identity-mode']) {
    cfg.identity = { mode: args['identity-mode'], askedOn: localISODate() };
  }
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
args.assistant = args.assistant || '';

// `kind` picks the role supplement (see roleFor in lib/note-format) — never
// asked as its own question, so it must be rejected up front rather than
// silently coerced into a role that would then contradict it. Resolved
// before --trust below, which derives its own default from this value.
args.kind = args.kind || 'home';
if (!['home', 'hosted', 'shared'].includes(args.kind)) {
  console.error(`scaffold: --kind must be "home", "hosted" or "shared" (got ${args.kind})`);
  process.exit(1);
}

// Silence must not resolve to the wider permission: an unattended --kind
// hosted/shared create call with no --trust flag defaults to guest, not
// owner. See defaultTrustFor in lib/permission-deny.js — the same
// derivation --settings-only uses, so the two write paths cannot disagree.
args.trust = args.trust || defaultTrustFor(args.kind);
if (args.trust !== 'owner' && args.trust !== 'guest') {
  console.error(`scaffold: --trust must be "owner" or "guest" (got ${args.trust})`);
  process.exit(1);
}

// `feedback` and `identity` share one three-value vocabulary — validated here,
// alongside --trust and --kind, so a bad value is refused before the target
// root is even resolved, let alone created. Both flags are optional: absent
// means never asked (see the config.json write below), so only a *given*
// value is checked against the vocabulary.
validateThreeMode('feedback', args.feedback);
validateThreeMode('identity-mode', args['identity-mode']);

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
// templates/roles/ holds the client and server role supplements. Exactly one
// is picked by kind and written explicitly as JOSERAH-ROLE.md (see below and
// in copyTree) — the directory itself is never copied wholesale, so both the
// collision check and the actual copy skip it by name.
const COPY_SKIP_DIRS = ['roles'];

function plannedTemplateFiles(from, to, acc) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory() && COPY_SKIP_DIRS.includes(e.name)) continue;
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
  path.join(root, '.joserah', 'tools', 'lib', 'untouchable.js'),
  path.join(root, '.joserah', 'tools', 'secret.js'),
  path.join(root, 'JOSERAH-ROLE.md'),
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

// --host-path is recorded in config.json, not merely compiled into rules and
// forgotten: doctor.js verifies the deny set against what the workspace says
// about itself, and `--settings-only` (the backup skill's restore path)
// rebuilds the set from the same key. While nothing wrote it, deleting all
// three host rules by hand still passed doctor and a restore quietly removed
// them. Stored exactly as it was given — a relative path stays relative and
// readable, and is interpreted against the workspace root by hostPathsFor,
// which is the only place that resolution happens.
const hosting = args['host-path'] ? { hostPath: args['host-path'] } : null;

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
    if (e.isDirectory() && COPY_SKIP_DIRS.includes(e.name)) continue;
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyTree(src, dst);
    // The workspace-root AGENTS.md is plugin-owned and identical everywhere —
    // identity comes from config.json at runtime, never from this file — so
    // it is copied verbatim rather than run through substitute(). Nested
    // AGENTS.md stubs (keys/, projects/) are unrelated files and keep going
    // through the normal .md path below.
    else if (dst === path.join(root, 'AGENTS.md')) {
      fs.copyFileSync(src, dst);
      filesCreated++;
    } else if (e.name.endsWith('.md')) {
      fs.writeFileSync(dst, substitute(fs.readFileSync(src, 'utf8')), 'utf8');
      filesCreated++;
    } else {
      fs.copyFileSync(src, dst);
      filesCreated++;
    }
  }
}

copyTree(TEMPLATES, root);

// The role supplement is picked by kind, not copied as part of the tree
// above — see COPY_SKIP_DIRS. Copied verbatim, like AGENTS.md: it is
// plugin-owned and carries no tokens to substitute.
fs.copyFileSync(path.join(TEMPLATES, 'roles', `joserah-${roleFor(args.kind)}.md`),
  path.join(root, 'JOSERAH-ROLE.md'));

// 0.13.3: the CLAUDE.md stub that @-imports AGENTS.md, JOSERAH-ROLE.md and
// .joserah/directives.md — how the standing layers reach a session (see
// CLAUDE_MD in hooks/lib/standing-context.js). Not in the collision check: an
// owner-written CLAUDE.md is never overwritten, not even with --force, and the
// session-start hook carries every layer it does not import.
installClaudeMd(root);

// Journal year dir so the first session has somewhere to land.
fs.mkdirSync(path.join(root, '.joserah', 'desk', 'daily', String(new Date().getFullYear())), { recursive: true });

// Workspace marker.
fs.mkdirSync(path.join(root, '.joserah'), { recursive: true });
fs.writeFileSync(path.join(root, '.joserah', 'config.json'), JSON.stringify({
  workspaceName: args.workspace,
  ownerName: args.owner,
  assistantName: args.assistant,
  dialogueLanguage: args.language,
  created: today,
  createdByPluginVersion: readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')).version,
  formatVersion: FORMAT_VERSION,
  // What refresh-prompt.js and doctor.js compare AGENTS.md against later: the
  // version line and sha of the copy installed just above by copyTree.
  promptVersion: readPromptVersion(fs.readFileSync(path.join(TEMPLATES, 'AGENTS.md'), 'utf8')),
  promptSha256: promptSha(fs.readFileSync(path.join(TEMPLATES, 'AGENTS.md'), 'utf8')),
  trust: args.trust,
  kind: args.kind,
  ...(hosting ? { hosting } : {}),
  lastBackup: null,
  // Recorded only when the install skill actually asked and got a yes. Absent
  // means never asked — never write a consent record nobody gave.
  ...(args['consent-model'] ? {
    consent: { askedOn: today, model: args['consent-model'], version: 1 },
  } : {}),
  // Recorded only when the install skill actually asked. Absent means never
  // asked; never write an opt-in nobody gave.
  ...(args.feedback ? {
    feedback: { mode: args.feedback, github: args.github || null, askedOn: today },
  } : {}),
  ...(args['identity-mode'] ? {
    identity: { mode: args['identity-mode'], askedOn: today },
  } : {}),
}, null, 2) + '\n', 'utf8');
// Note: the capture hook also honours an optional `captureTriggers` array in
// this file. It is deliberately not written here — absent means "use the
// built-in bilingual defaults", and an owner who wants their own phrases adds
// the key by hand. Writing the defaults out would fork them into two places
// that then drift.

// Permission rules (see PERMISSION_DENY above — the one source of truth).
writeSettings(root, true, denyFor(args.trust, { hostPaths: hostPathsFor({ hosting }, root) }));

// Workspace .gitignore (see GITIGNORE_LINES above).
fs.writeFileSync(path.join(root, '.gitignore'), GITIGNORE_LINES.join('\n'), 'utf8');

// Local copy of the link checker so the workspace can verify itself, plus the
// one library it requires — doctor.js compares this copy byte-for-byte with
// the plugin's, so anything verify-links.js requires has to travel with it.
fs.mkdirSync(path.join(root, '.joserah', 'tools'), { recursive: true });
fs.copyFileSync(path.join(PLUGIN_ROOT, 'tools', 'verify-links.js'),
  path.join(root, '.joserah', 'tools', 'verify-links.js'));
fs.mkdirSync(path.join(root, '.joserah', 'tools', 'lib'), { recursive: true });
fs.copyFileSync(path.join(PLUGIN_ROOT, 'tools', 'lib', 'untouchable.js'),
  path.join(root, '.joserah', 'tools', 'lib', 'untouchable.js'));

// The vault: a local copy of secret.js (the prompt calls it by this relative
// path, and doctor compares it with the plugin's, like verify-links.js), and
// an empty store beside keys/AGENTS.md. An existing store is never touched.
fs.copyFileSync(path.join(PLUGIN_ROOT, 'tools', 'secret.js'),
  path.join(root, '.joserah', 'tools', 'secret.js'));
const store = path.join(root, 'keys', 'secrets.json');
if (!fs.existsSync(store)) {
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify({
    _readme: 'Vault. Values are read only through .joserah/tools/secret.js and only ever embedded in a command as $(...). Never print, copy or cite a value; notes carry the name.',
    secrets: {},
  }, null, 2) + '\n', 'utf8');
}

if (args.git) {
  const { spawnSync } = require('child_process');
  spawnSync('git', ['init'], { cwd: root, stdio: 'ignore' });
}

console.log(JSON.stringify({ root, filesCreated }));
