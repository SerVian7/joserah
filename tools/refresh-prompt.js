#!/usr/bin/env node
/**
 * refresh-prompt.js — bring a workspace's AGENTS.md to the current prompt.
 * Usage: node refresh-prompt.js <workspace-root> [--dry-run] [--force] [--source <dir>]
 *
 * The prompt (templates/AGENTS.md) is versioned apart from the plugin — see
 * lib/prompt.js. This copies the newest available copy into the workspace and
 * records what it installed in .joserah/config.json, so a new conversation
 * picks the new text up: no plugin release, no IDE restart.
 *
 * It never overwrites text it cannot account for. A file that differs from the
 * recorded install (hand-edited), or one with no record that differs from the
 * source (predates versioning, or hand-edited), is refused with exit 2 unless
 * --force is given — and --force keeps the displaced text beside the file as
 * AGENTS.md.replaced-<date>, because edits to AGENTS.md belong in
 * .joserah/directives.md and the owner may want to move them there first.
 *
 * Exit codes: 0 acted or nothing to do · 1 not a workspace / no source · 2 refused.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { resolvePromptSource, promptState, decidePromptAction, installPrompt } = require('./lib/prompt');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const srcIdx = args.indexOf('--source');
const override = srcIdx >= 0 ? args[srcIdx + 1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') && (srcIdx < 0 || i !== srcIdx + 1));
const root = path.resolve(positional[0] || process.cwd());

const cfgPath = path.join(root, '.joserah', 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error(`refresh-prompt: ${root} is not a Joserah workspace (no .joserah/config.json found)`);
  process.exit(1);
}
let cfg = null;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
} catch {
  cfg = null; // treated as "no record": the file is then unrecorded, and the malformed config is doctor's finding
}

const source = resolvePromptSource({ override });
if (!source) {
  console.error('refresh-prompt: no prompt source found — neither the marketplace clone nor the installed plugin carries a versioned templates/AGENTS.md');
  process.exit(1);
}

const before = promptState(root, cfg, source);
const action = decidePromptAction(before, { force });

const REASONS = {
  'hand-edited': 'AGENTS.md differs from the copy that was installed — hand-edited. Move what matters to .joserah/directives.md, then re-run with --force.',
  unrecorded: 'AGENTS.md carries no install record and differs from the current prompt — it predates prompt versioning or was hand-edited. Compare them, then re-run with --force.',
};

const out = {
  root,
  dryRun,
  source: { kind: source.kind, path: source.dir, version: source.version },
  before: { state: before.state, version: before.version, recordedVersion: before.recordedVersion },
  action,
  reason: action === 'refused' ? (REASONS[before.state] || 'refused') : null,
  saved: null,
};

if (action === 'refused') {
  console.log(JSON.stringify(out));
  process.exit(2);
}

// The displaced text is kept only when --force actually displaced something:
// a missing file has nothing to keep, and a behind-but-pristine file is the
// plugin's own text, already in the plugin's history.
const displacesOwnText = action === 'install' && force && !before.matchesSource
  && (before.state === 'hand-edited' || before.state === 'unrecorded');
if (displacesOwnText) out.saved = `AGENTS.md.replaced-${new Date().toISOString().slice(0, 10)}`;

if (!dryRun && action !== 'none') {
  if (out.saved) fs.copyFileSync(path.join(root, 'AGENTS.md'), path.join(root, out.saved));
  installPrompt(root, source, { recordOnly: action === 'record' });
}

console.log(JSON.stringify(out));
