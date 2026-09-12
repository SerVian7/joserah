#!/usr/bin/env node
/**
 * Health check for a Joserah workspace.
 *
 * The checks themselves live in lib/doctor-checks.js, one entry per check, in
 * the order they run. This file is the runner: it finds the workspace, builds
 * the one context every check reads, loops over the registry, and prints. What
 * an owner sees — the check names, their details, the summary line, the exit
 * code — is unchanged by that split and pinned by tests/doctor-registry.test.js.
 */
'use strict';
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');
const { resolvePromptSource, promptState } = require('./lib/prompt');
const { WALK_SKIP_NAMES } = require('./lib/untouchable');
const { CHECKS } = require('./lib/doctor-checks');

// Duplicated from hooks/session-start.js (a script, not a module, so it has
// nothing to require) — the exact byte sequence the session-start hook
// looks for before it will inject anything from .joserah/agent.md at all.
const AGENT_OVERLAY_MARKER = '<!-- joserah:agent-overlay-below -->';

// Shared by every check that byte-compares a plugin-owned file against
// its canonical copy or template (JOSERAH-ROLE.md, verify-links.js): a
// workspace with no .gitattributes of its own checks out under whatever the
// owner's global core.autocrlf says, and Windows with autocrlf=true — the
// plugin's own target platform — rewrites the checkout to CRLF while the
// plugin's own copy on disk stays LF. That is a checkout convention, not
// evidence of drift, so every such comparison normalises line endings first;
// a genuine content difference still differs after normalising. Handed to the
// checks on `ctx` so there is one of it.
function normalizeEol(s) { return s.replace(/\r\n/g, '\n'); }

// The registry, printed as data: id and remedy rows, no workspace needed. This
// is how a test — or anyone — reads the check list without requiring internals,
// so it is answered before a workspace is looked for.
if (process.argv.includes('--list-checks')) {
  console.log(JSON.stringify(CHECKS.map(({ id, remedies }) => ({ id, remedies })), null, 2));
  process.exit(0);
}

const root = findWorkspace(process.argv[2] || process.cwd());
const checks = [];

if (!root) {
  console.log('FAIL  not inside a Joserah workspace (no .joserah/config.json found)');
  process.exit(1);
}

const cfg = readConfig(root);

// Resolved once, here, because two entries read it (`prompt` and
// `prompt-source-drift`) and re-resolving the source per check would let the
// two disagree about which prompt they are talking about.
const promptSource = resolvePromptSource();
const prompt = {
  source: promptSource,
  st: promptState(root, cfg, promptSource),
  srcName: promptSource ? (promptSource.kind === 'marketplace' ? 'marketplace clone' : promptSource.kind) : null,
};

// The one way in for a check. `trust` starts null and is resolved by the trust
// entry, which the registry's order puts before the settings entry that reads it.
const ctx = {
  root, cfg, pluginDir: __dirname, normalizeEol, AGENT_OVERLAY_MARKER, WALK_SKIP_NAMES, prompt, trust: null,
};
for (const entry of CHECKS) {
  const produced = entry.run(ctx);
  if (!produced) continue;
  for (const r of [].concat(produced)) checks.push(r);
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
