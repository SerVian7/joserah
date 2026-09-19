'use strict';
/**
 * An addon is an ordinary plugin the host installed; what makes it OURS is one
 * small file at its root, joserah.json, saying what it needs from a Joserah
 * workspace. Four keys, and no more:
 *
 *   tier         the addon's own word for what it is. Not validated here: the
 *                market design shows one value and never enumerates the rest,
 *                and a validator would be us deciding that on our own.
 *   minJoserah   the plugin version it needs.
 *   needs        { secrets: [NAMES], commands: [BINARIES] }. Vault NAMES only,
 *                never values — tools/secret.js's own rule.
 *   setup        a path inside the addon to its setup instructions.
 *
 * This file only READS. It installs nothing, enables nothing, and writes to no
 * settings file: what is installed is the host's business and the owner's.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function stringsOnly(v) {
  return Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : [];
}

function readAddonManifest(dir) {
  const doc = readJson(path.join(dir, 'joserah.json'));
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const needs = doc.needs && typeof doc.needs === 'object' ? doc.needs : {};
  return {
    tier: typeof doc.tier === 'string' ? doc.tier : '',
    minJoserah: typeof doc.minJoserah === 'string' ? doc.minJoserah : '',
    needs: { secrets: stringsOnly(needs.secrets), commands: stringsOnly(needs.commands) },
    setup: typeof doc.setup === 'string' ? doc.setup : '',
  };
}

/** Every installed plugin that carries a manifest, name-ascending. */
function installedAddons(dir = configDir()) {
  const doc = readJson(path.join(dir, 'plugins', 'installed_plugins.json'));
  const plugins = doc && doc.plugins && typeof doc.plugins === 'object' ? doc.plugins : {};
  const out = [];
  for (const name of Object.keys(plugins).sort()) {
    for (const install of [].concat(plugins[name] || [])) {
      if (!install || typeof install.installPath !== 'string') continue;
      const manifest = readAddonManifest(install.installPath);
      if (manifest) { out.push({ name, installPath: install.installPath, manifest }); break; }
    }
  }
  return out;
}

/**
 * Is this command on PATH? Looked up, never executed: the name comes from a
 * manifest we did not write, and running it to see whether it exists would be
 * running a stranger's choice of binary to answer a question about the PATH.
 */
function commandOnPath(cmd) {
  if (typeof cmd !== 'string' || !cmd || /[\/]/.test(cmd)) return false;
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try { if (fs.statSync(path.join(dir, cmd + ext)).isFile()) return true; } catch { /* next */ }
    }
  }
  return false;
}

module.exports = { configDir, readAddonManifest, installedAddons, commandOnPath };
