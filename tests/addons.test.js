'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir } = require('./helpers');

const addons = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'addon-manifest'));

// A config directory shaped like the host's own: plugins/installed_plugins.json
// records every install and where it was unpacked. One of the two installs
// below carries a joserah.json and is therefore an addon; the other is an
// ordinary plugin and must be ignored rather than reported as broken.
function configWithAddon(t, manifest) {
  const dir = tmpdir(t);
  const installPath = path.join(dir, 'cache', 'market', 'demo-addon', '0.1.0');
  fs.mkdirSync(installPath, { recursive: true });
  if (manifest !== null) {
    fs.writeFileSync(path.join(installPath, 'joserah.json'), JSON.stringify(manifest, null, 2));
  }
  const other = path.join(dir, 'cache', 'elsewhere', 'plain', '1.0.0');
  fs.mkdirSync(other, { recursive: true });
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'demo-addon@market': [{ scope: 'user', installPath, version: '0.1.0' }],
      'plain@elsewhere': [{ scope: 'user', installPath: other, version: '1.0.0' }],
    },
  }, null, 2));
  return { dir, installPath };
}

const FULL = {
  tier: 'open',
  minJoserah: '0.14.0',
  needs: { secrets: ['demo.service.api-token'], commands: ['git'] },
  setup: 'setup/SETUP.md',
};

test('an installed addon is one the host installed that carries a joserah.json', (t) => {
  const { dir, installPath } = configWithAddon(t, FULL);
  const found = addons.installedAddons(dir);
  assert.strictEqual(found.length, 1, 'a plugin without a manifest is not an addon');
  assert.strictEqual(found[0].name, 'demo-addon@market');
  assert.strictEqual(found[0].installPath, installPath);
  assert.deepStrictEqual(found[0].manifest, FULL);
});

test('no install record at all is no addons, not a crash', (t) => {
  assert.deepStrictEqual(addons.installedAddons(tmpdir(t)), []);
});

test('a manifest missing keys reads as empty ones, never as undefined', (t) => {
  const { installPath } = configWithAddon(t, { tier: 'open' });
  assert.deepStrictEqual(addons.readAddonManifest(installPath), {
    tier: 'open', minJoserah: '', needs: { secrets: [], commands: [] }, setup: '',
  });
});

test('a manifest that is not JSON, and a directory without one, are both no manifest', (t) => {
  const { installPath } = configWithAddon(t, null);
  assert.strictEqual(addons.readAddonManifest(installPath), null);
  fs.writeFileSync(path.join(installPath, 'joserah.json'), '{ not json');
  assert.strictEqual(addons.readAddonManifest(installPath), null);
});

test('needs.secrets holds names only, and anything not a string is dropped', (t) => {
  const { installPath } = configWithAddon(t,
    { needs: { secrets: ['a.b.token', 42, null], commands: ['gh', {}] } });
  const m = addons.readAddonManifest(installPath);
  assert.deepStrictEqual(m.needs.secrets, ['a.b.token']);
  assert.deepStrictEqual(m.needs.commands, ['gh']);
});

test('commandOnPath finds the running interpreter and not a name nobody has', () => {
  assert.strictEqual(addons.commandOnPath('node'), true);
  assert.strictEqual(addons.commandOnPath('zzz-no-such-command'), false);
});

test('the contract is written down where an addon author can read it', () => {
  const doc = fs.readFileSync(path.join(PLUGIN_ROOT, 'docs', 'addons.md'), 'utf8');
  for (const must of ['joserah.json', 'tier', 'minJoserah', 'needs', 'setup',
    '.joserah/tools/secret.js', 'official', 'custom', 'sha']) {
    assert.ok(doc.includes(must), `docs/addons.md does not mention ${must}`);
  }
});

const { runTool } = require('./helpers');
const { CHECKS } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'doctor-checks'));

function workspace(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'A B',
    '--language', 'English', '--role', '']);
  return dir;
}

test('the registry carries the addon check, and it is a data change', () => {
  assert.ok(CHECKS.some((c) => c.id === 'addon-needs'), 'no addon-needs entry');
});

test('a workspace with no addons installed says nothing about addons', (t) => {
  const r = runTool('doctor.js', [workspace(t)], { env: { CLAUDE_CONFIG_DIR: tmpdir(t) } });
  assert.strictEqual(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /addon/i, 'an owner with no addons hears nothing about them');
});

test('an addon whose needs are unmet is a warning that names what is missing', (t) => {
  const { dir } = configWithAddon(t, {
    tier: 'open', minJoserah: '0.14.0',
    needs: { secrets: ['demo.service.api-token'], commands: ['zzz-no-such-command'] },
    setup: 'setup/SETUP.md',
  });
  const r = runTool('doctor.js', [workspace(t)], { env: { CLAUDE_CONFIG_DIR: dir } });
  assert.strictEqual(r.status, 0, 'an unmet addon need is a warning, not a failure');
  assert.match(r.stdout, /warn\s+addon demo-addon@market/);
  assert.match(r.stdout, /demo\.service\.api-token/, 'the missing secret is named');
  assert.match(r.stdout, /zzz-no-such-command/, 'the missing command is named');
  assert.match(r.stdout, /warning\(s\)/, 'the summary line carries the warning count');
});

test('an addon whose needs are met reports ok, and no value is ever printed', (t) => {
  const ws = workspace(t);
  const { dir } = configWithAddon(t, {
    tier: 'open', needs: { secrets: ['demo.service.api-token'], commands: ['node'] }, setup: '',
  });
  const set = runTool('secret.js', ['--set', 'demo.service.api-token'],
    { cwd: ws, input: 'not-a-real-value' });
  assert.strictEqual(set.status, 0, set.stderr);
  const r = runTool('doctor.js', [ws], { env: { CLAUDE_CONFIG_DIR: dir } });
  assert.match(r.stdout, /ok\s+addon demo-addon@market/);
  assert.doesNotMatch(r.stdout, /not-a-real-value/, 'doctor printed a vault value');
  assert.doesNotMatch(r.stdout, /warn\s+addon/);
});
