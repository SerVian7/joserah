#!/usr/bin/env node
/**
 * check-update.js — is this workspace behind the installed plugin?
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

const root = path.resolve(process.argv[2] || process.cwd());
const cfgPath = path.join(root, '.joserah', 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error(`check-update: ${root} is not a Joserah workspace`);
  process.exit(1);
}

// Strips a leading UTF-8 BOM before parsing — PowerShell redirection and some
// Windows editors write one, and JSON.parse rejects it outright otherwise.
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }

function cmp(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const installed = readJson(path.join(__dirname, '..', '.claude-plugin', 'plugin.json')).version;
const workspace = readJson(cfgPath).createdByPluginVersion;
console.log(JSON.stringify({ installed, workspace, behind: cmp(workspace, installed) < 0 }));
