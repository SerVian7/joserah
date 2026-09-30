'use strict';
// 0.14.0: install is one prompt. The setup skill notices which assistant it is
// running in, links the checkout into ~/.claude/skills for Claude Code or falls
// back to AGENTS.md-only mode, then asks only what a newcomer can answer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');
const { CHECKS } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'doctor-checks'));

// ---- detect-harness ---------------------------------------------------------
function detect(t, { claudecode = '', home, pathDir } = {}) {
  home = home || tmpdir(t);
  const r = runTool('detect-harness.js', [], { env: {
    CLAUDECODE: claudecode, HOME: home, USERPROFILE: home, PATH: pathDir || tmpdir(t), Path: pathDir || tmpdir(t) } });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('detect-harness: CLAUDECODE=1 means this is Claude Code', (t) => {
  const out = detect(t, { claudecode: '1' });
  assert.strictEqual(out.harness, 'claude-code');
  assert.ok(out.evidence.some((e) => e.includes('CLAUDECODE=1')));
});

test('detect-harness: Antigravity is reported only from the folders its docs name', (t) => {
  const home = tmpdir(t);
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity-cli'), { recursive: true });
  const out = detect(t, { home });
  assert.strictEqual(out.harness, 'antigravity');
  assert.ok(out.evidence.some((e) => e.includes('antigravity-cli')));
});

test('detect-harness: ~/.claude alone means Claude Code is installed; nothing means unknown', (t) => {
  const home = tmpdir(t);
  fs.mkdirSync(path.join(home, '.claude'));
  assert.strictEqual(detect(t, { home }).harness, 'claude-code');
  assert.deepStrictEqual(detect(t), { harness: 'unknown', evidence: [] });
});

// ---- doctor: where the plugin is loaded from ----------------------------------
const location = CHECKS.find((c) => c.id === 'plugin-location');
function withHome(home, fn) {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// A throwaway checkout, never the repository itself: the link is removed with
// its temp dir, and nothing may ever be able to reach the real tree that way.
function fakeCheckout(t) {
  const root = tmpdir(t);
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'tools'));
  return root;
}

test('doctor: a checkout linked into ~/.claude/skills is ok', (t) => {
  const home = tmpdir(t);
  const checkout = fakeCheckout(t);
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(checkout, path.join(home, '.claude', 'skills', 'joserah'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = withHome(home, () => location.run({ pluginDir: path.join(checkout, 'tools') }));
  assert.strictEqual(r.ok, true);
  assert.ok(!r.warn, r.detail);
  assert.match(r.detail, /skills/);
});

test('doctor: a copy in the plugin cache, or no link at all, warns with the move', (t) => {
  const home = tmpdir(t);
  const cache = path.join(home, '.claude', 'plugins', 'cache', 'joserah', 'joserah', '0.13.10');
  fs.mkdirSync(path.join(cache, 'tools'), { recursive: true });
  const cached = withHome(home, () => location.run({ pluginDir: path.join(cache, 'tools') }));
  assert.strictEqual(cached.warn, true);
  assert.match(cached.detail, /plugin cache/);
  assert.match(cached.detail, /\.claude[\\/]skills[\\/]joserah/);
  const unlinked = withHome(tmpdir(t), () => location.run({ pluginDir: path.join(fakeCheckout(t), 'tools') }));
  assert.strictEqual(unlinked.warn, true);
  assert.match(unlinked.detail, /AGENTS\.md-only/);
});

// ---- scaffold defaults --------------------------------------------------------
test('scaffold defaults: owner trust, home kind, and no consent, identity or feedback block', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'Berkay', '--language', 'Turkish',
    '--consent-model', 'X', '--identity-mode', 'auto']);
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.trust, 'owner');
  assert.strictEqual(cfg.kind, 'home');
  assert.strictEqual(cfg.ownerName, 'Berkay');
  for (const key of ['consent', 'identity', 'feedback']) assert.ok(!(key in cfg), `${key} written`);
});

// ---- the setup skill ------------------------------------------------------------
const SETUP = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'setup', 'SKILL.md'), 'utf8');

test('setup triggers on "install Joserah", in English and Turkish', () => {
  const description = /^description:(.*)$/m.exec(SETUP)[1];
  assert.match(description, /Install Joserah/i);
  assert.match(description, /Joserah'ı kur/);
});

test('setup notices the assistant first, and asks only what a newcomer can answer', () => {
  const flat = SETUP.replace(/\s+/g, ' ');
  assert.ok(flat.includes('detect-harness.js'), 'harness detection');
  assert.ok(flat.indexOf('detect-harness.js') < flat.indexOf('scaffold.js'), 'before anything is created');
  assert.ok(flat.includes('.claude/skills/joserah'), 'the link for Claude Code');
  assert.ok(flat.includes('AGENTS.md-only mode'), 'the fallback');
  for (const gone of ['act on this machine, or only inside this folder', 'keep itself up to date',
    '--identity-mode', '--consent-model', 'Then offer feedback', 'what it is for here', 'Ask for consent']) {
    assert.ok(!flat.includes(gone), `still asks: ${gone}`);
  }
  assert.ok(/--hosted/.test(flat), 'hosting only on an explicit developer request');
});

// Owner, 2026-09-30: the interview's one open question ends with the file drop.
test('the interview\'s open question invites files into imports/', () => {
  assert.ok(SETUP.replace(/\s+/g, ' ').includes(
    'or drop any files you want me to know about into the `imports/` folder and I will read them.'));
});
