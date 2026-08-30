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
    { encoding: 'utf8', ...rest, ...(env ? { env: { ...process.env, ...env } } : {}) });
}

module.exports = { PLUGIN_ROOT, tmpdir, runTool };
