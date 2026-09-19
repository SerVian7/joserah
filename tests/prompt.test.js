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

// ---- refresh-prompt.js -------------------------------------------------------

test('refresh-prompt: a current workspace is left alone (action none)', (t) => {
  const dir = freshWs(t);
  const r = runTool('refresh-prompt.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.action, 'none');
  assert.strictEqual(out.before.state, 'current');
});

test('refresh-prompt: installs a newer prompt from the marketplace clone and records it', (t) => {
  const dir = freshWs(t);
  const configDir = fakeMarketplace(t, 42);
  const r = runTool('refresh-prompt.js', [dir], { env: { CLAUDE_CONFIG_DIR: configDir } });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.action, 'install');
  assert.strictEqual(out.source.kind, 'marketplace');
  assert.strictEqual(out.source.version, 42);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /prompt-version 42/);
  assert.strictEqual(readCfg(dir).promptVersion, 42);
  // Second run: nothing left to do.
  const again = JSON.parse(runTool('refresh-prompt.js', [dir], { env: { CLAUDE_CONFIG_DIR: configDir } }).stdout);
  assert.strictEqual(again.action, 'none');
});

test('refresh-prompt --dry-run reports the install without writing', (t) => {
  const dir = freshWs(t);
  const before = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const r = runTool('refresh-prompt.js', [dir, '--dry-run'], { env: { CLAUDE_CONFIG_DIR: fakeMarketplace(t, 42) } });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.action, 'install');
  assert.strictEqual(out.dryRun, true);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), before);
  assert.notStrictEqual(readCfg(dir).promptVersion, 42);
});

test('refresh-prompt refuses a hand-edited AGENTS.md with exit 2, and --force replaces it keeping the old text', (t) => {
  const dir = freshWs(t);
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nmy own rule\n');
  const configDir = fakeMarketplace(t, 42);
  const refused = runTool('refresh-prompt.js', [dir], { env: { CLAUDE_CONFIG_DIR: configDir } });
  assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
  const out = JSON.parse(refused.stdout);
  assert.strictEqual(out.action, 'refused');
  assert.strictEqual(out.before.state, 'hand-edited');
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /my own rule/);

  const forced = runTool('refresh-prompt.js', [dir, '--force'], { env: { CLAUDE_CONFIG_DIR: configDir } });
  assert.strictEqual(forced.status, 0, forced.stderr);
  const f = JSON.parse(forced.stdout);
  assert.strictEqual(f.action, 'install');
  assert.match(f.saved, /^AGENTS\.md\.replaced-\d{4}-\d{2}-\d{2}$/);
  assert.match(fs.readFileSync(path.join(dir, f.saved), 'utf8'), /my own rule/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /my own rule/);
  assert.strictEqual(readCfg(dir).promptVersion, 42);
});

