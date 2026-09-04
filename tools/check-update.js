#!/usr/bin/env node
/**
 * check-update.js — is this workspace behind the installed plugin, or behind the current prompt?
 * Usage: node check-update.js <workspace-root>
 *
 * Deliberately offline and dependency-free: it compares the installed
 * plugin's version to the version recorded in the workspace. No npx, no
 * network, nothing that could be missing on the user's machine, and nothing
 * that needs a new PATH entry — on Windows a live terminal never sees one.
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Optional on purpose: this tool is reached when a workspace is misbehaving
// and must answer "could not tell" rather than crash if it is ever run from a
// copy without its lib/ beside it — the same fail-closed rule as the two
// readJson calls below.
let promptLib = null;
try {
  promptLib = require('./lib/prompt');
} catch {
  promptLib = null;
}

const root = path.resolve(process.argv[2] || process.cwd());
const cfgPath = path.join(root, '.joserah', 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error(`check-update: ${root} is not a Joserah workspace`);
  process.exit(1);
}

// Strips a leading UTF-8 BOM before parsing — PowerShell redirection and some
// Windows editors write one, and JSON.parse rejects it outright otherwise.
// This tool is reached through the doctor skill precisely when a workspace
// is misbehaving, so a truncated write, a sync conflict or a permission
// denial here must not crash: it means "could not tell", never a thrown
// stack trace and never a fabricated answer. Same convention as
// hooks/lib/workspace.js's readConfig and the settings-read block in
// tools/doctor.js.
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function cmp(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const installedJson = readJson(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'));
const workspaceJson = readJson(cfgPath);
const installed = installedJson ? installedJson.version : null;
const workspace = workspaceJson ? workspaceJson.createdByPluginVersion : null;
// Fail closed: either side missing or unparsable means "could not tell", not
// "behind" and not "current" — the caller must be able to distinguish this
// state from a real answer, so it is `null` rather than either boolean.
const behind = (installed != null && workspace != null) ? cmp(workspace, installed) < 0 : null;

// The prompt is versioned apart from the plugin (lib/prompt.js), so it has
// its own answer. Same fail-closed rule: an unreadable config or no source
// means "could not tell" (null), never a fabricated boolean. A hand-edited
// file is not "behind" — refreshing it is a decision, reported by doctor.
let prompt = { workspace: null, available: null, behind: null };
const source = promptLib ? promptLib.resolvePromptSource() : null;
if (workspaceJson && source) {
  const st = promptLib.promptState(root, workspaceJson, source);
  prompt = {
    workspace: st.version,
    available: source.version,
    behind: st.state === 'behind' || (st.state === 'unrecorded' && !st.matchesSource),
  };
}
console.log(JSON.stringify({ installed, workspace, behind, prompt }));
