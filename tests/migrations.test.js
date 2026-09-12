'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');

const MIGRATIONS = path.join(PLUGIN_ROOT, 'docs', 'migrations');

function freshWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}

function editConfig(dir, mutate) {
  const p = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  mutate(cfg);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}

// The notes are matched by filename, so a note named anything else is not a
// note that doctor skips — it is a note nobody will ever be told about.
test('every structure note is named for a version, and none is from the future', () => {
  const version = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const files = fs.readdirSync(MIGRATIONS);
  assert.ok(files.length, 'docs/migrations is empty — the check reads it and would stay silent forever');
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  };
  for (const f of files) {
    assert.match(f, /^\d+\.\d+\.\d+\.md$/, `${f} is not named <version>.md and will never be read`);
    assert.ok(cmp(f.slice(0, -3), version) <= 0,
      `${f} is newer than the plugin's own version ${version} — every workspace would report itself behind`);
    assert.ok(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').trim().length > 200, `${f} says nothing`);
  }
});

test('doctor names the structure notes a workspace has not caught up to, and stops once it has', (t) => {
  const dir = freshWs(t);

  // A fresh scaffold is built by this very version: nothing to catch up on.
  const clean = runTool('doctor.js', [dir]);
  assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
  assert.doesNotMatch(clean.stdout, /structure migrations applied/);

  editConfig(dir, (c) => { c.createdByPluginVersion = '0.3.0'; delete c.migratedTo; });
  const behind = runTool('doctor.js', [dir]);
  assert.match(behind.stdout, /warn\s+structure migrations applied.*newer than 0\.3\.0/);
  assert.strictEqual(behind.status, 0, 'being behind on structure is a warning, not a failure');

  // migratedTo is what the update stamps, and it must win over the version
  // that merely created the workspace — otherwise the warning is permanent.
  const current = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  editConfig(dir, (c) => { c.migratedTo = current; });
  const done = runTool('doctor.js', [dir]);
  assert.doesNotMatch(done.stdout, /structure migrations applied/);
});

test('doctor asks for a sweep only once there are notes old enough to have gone stale', (t) => {
  const dir = freshWs(t);

  const fresh = runTool('doctor.js', [dir]);
  assert.doesNotMatch(fresh.stdout, /knowledge sweep/, 'a workspace made today has nothing to sweep');

  // Never swept, and created long enough ago that the prose has had time to
  // accumulate numbers nobody turned into claims.
  editConfig(dir, (c) => { c.created = '2026-01-01'; });
  const never = runTool('doctor.js', [dir]);
  assert.match(never.stdout, /warn\s+knowledge sweep.*never swept/);
  assert.strictEqual(never.status, 0);

  // A sweep that ran today silences it regardless of how old the workspace is.
  editConfig(dir, (c) => { c.lastSweep = new Date().toISOString(); });
  const swept = runTool('doctor.js', [dir]);
  assert.doesNotMatch(swept.stdout, /knowledge sweep/);

  // ...and a sweep that ran long ago does not.
  editConfig(dir, (c) => { c.lastSweep = '2026-02-01T00:00:00.000Z'; });
  const stale = runTool('doctor.js', [dir]);
  assert.match(stale.stdout, /warn\s+knowledge sweep.*days since the last one/);
});
