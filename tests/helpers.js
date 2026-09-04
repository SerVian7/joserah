'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Tools that resolve the prompt source read plugins/known_marketplaces.json
// under CLAUDE_CONFIG_DIR (default ~/.claude). A test must never see the
// developer's real marketplace clone — its prompt version would decide whether
// "doctor passes a fresh scaffold" passes — so every child gets an empty
// config dir unless the test supplies its own via `env`.
const HERMETIC_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-config-'));
process.on('exit', () => fs.rmSync(HERMETIC_CONFIG_DIR, { recursive: true, force: true }));

// An `env` override is merged over the real environment rather than handed to
// spawnSync as-is: spawnSync treats a present `env` key as the child's WHOLE
// environment, and on Windows that blanks things unrelated to whatever the
// caller meant to change (SystemRoot, TEMP, ...) and can stop the child from
// starting at all. A caller that wants `gh` (say) to fail to resolve passes
// only `{ PATH: '' }`; every other variable it needs keeps working.
function runTool(tool, args, opts = {}) {
  const { env, ...rest } = opts;
  return spawnSync(process.execPath,
    [path.join(PLUGIN_ROOT, 'tools', tool), ...args],
    { encoding: 'utf8', ...rest, env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC_CONFIG_DIR, ...(env || {}) } });
}

// A config dir whose known_marketplaces.json points at a fake marketplace
// clone carrying templates/AGENTS.md at `version` — the real template with only
// its version line replaced, so a "behind" test differs from the plugin's copy
// in exactly one number. `mutate(text)` may alter the body further.
function fakeMarketplace(t, version, mutate) {
  const configDir = tmpdir(t);
  const clone = path.join(configDir, 'clone');
  fs.mkdirSync(path.join(clone, 'templates'), { recursive: true });
  let text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8')
    .replace(/<!--\s*joserah:prompt-version\s+\d+\s*-->/, `<!-- joserah:prompt-version ${version} -->`);
  if (mutate) text = mutate(text);
  fs.writeFileSync(path.join(clone, 'templates', 'AGENTS.md'), text, 'utf8');
  fs.mkdirSync(path.join(configDir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({ joserah: { source: { source: 'git', url: 'https://example.invalid/joserah.git' }, installLocation: clone } }, null, 2));
  return configDir;
}

module.exports = { PLUGIN_ROOT, tmpdir, runTool, fakeMarketplace };
