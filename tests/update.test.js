'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT, fakeMarketplace } = require('./helpers');

test('check-update reports a workspace built by an older plugin as behind', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.createdByPluginVersion = '0.0.1';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = runTool('check-update.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.behind, true);
  assert.strictEqual(out.workspace, '0.0.1');
});

test('check-update reports a current workspace as not behind', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const out = JSON.parse(runTool('check-update.js', [dir]).stdout);
  assert.strictEqual(out.behind, false);
  assert.strictEqual(out.installed, out.workspace);
});

// This tool is reached through the doctor skill precisely when a workspace
// is misbehaving — a truncated write, a sync conflict or an editor crash
// still leaves config.json *present*, so it must not crash once it gets
// there. It must report "could not tell", not throw, and not fabricate
// behind: true/false.
test('check-update does not crash on a malformed workspace config.json, and reports it cannot tell', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  // Simulates an interrupted write: the file exists (passes the
  // existsSync guard) but is not valid JSON.
  fs.writeFileSync(cfgPath, '{ "createdByPluginVersion": "0.3.0"');
  const r = runTool('check-update.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /SyntaxError|at Module|at Object/);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.workspace, null);
  assert.strictEqual(out.behind, null);
});

// Same failure mode, other side: the installed plugin.json is the one that
// cannot be read. Runs an isolated copy of the tool rooted in a temp
// directory with no .claude-plugin/plugin.json at all, so the real plugin
// tree (which scaffold.js and every other test also depend on) is never
// touched or raced.
test('check-update does not crash when the installed plugin.json is missing, and reports it cannot tell', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);

  const fakePluginRoot = path.join(tmpdir(t), 'fake-plugin');
  fs.mkdirSync(path.join(fakePluginRoot, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'tools', 'check-update.js'),
    path.join(fakePluginRoot, 'tools', 'check-update.js'));
  // Deliberately no .claude-plugin/plugin.json under fakePluginRoot.

  const r = spawnSync(process.execPath,
    [path.join(fakePluginRoot, 'tools', 'check-update.js'), dir],
    { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /SyntaxError|Error:|at Module|at Object/);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.installed, null);
  assert.strictEqual(out.behind, null);
});

test('check-update reports the prompt as not behind on a fresh scaffold', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const out = JSON.parse(runTool('check-update.js', [dir]).stdout);
  assert.strictEqual(out.prompt.behind, false);
  assert.strictEqual(out.prompt.workspace, out.prompt.available);
});

test('check-update reports the prompt behind when the marketplace clone is newer', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const out = JSON.parse(runTool('check-update.js', [dir], { env: { CLAUDE_CONFIG_DIR: fakeMarketplace(t, 42) } }).stdout);
  assert.strictEqual(out.prompt.behind, true);
  assert.strictEqual(out.prompt.available, 42);
  assert.strictEqual(out.behind, false, 'the plugin itself is not behind');
});

test('check-update reports a pre-versioning AGENTS.md that differs as behind', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  delete cfg.promptVersion; delete cfg.promptSha256;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md — Core AI Folder\n');
  const out = JSON.parse(runTool('check-update.js', [dir]).stdout);
  assert.strictEqual(out.prompt.behind, true);
  assert.strictEqual(out.prompt.workspace, null);
});

test('check-update reports prompt.behind as null when config.json cannot be read', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{ "createdByPluginVersion": "0.3.0"');
  const out = JSON.parse(runTool('check-update.js', [dir]).stdout);
  assert.strictEqual(out.prompt.behind, null);
});
