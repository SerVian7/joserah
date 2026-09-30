'use strict';
/**
 * The standing instructions (templates/AGENTS.md) are versioned apart from the
 * plugin: a `<!-- joserah:prompt-version N -->` line in the file itself. The
 * plugin's own copy lives in a version-numbered cache that only a plugin
 * update plus an IDE restart refreshes; the marketplace clone that Claude Code
 * keeps beside it (`plugins/marketplaces/joserah`) is a plain git checkout
 * that `claude plugin marketplace update joserah` brings current with no
 * restart at all. So the canonical source is whichever of the two carries the
 * higher prompt version — usually the clone.
 *
 * What was installed is recorded in .joserah/config.json (`promptVersion`,
 * `promptSha256`), so a later run can tell "behind" (bytes still match the
 * record, source is newer) from "hand-edited" (bytes no longer match the
 * record) — the second is never overwritten without --force.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { stampKey } = require('./config-stamp');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const PROMPT_VERSION_RE = /^<!--\s*joserah:prompt-version\s+(\d+)\s*-->\s*$/m;

function normalizeEol(s) { return s.replace(/\r\n/g, '\n'); }

function readPromptVersion(text) {
  const m = PROMPT_VERSION_RE.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

// Line endings and a BOM are checkout and editor conventions, not content —
// same reasoning as doctor.js's normalizeEol for every plugin-owned file.
function promptSha(text) {
  return crypto.createHash('sha256').update(normalizeEol(text.replace(/^\uFEFF/, '')), 'utf8').digest('hex');
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function defaultConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Claude Code records every added marketplace, with the directory it cloned
// it into, in plugins/known_marketplaces.json. Absent entry → no clone.
function marketplaceClone(configDir) {
  const known = readJson(path.join(configDir, 'plugins', 'known_marketplaces.json'));
  const entry = known && known.joserah;
  return entry && typeof entry.installLocation === 'string' ? entry.installLocation : null;
}

function candidate(kind, dir) {
  if (!dir) return null;
  const file = path.join(dir, 'templates', 'AGENTS.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const version = readPromptVersion(text);
  if (version === null) return null; // an unversioned template predates this scheme and cannot be compared
  return { kind, dir, file, text, version };
}

// `override` is an explicit path and wins outright, even when older — it is
// what a developer points at their own checkout, and what a test points at
// a fixture. Otherwise the highest version wins; on a tie the marketplace
// clone is preferred because it is the copy that can be refreshed without
// a restart.
function resolvePromptSource({ override = null, pluginRoot = PLUGIN_ROOT, configDir = defaultConfigDir() } = {}) {
  if (override) return candidate('override', override);
  const cands = [candidate('marketplace', marketplaceClone(configDir)), candidate('plugin', pluginRoot)].filter(Boolean);
  if (!cands.length) return null;
  return cands.reduce((best, c) => (c.version > best.version ? c : best));
}

function promptState(root, cfg, source) {
  const file = path.join(root, 'AGENTS.md');
  const recordedSha = cfg && typeof cfg.promptSha256 === 'string' ? cfg.promptSha256 : null;
  const recordedVersion = cfg && Number.isInteger(cfg.promptVersion) ? cfg.promptVersion : null;
  const base = { version: null, recordedVersion, matchesSource: false, available: source ? source.version : null };
  if (!fs.existsSync(file)) return { ...base, state: 'missing' };
  const text = fs.readFileSync(file, 'utf8');
  const sha = promptSha(text);
  const cur = { ...base, version: readPromptVersion(text), matchesSource: !!source && sha === promptSha(source.text) };
  if (!recordedSha) return { ...cur, state: 'unrecorded' };
  if (sha !== recordedSha) return { ...cur, state: 'hand-edited' };
  if (source && source.version > (cur.version === null ? -1 : cur.version)) return { ...cur, state: 'behind' };
  return { ...cur, state: 'current' };
}

// One decision shared by refresh-prompt.js and migrate.js, so the two can
// never disagree about what is safe to overwrite.
function decidePromptAction(state, { force = false } = {}) {
  switch (state.state) {
    case 'current': return 'none';
    case 'missing':
    case 'behind': return 'install';
    case 'unrecorded': return state.matchesSource ? 'record' : (force ? 'install' : 'refused');
    case 'hand-edited': return force ? 'install' : 'refused';
    default: return 'refused';
  }
}

// Writes the source bytes verbatim (the file is plugin-owned and carries no
// tokens to substitute), then records what was installed with the same
// narrow splice migrate.js uses for formatVersion. A config that cannot be
// parsed is left alone — doctor already reports that as its own failure.
function installPrompt(root, source, { recordOnly = false } = {}) {
  if (!recordOnly) fs.writeFileSync(path.join(root, 'AGENTS.md'), source.text, 'utf8');
  const cfgPath = path.join(root, '.joserah', 'config.json');
  const original = fs.readFileSync(cfgPath, 'utf8');
  let text = stampKey(original, 'promptVersion', source.version).text;
  text = stampKey(text, 'promptSha256', promptSha(source.text)).text;
  // Opened for writing only when a byte actually changes — same rule as
  // migrate.js's formatVersion stamp, so mtime is left alone otherwise.
  if (text !== original) fs.writeFileSync(cfgPath, text, 'utf8');
}

// Dotted version compare: negative when a < b, 0 when equal, positive when
// a > b. Missing components count as 0, so "0.4" equals "0.4.0".
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// The plugin's own version, installed (this tree) and available (the
// marketplace clone). The prompt travels without a plugin release; code —
// hooks, tools, skills — does not, so "a newer plugin exists" is a separate
// answer from "a newer prompt exists", and the owner is told separately.
function pluginVersions({ pluginRoot = PLUGIN_ROOT, configDir = defaultConfigDir() } = {}) {
  const read = (dir) => {
    const j = dir ? readJson(path.join(dir, '.claude-plugin', 'plugin.json')) : null;
    return j && typeof j.version === 'string' ? j.version : null;
  };
  return { installed: read(pluginRoot), available: read(marketplaceClone(configDir)) };
}

module.exports = {
  PROMPT_VERSION_RE, normalizeEol, readPromptVersion, promptSha,
  resolvePromptSource, promptState, decidePromptAction, installPrompt,
  marketplaceCloneDir: (configDir = defaultConfigDir()) => marketplaceClone(configDir),
  pluginVersions, compareVersions,
};
