'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool, fakeMarketplace } = require('./helpers');
const prompt = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'prompt'));

const TEMPLATE = path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md');

function freshWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}
function readCfg(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
}

// ---- lib/prompt.js ------------------------------------------------------------

test('the template carries a prompt version and the library reads it', () => {
  const v = prompt.readPromptVersion(fs.readFileSync(TEMPLATE, 'utf8'));
  assert.ok(Number.isInteger(v) && v >= 1, `got ${v}`);
  assert.strictEqual(prompt.readPromptVersion('# no marker\n'), null);
});

test('promptSha ignores line endings and a BOM', () => {
  const lf = '<!-- joserah:prompt-version 1 -->\n# A\n\ntext\n';
  assert.strictEqual(prompt.promptSha(lf), prompt.promptSha(lf.replace(/\n/g, '\r\n')));
  assert.strictEqual(prompt.promptSha(lf), prompt.promptSha('\uFEFF' + lf));
  assert.notStrictEqual(prompt.promptSha(lf), prompt.promptSha(lf + 'x'));
});

test('resolvePromptSource falls back to the plugin when no marketplace clone is known', (t) => {
  const src = prompt.resolvePromptSource({ configDir: tmpdir(t) });
  assert.strictEqual(src.kind, 'plugin');
  assert.strictEqual(src.file, TEMPLATE);
});

test('resolvePromptSource prefers the marketplace clone when its prompt is newer', (t) => {
  const configDir = fakeMarketplace(t, 99);
  const src = prompt.resolvePromptSource({ configDir });
  assert.strictEqual(src.kind, 'marketplace');
  assert.strictEqual(src.version, 99);
});

test('resolvePromptSource keeps the plugin copy when the clone is older', (t) => {
  const configDir = fakeMarketplace(t, 0);
  const src = prompt.resolvePromptSource({ configDir });
  assert.strictEqual(src.kind, 'plugin');
});

test('resolvePromptSource honours an explicit override even when older', (t) => {
  const configDir = fakeMarketplace(t, 99);
  const override = path.join(tmpdir(t), 'src');
  fs.mkdirSync(path.join(override, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(override, 'templates', 'AGENTS.md'), '<!-- joserah:prompt-version 0 -->\n# x\n');
  const src = prompt.resolvePromptSource({ configDir, override });
  assert.strictEqual(src.kind, 'override');
  assert.strictEqual(src.version, 0);
});

test('resolvePromptSource returns null when no candidate carries a version line', (t) => {
  const fakePlugin = path.join(tmpdir(t), 'plugin');
  fs.mkdirSync(path.join(fakePlugin, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(fakePlugin, 'templates', 'AGENTS.md'), '# unversioned\n');
  assert.strictEqual(prompt.resolvePromptSource({ configDir: tmpdir(t), pluginRoot: fakePlugin }), null);
});

test('promptState: fresh scaffold is current; edits are hand-edited; a newer source is behind', (t) => {
  const dir = freshWs(t);
  const plugin = prompt.resolvePromptSource({ configDir: tmpdir(t) });
  assert.strictEqual(prompt.promptState(dir, readCfg(dir), plugin).state, 'current');

  const newer = prompt.resolvePromptSource({ configDir: fakeMarketplace(t, 99) });
  const behind = prompt.promptState(dir, readCfg(dir), newer);
  assert.strictEqual(behind.state, 'behind');
  assert.strictEqual(behind.available, 99);

  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nmy own rule\n');
  assert.strictEqual(prompt.promptState(dir, readCfg(dir), plugin).state, 'hand-edited');

  fs.unlinkSync(path.join(dir, 'AGENTS.md'));
  assert.strictEqual(prompt.promptState(dir, readCfg(dir), plugin).state, 'missing');
});

test('promptState: no record means unrecorded, with matchesSource telling the two cases apart', (t) => {
  const dir = freshWs(t);
  const plugin = prompt.resolvePromptSource({ configDir: tmpdir(t) });
  const cfg = readCfg(dir);
  delete cfg.promptVersion; delete cfg.promptSha256;
  const same = prompt.promptState(dir, cfg, plugin);
  assert.strictEqual(same.state, 'unrecorded');
  assert.strictEqual(same.matchesSource, true);

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md — Core AI Folder\n\nold generation\n');
  const differs = prompt.promptState(dir, cfg, plugin);
  assert.strictEqual(differs.state, 'unrecorded');
  assert.strictEqual(differs.matchesSource, false);
  assert.strictEqual(differs.version, null);
});

test('decidePromptAction', () => {
  const d = prompt.decidePromptAction;
  assert.strictEqual(d({ state: 'current' }, {}), 'none');
  assert.strictEqual(d({ state: 'missing' }, {}), 'install');
  assert.strictEqual(d({ state: 'behind' }, {}), 'install');
  assert.strictEqual(d({ state: 'unrecorded', matchesSource: true }, {}), 'record');
  assert.strictEqual(d({ state: 'unrecorded', matchesSource: false }, {}), 'refused');
  assert.strictEqual(d({ state: 'unrecorded', matchesSource: false }, { force: true }), 'install');
  assert.strictEqual(d({ state: 'hand-edited' }, {}), 'refused');
  assert.strictEqual(d({ state: 'hand-edited' }, { force: true }), 'install');
});

test('installPrompt writes the file and records version + sha; recordOnly leaves the file alone', (t) => {
  const dir = freshWs(t);
  const src = prompt.resolvePromptSource({ configDir: fakeMarketplace(t, 7) });
  prompt.installPrompt(dir, src);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), src.text);
  let cfg = readCfg(dir);
  assert.strictEqual(cfg.promptVersion, 7);
  assert.strictEqual(cfg.promptSha256, prompt.promptSha(src.text));

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'untouched\n');
  const other = prompt.resolvePromptSource({ configDir: fakeMarketplace(t, 8) });
  prompt.installPrompt(dir, other, { recordOnly: true });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'untouched\n');
  cfg = readCfg(dir);
  assert.strictEqual(cfg.promptVersion, 8);
});