test('refresh-prompt on a pre-versioning workspace: byte-identical is recorded, different is refused', (t) => {
  const dir = freshWs(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = readCfg(dir);
  delete cfg.promptVersion; delete cfg.promptSha256;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  const recorded = JSON.parse(runTool('refresh-prompt.js', [dir]).stdout);
  assert.strictEqual(recorded.action, 'record');
  assert.ok(Number.isInteger(readCfg(dir).promptVersion));

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md — Core AI Folder\n\nold generation\n');
  const r = runTool('refresh-prompt.js', [dir]);
  assert.strictEqual(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.action, 'refused');
  assert.strictEqual(out.before.state, 'unrecorded');
  assert.match(out.reason, /--force/);
});

test('refresh-prompt installs a missing AGENTS.md without needing --force', (t) => {
  const dir = freshWs(t);
  fs.unlinkSync(path.join(dir, 'AGENTS.md'));
  const r = runTool('refresh-prompt.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).action, 'install');
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
});

test('refresh-prompt --source uses the given checkout even when older', (t) => {
  const dir = freshWs(t);
  const src = path.join(tmpdir(t), 'checkout');
  fs.mkdirSync(path.join(src, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(src, 'templates', 'AGENTS.md'), '<!-- joserah:prompt-version 0 -->\n# older\n');
  // The workspace is at the plugin's version; an older override is "current" by comparison — nothing to do.
  const r = runTool('refresh-prompt.js', [dir, '--source', src]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.source.kind, 'override');
  assert.strictEqual(out.action, 'none');
});

test('refresh-prompt exits 1 outside a workspace', (t) => {
  const r = runTool('refresh-prompt.js', [tmpdir(t)]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not a Joserah workspace/);
});

// ---- plugin versions -----------------------------------------------------------

test('compareVersions orders dotted versions and treats missing components as zero', () => {
  const c = prompt.compareVersions;
  assert.ok(c('0.4.1', '0.4.0') > 0);
  assert.ok(c('0.4.0', '0.10.0') < 0);
  assert.strictEqual(c('0.4', '0.4.0'), 0);
  assert.ok(c(null, '0.0.1') < 0);
});

test('pluginVersions reads the installed plugin and the marketplace clone, null when absent', (t) => {
  const installed = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const none = prompt.pluginVersions({ configDir: tmpdir(t) });
  assert.strictEqual(none.installed, installed);
  assert.strictEqual(none.available, null);
  const some = prompt.pluginVersions({ configDir: fakeMarketplace(t, 1, null, { pluginVersion: '9.9.9' }) });
  assert.strictEqual(some.available, '9.9.9');
});

// ---- the shipped prompt ---------------------------------------------------------

test('prompt v6 carries the claim-line obligations, the role default, the vault, and names no third-party skill', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  assert.strictEqual(prompt.readPromptVersion(text), 6);
  assert.ok(text.includes('goes into the vault at once, without asking'), 'rule 3: the vault');
  assert.ok(text.includes('$(node .joserah/tools/secret.js <name>)'), 'rule 3: embedded use only');
  assert.match(text, /\[measurement\|calculation\|decision\|estimate\]/);
  assert.match(text, /the measurement speaks/);
  assert.match(text, /default role .* is the brain/i);
  assert.doesNotMatch(text, /superpowers/i, 'Joserah names no third-party plugin (owner, 2026-09-12)');
  assert.doesNotMatch(text, /(^|[^a-z])raw\//m, 'the source folder is imports/');
});

// 0.9.0: the behaviour rules the owner decided on 2026-09-12 belong in every
// installation. Only the ones a plain MCP server can honour are here — work
// distribution and model choice are a harness capability, not a promise the
// product can keep everywhere, so they stayed out. Each id below is asserted by
// a phrase distinctive enough that a rewrite dropping the rule fails, and short
// enough that rewording the sentence around it does not.
test('prompt v6 carries every behaviour rule the owner put in the native prompt', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const rules = {
    // A — character, toward the owner
    A3: 'the one thing they must do',
    A4: 'Filing is not reporting',
    A5: 'never an internal label',
    A6: 'version numbers, tool names',
    A7: 'Take the general rule out of it',
    A8: '"not found" beats a guess',
    // B — decision
    B1: 'both are read, the measurement speaks',
    B2: 'A number never travels without its conditions',
    B3: 'the first plausible answer is not the answer',
    B4: 'the struck line is not used again',
    B5: 'a number with no source carries no weight',
    B7: 'The example they give is not the scope',
    B8: 'the incident not retold',
    B9: 'approve one they have not seen',
    B12: 'Cite a source only after opening it',
    // C — role, and the end of a session
    C6: 'default role in every session is the brain',
    C8: 'one entry point, one first task, the prompt to paste',
    // D — verification
    D1: 'No output, no claim',
    D2: 'the live system is the authority',
  };
  for (const [id, phrase] of Object.entries(rules)) {
    assert.ok(text.includes(phrase), `rule ${id} missing from the prompt: "${phrase}"`);
  }
});

// The file grew by accumulation twice and was cut twice (0.4.0: 235 -> 201;
// 0.9.0: 231 -> under 200 while taking nineteen rules in). Every addition is
// defensible on its own, which is exactly how the whole gets worse. The closing
// note names the limit; this test is what makes the note true.
test('the shipped prompt stays under the line limit its own closing note sets', () => {
  const lines = fs.readFileSync(TEMPLATE, 'utf8').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  assert.ok(lines.length <= 200, `templates/AGENTS.md is ${lines.length} lines; the limit is 200`);
});

// 0.7.0: the role file and the workspace's directives are injected at session
// start. A prompt that still sends the session off to open them is telling it
// to fetch text it was already handed — wasteful, and confusing about which
// copy is authoritative.
test('the prompt does not send a session to open the two layers it is already given', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const head = text.slice(0, text.indexOf('## 1.'));
  assert.doesNotMatch(head, /Read next/, 'the "read next" instruction is what changed');
  assert.match(head, /injected/, 'it has to say the two layers are already in context');
  assert.match(head, /JOSERAH-ROLE\.md/);
  assert.match(head, /directives\.md/);
  assert.match(head, /Directives win/, 'which layer wins is still stated');
});
