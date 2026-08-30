'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');
const pd = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));

test('denyFor owner returns exactly the base set', () => {
  const result = pd.denyFor('owner');
  assert.deepStrictEqual(result, pd.PERMISSION_DENY);
  assert.notStrictEqual(result, pd.PERMISSION_DENY, 'returns a copy, not the original');
});

test('denyFor owner copy is independent of the original', () => {
  const result = pd.denyFor('owner');
  result.push('mutated');
  assert.strictEqual(pd.PERMISSION_DENY.length, 9, 'original unchanged after mutation');
});

test('denyFor guest adds machine-control rules on top of the base set', () => {
  const rules = pd.denyFor('guest');
  for (const base of pd.PERMISSION_DENY) assert.ok(rules.includes(base), `keeps ${base}`);
  assert.ok(rules.some((r) => /shutdown/.test(r)), 'denies shutdown');
  assert.ok(rules.some((r) => /taskkill/.test(r)), 'denies taskkill');
  assert.ok(rules.some((r) => /docker/.test(r)), 'denies docker');
});

test('denyFor guest walls off each declared host path for read, edit and write', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['d:/atay'] });
  assert.ok(rules.includes('Read(//d/atay/**)'));
  assert.ok(rules.includes('Edit(//d/atay/**)'));
  assert.ok(rules.includes('Write(//d/atay/**)'));
});

test('denyFor rejects an unknown trust level rather than guessing', () => {
  assert.throws(() => pd.denyFor('sandboxed'), /unknown trust level/i);
});

test('toRulePath normalizes Windows paths with trailing slashes', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['d:/atay/'] });
  assert.ok(rules.includes('Read(//d/atay/**)'));
  assert.ok(rules.includes('Edit(//d/atay/**)'));
  assert.ok(rules.includes('Write(//d/atay/**)'));
});

test('toRulePath handles POSIX absolute paths for non-Windows hosts', () => {
  const rules = pd.denyFor('guest', { hostPaths: ['/home/ubuntu'] });
  assert.ok(rules.includes('Read(//home/ubuntu/**)'));
  assert.ok(rules.includes('Edit(//home/ubuntu/**)'));
  assert.ok(rules.includes('Write(//home/ubuntu/**)'));
});

const fs = require('fs');
const { tmpdir, runTool } = require('./helpers');

test('scaffold defaults to owner trust and records formatVersion 2', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.trust, 'owner');
  assert.strictEqual(cfg.formatVersion, 2);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepStrictEqual(s.permissions.deny, pd.PERMISSION_DENY);
});

test('scaffold --trust guest records it and writes the guest deny set', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js',
    ['--target', dir, '--workspace', 'w', '--trust', 'guest', '--host-path', 'd:/atay']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.trust, 'guest');
  // The rule landing in settings.json was the only thing this test ever
  // checked, which left it blind to the failure that actually mattered: the
  // host path was never recorded, so nothing could rebuild or verify the
  // wall afterwards.
  assert.strictEqual(cfg.hosting.hostPath, 'd:/atay',
    'the host path is recorded in config.json, not only compiled into a rule and forgotten');
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.permissions.deny.includes('Read(//d/atay/**)'));
  assert.ok(s.permissions.deny.some((r2) => /shutdown/.test(r2)));
});

test('scaffold --assistant records the assistant name', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--assistant', 'Rıfkı']);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.assistantName, 'Rıfkı');
});

test('scaffold no longer writes CLAUDE.md', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md is written');
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')), 'CLAUDE.md is not');
});

test('scaffold rejects an unknown trust level instead of guessing', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--trust', 'sandboxed']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /trust/i);
});

test('scaffold records consent when the model is named', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js',
    ['--target', dir, '--workspace', 'w', '--consent-model', 'Claude Opus 5']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.consent.model, 'Claude Opus 5');
  assert.strictEqual(cfg.consent.version, 1);
  assert.match(cfg.consent.askedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test('scaffold omits the consent block entirely when it was never asked', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual('consent' in cfg, false, 'absent, not a fabricated yes');
});

// --- CRITICAL 3 ------------------------------------------------------------
// --host-path generated three Read/Edit/Write rules and was then forgotten:
// nothing wrote hosting.hostPath into config.json, so doctor computed what it
// expected from an absent key (and certified a settings.json with every host
// rule deleted as "the full guest deny set"), while --settings-only — the
// path both the backup and doctor skills route a restore through — silently
// rebuilt the file without them. And the one hosted workspace in existence
// records a RELATIVE host path, which compiled to a rule matching nothing.

function guestWs(t, hostPath) {
  const base = tmpdir(t);
  const dir = path.join(base, 'guest');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w',
    '--owner', 'O', '--language', 'en', '--role', 'r',
    '--trust', 'guest', '--host-path', hostPath]);
  assert.strictEqual(r.status, 0, r.stderr);
  return dir;
}

function denySet(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).permissions.deny;
}

test('CRITICAL 3: a relative --host-path is recorded in config and compiled to an absolute rule', (t) => {
  const dir = guestWs(t, '../host');
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.trust, 'guest', 'trust persisted');
  assert.strictEqual(cfg.hosting.hostPath, '../host',
    'the host path is recorded, so a restore can reproduce the same rule set');
  const deny = denySet(dir);
  for (const rule of pd.denyFor('guest', { hostPaths: [path.resolve(dir, '../host')] })) {
    assert.ok(deny.includes(rule), 'missing ' + rule);
  }
  assert.ok(!deny.some((r) => r.includes('//../')),
    'never a rule anchored on an unresolved relative path, which can match nothing');
});

test('CRITICAL 3: doctor fails once the host deny rules are deleted by hand', (t) => {
  const dir = guestWs(t, '../host');
  const deny = denySet(dir);
  const hostRules = deny.filter((r) => /^(Read|Edit|Write)\(\/\//.test(r));
  assert.strictEqual(hostRules.length, 3, 'three host rules to remove');
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { deny: deny.filter((r) => !hostRules.includes(r)) } }, null, 2) + '\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL.*settings\.json \(present\).*missing 3 rule/);
});

test('CRITICAL 3: --settings-only rebuilds the host deny rules from config.json', (t) => {
  const dir = guestWs(t, '../host');
  const deny = denySet(dir);
  const hostRules = deny.filter((r) => /^(Read|Edit|Write)\(\/\//.test(r));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { deny: deny.filter((r) => !hostRules.includes(r)) } }, null, 2) + '\n');
  const r = runTool('scaffold.js', ['--settings-only', '--target', dir, '--force']);
  assert.strictEqual(r.status, 0, r.stderr);
  const after = denySet(dir);
  for (const rule of hostRules) assert.ok(after.includes(rule), 'restore lost ' + rule);
});

test('CRITICAL 3: doctor fails on a hosted workspace that records no trust level', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const s = runTool('scaffold.js', ['--target', dir, '--workspace', 'w',
    '--owner', 'O', '--language', 'en', '--role', 'r', '--kind', 'hosted']);
  assert.strictEqual(s.status, 0, s.stderr);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  delete cfg.trust;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL\s+trust level/);
  assert.doesNotMatch(r.stdout, /present with the full owner deny set/,
    'a hosted workspace must never be certified against the owner set by default');
});
