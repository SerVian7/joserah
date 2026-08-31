#!/usr/bin/env node
/** Health check for a Joserah workspace. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');
const { PERMISSION_DENY, denyFor, hostPathsFor, defaultTrustFor } = require('./lib/permission-deny');
const { FORMAT_VERSION, roleFor, parseFrontmatter, FEEDBACK_AREAS } = require('./lib/note-format');

// Duplicated from hooks/session-start.js (a script, not a module, so it has
// nothing to require) — the exact byte sequence the session-start hook
// looks for before it will inject anything from .joserah/agent.md at all.
const AGENT_OVERLAY_MARKER = '<!-- joserah:agent-overlay-below -->';

// Shared by every check below that byte-compares a plugin-owned file against
// its canonical copy or template (JOSERAH-ROLE.md, verify-links.js): a
// workspace with no .gitattributes of its own checks out under whatever the
// owner's global core.autocrlf says, and Windows with autocrlf=true — the
// plugin's own target platform — rewrites the checkout to CRLF while the
// plugin's own copy on disk stays LF. That is a checkout convention, not
// evidence of drift, so every such comparison normalises line endings first;
// a genuine content difference still differs after normalising.
function normalizeEol(s) { return s.replace(/\r\n/g, '\n'); }

const root = findWorkspace(process.argv[2] || process.cwd());
const checks = [];
function check(name, ok, detail) { checks.push({ name, ok, detail: detail || '' }); }
function warn(name, detail) { checks.push({ name, ok: true, warn: true, detail: detail || '' }); }

if (!root) {
  console.log('FAIL  not inside a Joserah workspace (no .joserah/config.json found)');
  process.exit(1);
}

const cfg = readConfig(root);
check('workspace marker readable', !!cfg, root);
check('node version >= 18', Number(process.versions.node.split('.')[0]) >= 18, process.version);

// `CLAUDE.md` is deliberately NOT required: a workspace carries `AGENTS.md`
// only, so it is not tied to one vendor's tool (owner, 2026-08-30: "CLAUDE.md
// dosyası olmasına gerek yok, sonsuza dek claude ile çalışmayabiliriz").
const required = ['AGENTS.md', '.joserah/desk/tasks/now.md', '.joserah/learned.md',
                  '.joserah/desk/inbox/captures.md', '.joserah/personal/profile.md',
                  '.joserah/agent.md'];

// A hosted workspace runs on the host's accounts and the host's `keys/` by
// design, so it has no `keys/` of its own and must not be told to grow one.
if (cfg && cfg.kind !== 'hosted') required.push('keys/AGENTS.md');

// A remedy is only printed for a file something can actually install again.
// migrate.js writes .joserah/agent.md when it is missing (see its R17 block)
// and is the only tool that will — scaffold.js refuses to run twice on an
// existing workspace, and forcing it past that refusal overwrites
// directives.md and learned.md wholesale, which is the owner's own prose.
const REQUIRED_REMEDY = {
  '.joserah/agent.md': `missing — run: node tools/migrate.js ${root}`,
};

for (const f of required) {
  const present = fs.existsSync(path.join(root, f));
  check(`exists: ${f}`, present, present ? '' : (REQUIRED_REMEDY[f] || ''));
}

// `.claude/` is not ours — Claude Code creates it on its own, and it must not
// be mandatory in general (owner: ".claude bu klasör otomatik oluşuyor ...
// zorunlu da olmamalı"). That stands for workspaces predating 0.3.0, and for
// an owner who deliberately removed it. But scaffold.js has ALWAYS written
// this file since 0.3.0 — so on a workspace `.joserah/config.json` records as
// created by 0.3.0 or later, absence means deleted, or restored from a
// pre-0.3.0 backup missing the K3 fix, not a legitimate "never had one".
// Failing only in that case keeps older workspaces and deliberate removals
// working while catching the case the rest of this branch exists to catch:
// "never claim clean if you did not look".
function versionAtLeast(version, min) {
  const parse = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(version), b = parse(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return true; // equal counts as "at least"
}
// `trust` decides the entire deny set, so it is resolved here — above the
// settings block below — for two separate reasons.
//
// denyFor throws on a value it does not recognise, and that throw used to
// land inside the settings block's JSON try/catch: a corrupted trust level
// was reported as "present but not valid JSON", pointing the owner at the
// wrong file entirely.
//
// And a workspace that is somebody else's memory hosted here (`hosted`) or
// reached by several people (`shared`) must never have a missing `trust`
// quietly defaulted to `owner`. That default certified the nine-rule owner
// set — no machine-control rules at all — as the full expected set, on
// exactly the workspaces the guest wall exists for.
let trust = null;
{
  const recorded = cfg ? cfg.trust : undefined;
  // Same question defaultTrustFor answers for scaffold.js's write paths —
  // "which kinds must never have a missing trust silently forgiven?" — but
  // used here to fail loudly instead of to pick a default: reusing it keeps
  // the two tools from ever independently drifting on which kinds those are.
  const needsExplicitTrust = cfg && defaultTrustFor(cfg.kind) === 'guest';
  if (!cfg) {
    // An unreadable config is not a "home" workspace with no trust key — it
    // is a workspace this tool knows nothing about, `kind` included. Saying
    // anything else here would be a claim the file cannot support.
    check('trust level', false, 'config.json could not be read or parsed — nothing to check it against');
  } else if (recorded === 'owner' || recorded === 'guest') {
    trust = recorded;
    check('trust level', true, recorded);
  } else if (recorded === undefined || recorded === null) {
    if (needsExplicitTrust) {
      check('trust level', false,
        `config.json records no "trust" for a "${cfg.kind}" workspace — it must say "owner" or "guest"; without it the deny set cannot be checked at all`);
    } else {
      trust = defaultTrustFor(cfg.kind);
      check('trust level', true, 'not recorded — a "home" workspace is its owner\'s own');
    }
  } else {
    check('trust level', false, `unknown trust level ${JSON.stringify(recorded)} — expected "owner" or "guest"`);
  }
}

{
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const createdBy = cfg && cfg.createdByPluginVersion;
  const mandatory = versionAtLeast(createdBy, '0.3.0');
  if (!fs.existsSync(settingsPath)) {
    // Distinct check name (not "(present)") so the skill text that quotes
    // the present-case name verbatim (skills/backup/SKILL.md) stays accurate.
    check('.claude/settings.json (absent)', !mandatory,
      mandatory
        ? `missing, but this workspace was created by plugin ${createdBy} (>= 0.3.0), which always writes this file — run: scaffold.js --settings-only --target <dir>`
        : `absent — fine, this workspace predates 0.3.0 (created by ${createdBy || 'unknown'}), when .claude/ was not always written`);
  } else {
    let ok = false, detail = 'present but invalid';
    if (!trust) {
      // Nothing to compare against: saying "ok" here would be the exact
      // false clean report the trust check above exists to prevent.
      detail = 'present, but which rules belong in it cannot be decided — see the trust level check above';
    } else {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const deny = (parsed.permissions && parsed.permissions.deny) || [];
        const expected = denyFor(trust, { hostPaths: hostPathsFor(cfg, root) });
        const missing = expected.filter((r) => !deny.includes(r));
        ok = missing.length === 0;
        detail = ok ? `present with the full ${trust} deny set`
                   : `present but missing ${missing.length} rule(s) from the ${trust} deny set: ${missing.join(', ')}`;
      } catch (err) {
        detail = `present but not valid JSON: ${err.message}`;
      }
    }
    check('.claude/settings.json (present)', ok, detail);
  }
}

// I14: .joserah/keys was the pre-0.3.0 credentials location. Unlike the
// archive and link-check tools — which merely exclude it forever — doctor
// must fail here: this is the migration signal that tells an owner to move
// their credentials to keys/ at the workspace root. The detail is gated on
// the same boolean the check uses, so a healthy workspace's passing line
// carries no text — a passing check must not read like an active problem.
{
  const legacy = fs.existsSync(path.join(root, '.joserah', 'keys'));
  check('no legacy .joserah/keys directory', !legacy,
    legacy ? 'legacy layout — credentials moved to keys/ in 0.3.0; see the doctor skill\'s Migrate section' : '');
}

// Source material used to live under .joserah/knowledge/raw; tasks 1-4 moved
// it to raw/ at the workspace root. This is a warning, not a failure: nothing
// is broken by leftover files here, but they are stray and easy to miss since
// nothing else in the workspace still reads this location.
{
  const legacyRaw = path.join(root, '.joserah', 'knowledge', 'raw');
  if (fs.existsSync(legacyRaw) && fs.readdirSync(legacyRaw).length) {
    warn('legacy .joserah/knowledge/raw present',
      `source material now lives in raw/ at the workspace root — run: node tools/relocate-raw.js ${root}`);
  }
}

// JOSERAH-ROLE.md is copied verbatim from templates/roles/ by kind at
// scaffold time, never re-rendered from config.json. A mismatch here means
// the workspace was scaffolded under one role and its `kind` was changed
// afterwards without re-scaffolding — the same class of drift the
// verify-links.js check below catches for a different file.
{
  const rolePath = path.join(root, 'JOSERAH-ROLE.md');
  const role = roleFor(cfg && cfg.kind);
  const templatePath = path.join(__dirname, '..', 'templates', 'roles', `joserah-${role}.md`);
  let ok = false, detail;
  if (!fs.existsSync(rolePath)) {
    // Never scaffold.js: that command cannot run as printed on a workspace
    // that already exists, and forcing it past its own refusal makes
    // copyTree overwrite .joserah/directives.md and .joserah/learned.md
    // wholesale — the owner's standing rules, which the note scan itself
    // calls immutable. migrate.js installs this file and touches nothing
    // else, so it is the only safe remedy to hand an agent.
    detail = `missing — run: node tools/migrate.js ${root}`;
  } else {
    // R20: same cause as the verify-links.js check below — a workspace with
    // no .gitattributes checks this file out as CRLF on Windows with
    // autocrlf=true while the plugin's template on disk stays LF, so the
    // comparison runs through the shared normalizeEol helper too. A genuine
    // role mismatch (kind changed after scaffolding) still differs once
    // normalised, so this still catches the case the check exists for.
    ok = normalizeEol(fs.readFileSync(rolePath, 'utf8')) === normalizeEol(fs.readFileSync(templatePath, 'utf8'));
    detail = ok ? '' : `does not match the "${role}" role template for kind "${(cfg && cfg.kind) || 'home'}" — was kind changed after scaffolding? Delete it and run: node tools/migrate.js ${root}`;
  }
  check('exists: JOSERAH-ROLE.md', ok, detail);
}

// R11: the session-start hook injects only the text sitting below this exact
// marker (see AGENT_OVERLAY_MARKER above) — an owner who hand-edits
// .joserah/agent.md and loses the marker gets a permanent, silent no-op,
// while every check above this one still reports the file as present. Non-
// fatal: a rewritten agent.md is the owner's own call, not a doctor failure,
// so `ok` here is unconditional — only the detail carries the finding, gated
// on the same boolean, so a healthy workspace's line reads clean.
{
  const agentPath = path.join(root, '.joserah', 'agent.md');
  if (fs.existsSync(agentPath)) {
    const hasMarker = fs.readFileSync(agentPath, 'utf8').includes(AGENT_OVERLAY_MARKER);
    check('agent.md overlay marker present', true,
      hasMarker ? '' : 'missing — the session-start hook injects only text below this marker, so nothing in this file reaches any session right now');
  }
}

// Step 4/Task 19: informational only, like the check above — an unreported
// feedback note is something to look at, not a broken workspace. Absent
// .joserah/feedback/ prints nothing at all rather than a "0 notes" line no
// one asked for.
{
  const feedbackDir = path.join(root, '.joserah', 'feedback');
  if (fs.existsSync(feedbackDir)) {
    const counts = FEEDBACK_AREAS.map((area) => {
      const areaDir = path.join(feedbackDir, area);
      if (!fs.existsSync(areaDir)) return `${area}: 0 unreported`;
      const unreported = fs.readdirSync(areaDir).filter((f) => {
        if (!f.endsWith('.md')) return false;
        const { data } = parseFrontmatter(fs.readFileSync(path.join(areaDir, f), 'utf8'));
        return !data.reported || data.reported === 'null';
      }).length;
      return `${area}: ${unreported} unreported`;
    });
    check('feedback notes', true, counts.join(', '));
  }
}

// Informational only: a workspace merely created by an older plugin version
// is not itself unhealthy. The behavioral drift that version could cause is
// caught by the two checks around this one (legacy keys dir, verify-links.js
// drift), not by this one.
// BOM-tolerant read, matching scaffold.js's readJson — PowerShell redirection
// and some Windows editors write a leading BOM that JSON.parse rejects.
const pluginVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8')
    .replace(/^\uFEFF/, '')).version;
check('workspace/plugin version', true,
  `workspace created by ${cfg && cfg.createdByPluginVersion || 'unknown'}, plugin is ${pluginVersion}`);

const fv = cfg && cfg.formatVersion;
check('format version', fv === FORMAT_VERSION,
  fv === FORMAT_VERSION
    ? `workspace is on format v${FORMAT_VERSION}`
    : `workspace is on format v${fv || 1}, current is v${FORMAT_VERSION} \u2014 run: node tools/migrate.js ${root}`);

// G1/K4-mech: the workspace's own copy of verify-links.js is written once at
// scaffold time and never updated by anything after that. If it has drifted
// from the plugin's copy, it can silently stop checking what it claims to —
// which is exactly what happened before this check existed. This is name-
// based directory matching (see the placeholder walk below), not a
// substitute for the legacy-keys check above.
{
  const localPath = path.join(root, '.joserah', 'tools', 'verify-links.js');
  const canonical = fs.readFileSync(path.join(__dirname, 'verify-links.js'), 'utf8');
  // A workspace with no .gitattributes of its own (pre-R18, or restored from
  // a backup taken before it) checks out under whatever the owner's global
  // core.autocrlf says. On Windows with autocrlf=true — the plugin's own
  // target platform — git rewrites the checkout to CRLF while this file's
  // canonical copy on disk stays LF, so a copy re-taken minutes ago still
  // differs byte-for-byte from `canonical`, on every such workspace, always.
  // That is a checkout convention, not evidence of staleness, so the
  // comparison runs through the shared normalizeEol above (R20) — same
  // helper, same reason, as the JOSERAH-ROLE.md check; a genuine content
  // difference still differs after normalising and still fails below.
  let ok = false, detail;
  if (!fs.existsSync(localPath)) detail = 'missing — copy it from the plugin: tools/verify-links.js';
  else if (normalizeEol(fs.readFileSync(localPath, 'utf8')) !== normalizeEol(canonical)) detail = 'stale — differs from the plugin copy; re-copy it';
  else { ok = true; detail = 'matches the plugin copy'; }
  check('local verify-links.js current', ok, detail);
}

// The scan must ignore {{PLACEHOLDER}}-shaped text inside fenced/inline code —
// plan and design docs legitimately *discuss* the templating mechanism (e.g.
// a ```js block showing '{{OWNER_NAME}}': owner, or backticked
// `{{OWNER_ROLE_LINE}}` in prose), and an owner cannot "fix" their own
// documentation to clear a false alarm. stripCode below is duplicated from
// verify-links.js rather than shared: scaffold.js copies verify-links.js
// standalone into every workspace (not tools/lib/), and the drift check above
// compares that copy byte-for-byte against the plugin's — a require() of a
// shared helper would fail to resolve in every workspace and break both the
// link check and the drift check.
const leftover = spawnSync('node', ['-e', `
  const fs=require('fs'),path=require('path');let hits=0;
  function stripCode(t){return t.replace(/\`\`\`[\\s\\S]*?\`\`\`/g,m=>m.replace(/[^\\n]/g,' ')).replace(/\`[^\`\\n]*\`/g,m=>' '.repeat(m.length));}
  (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
    if(e.isDirectory()){if(!['.git','node_modules','projects','docker-stack','keys','.venv','.superpowers'].includes(e.name))walk(path.join(d,e.name));}
    else if(e.name.endsWith('.md')&&/{{[A-Z_]+}}/.test(stripCode(fs.readFileSync(path.join(d,e.name),'utf8'))))hits++;}})(process.argv[1]);
  console.log(hits);`, root], { encoding: 'utf8' });
check('no unfilled {{placeholders}}', leftover.stdout.trim() === '0', `${leftover.stdout.trim()} file(s)`);

// M3/K4-mech: run the plugin's own copy, never the workspace's — a stale or
// missing workspace copy must never blind this check or get blamed for
// broken links it never looked for.
const links = spawnSync('node', [path.join(__dirname, 'verify-links.js'), root], { encoding: 'utf8' });
check('internal links resolve', links.status === 0, (links.stdout || '').trim().split('\n')[0]);

// G3/I12: the plugin's hooks are declared with shell:"bash". On Windows that
// silently never fires without Git for Windows on PATH — the single most
// common Windows failure mode, and nothing else in this tool would ever
// surface it.
if (process.platform === 'win32') {
  const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  check('bash available for hooks', bash.status === 0,
    bash.status === 0 ? (bash.stdout.split('\n')[0] || '').trim()
      : 'not found — the plugin\'s hooks are declared with shell:"bash" and will NEVER fire; install Git for Windows');
}

// P3-3 + P0-1: audit every projects/{Owner}/{Project} (or projects/{Owner}
// with no second level) directory for whether it is actually backed up
// anywhere. This is the check the backup skill (Task 7) points owners at
// instead of duplicating: `git -C <dir> remote get-url origin` answers for
// the nearest ANCESTOR repository when <dir> is not a repository of its own,
// which once made the backup manifest claim a project was backed up by the
// workspace's own remote when no copy of that project's work existed
// anywhere else. `rev-parse --show-toplevel` is the guard: only when it
// prints <dir> itself is any other git command run there trustworthy.
function gitIn(dir, argv) {
  const r = spawnSync('git', ['-C', dir, ...argv], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
// Shared with secret-scan.js and measure-stage.js — see its comment for why
// the drive-letter case matters here.
const { sameRepoPath } = require('./lib/git-root');
const projectsDir = path.join(root, 'projects');
const gitOk = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
if (gitOk && fs.existsSync(projectsDir)) {
  const level1 = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const owner of level1) {
    const ownerDir = path.join(projectsDir, owner.name);
    // A project can sit directly at projects/<Name> as a repo in its own
    // right — its working tree already contains a `.git` directory, so it
    // never has zero subdirectories, and treating its subdirectories as
    // candidates would audit a repo's own internals (`.git`, `docs/`, ...) as
    // if they were separate unbacked projects while never checking the repo
    // itself. So: only descend into the Owner/Project layout when the owner
    // directory is NOT itself a repository of its own.
    const ownerTop = gitIn(ownerDir, ['rev-parse', '--show-toplevel']);
    const ownerIsRepo = ownerTop !== null && sameRepoPath(ownerTop, ownerDir);
    let candidates;
    if (ownerIsRepo) {
      candidates = [ownerDir];
    } else {
      const entries = fs.readdirSync(ownerDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      candidates = entries.length ? entries.map((e) => path.join(ownerDir, e.name)) : [ownerDir];
    }
    for (const dir of candidates) {
      const rel = path.relative(root, dir).split(path.sep).join('/');
      // A directory is a repository of its own ONLY if git names it as its own
      // toplevel. Anything else means git is answering for an ancestor — the
      // exact lie the backup manifest once told (P0-1).
      const top = gitIn(dir, ['rev-parse', '--show-toplevel']);
      const isOwnRepo = top !== null && sameRepoPath(top, dir);
      if (!isOwnRepo) { warn(`${rel}`, 'no repository of its own — no copy of this work exists anywhere else'); continue; }
      const remote = gitIn(dir, ['remote', 'get-url', 'origin']);
      if (!remote) { warn(`${rel}`, 'repository with no remote — history exists only on this machine'); continue; }
      const unpushed = gitIn(dir, ['log', '--branches', '--not', '--remotes', '--oneline']);
      if (unpushed) warn(`${rel}`, `${unpushed.split('\n').length} commit(s) not pushed to ${remote}`);
    }
  }
}

let failed = 0, warned = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  else if (c.warn) warned++;
  const tag = c.warn ? 'warn' : c.ok ? 'ok  ' : 'FAIL';
  console.log(`${tag}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
}
// A `warn` line sits in a channel the reader is told to skim past ("One line
// per failed check... if everything passes, say so and stop" — doctor
// SKILL.md §3): the summary carries the count so a clean-exit report can
// never be read as "nothing to say" when warnings exist. Appended in both
// branches, not only the passing one — a run with failures can still carry
// warnings the owner needs to hear, and this is the one line guaranteed to
// be read.
const warnSuffix = warned ? ` ${warned} warning(s).` : '';
console.log(failed ? `\n${failed} check(s) failed.${warnSuffix}` : `\nAll checks passed.${warnSuffix}`);
process.exit(failed ? 1 : 0);
