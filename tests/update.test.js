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

test('check-update reports a newer plugin in the marketplace clone as `newer`, separately from the prompt', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const promptV = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8')).promptVersion;
  const out = JSON.parse(runTool('check-update.js', [dir], { env: { CLAUDE_CONFIG_DIR: fakeMarketplace(t, promptV, null, { pluginVersion: '99.0.0' }) } }).stdout);
  assert.strictEqual(out.available, '99.0.0');
  assert.strictEqual(out.newer, true);
  assert.strictEqual(out.prompt.behind, false);
  const none = JSON.parse(runTool('check-update.js', [dir]).stdout);
  assert.strictEqual(none.available, null);
  assert.strictEqual(none.newer, null);
});

// 0.13.6: the skill pulls the checkout, not ${CLAUDE_PLUGIN_ROOT} — that is
// the cache copy. check-update names the checkout and its marketplace.
test('check-update names the directory-marketplace checkout and the marketplace it is registered as', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const base = tmpdir(t);
  const checkout = path.join(base, 'checkout');
  fs.mkdirSync(path.join(checkout, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'joserah', version: '9.9.9' }));
  fs.mkdirSync(path.join(base, 'plugins'));
  fs.writeFileSync(path.join(base, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({ mine: { source: { source: 'directory', path: checkout }, installLocation: checkout } }));
  const out = JSON.parse(runTool('check-update.js', [dir], { env: { CLAUDE_CONFIG_DIR: base } }).stdout);
  assert.deepStrictEqual(out.checkout, { marketplace: 'mine', path: checkout, version: '9.9.9' });
  assert.strictEqual(JSON.parse(runTool('check-update.js', [dir]).stdout).checkout, null);
});

// 0.13.10: the developer's checkout — a pull or a commit there re-copies the
// plugin by itself, so one restart is all that is left. Installed by hand only.
test('install-dev-hook writes marked post-merge and post-commit hooks, idempotently, and never a foreign one', (t) => {
  const repo = tmpdir(t);
  spawnSync('git', ['init', '-q', repo]);
  const run = () => JSON.parse(runTool('install-dev-hook.js', [repo]).stdout);
  assert.deepStrictEqual(run(), { 'post-merge': 'created', 'post-commit': 'created' });
  for (const name of ['post-merge', 'post-commit']) {
    const text = fs.readFileSync(path.join(repo, '.git', 'hooks', name), 'utf8');
    assert.match(text, /^#!\/bin\/sh\n# joserah:dev-hook/);
    assert.match(text, /claude plugin update joserah@joserah/);
  }
  assert.deepStrictEqual(run(), { 'post-merge': 'current', 'post-commit': 'current' });
  fs.writeFileSync(path.join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho mine\n');
  assert.deepStrictEqual(run(), { 'post-merge': 'current', 'post-commit': 'foreign' });
  assert.strictEqual(fs.readFileSync(path.join(repo, '.git', 'hooks', 'post-commit'), 'utf8'), '#!/bin/sh\necho mine\n');
  assert.strictEqual(runTool('install-dev-hook.js', [tmpdir(t)]).status, 1, 'not a git checkout');
});
