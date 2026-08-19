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

function runTool(tool, args, opts = {}) {
  return spawnSync(process.execPath,
    [path.join(PLUGIN_ROOT, 'tools', tool), ...args],
    { encoding: 'utf8', ...opts });
}

module.exports = { PLUGIN_ROOT, tmpdir, runTool };
