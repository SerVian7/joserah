'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

test('AGENTS.md is byte-identical across workspaces with different identities', (t) => {
  const base = tmpdir(t);
  const a = path.join(base, 'a'), b = path.join(base, 'b');
  runTool('scaffold.js', ['--target', a, '--workspace', 'alpha',
    '--owner', 'Ada Lovelace', '--language', 'English', '--assistant', 'Byron']);
  runTool('scaffold.js', ['--target', b, '--workspace', 'beta',
    '--owner', 'Selvi D. Doruca', '--language', 'Turkish', '--assistant', 'Yarkın']);
  assert.strictEqual(
    fs.readFileSync(path.join(a, 'AGENTS.md'), 'utf8'),
    fs.readFileSync(path.join(b, 'AGENTS.md'), 'utf8'));
});

test('AGENTS.md carries no template tokens and no owner name', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'Ada Lovelace']);
  const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(text, /\{\{/, 'no unsubstituted tokens');
  assert.doesNotMatch(text, /Ada Lovelace/, 'owner name is not baked in');
});

test('the shipped core AGENTS.md states the audience and privilege rules', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  for (const phrase of ['assistantName', 'developer', 'sudo', 'guardrail, not a sandbox']) {
    assert.ok(text.includes(phrase), `core AGENTS.md mentions ${phrase}`);
  }
});

test('the shipped core AGENTS.md forbids starving the machine, inline or delegated', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  for (const phrase of [
    "bottlenecks the machine's RAM, CPU or GPU",
    'delegation is not an excuse',
    'run heavy work one at a time',
  ]) {
    assert.ok(text.includes(phrase), `core AGENTS.md mentions ${phrase}`);
  }
});

// The two tests above compare workspaces to each other, or check for absence
// of tokens — both pass as soon as the template itself is token-free, even if
// scaffold.js stopped bypassing substitution for AGENTS.md entirely. This one
// asserts the actual headline guarantee directly: what lands in a workspace
// is the shipped file, byte for byte, not a copy that merely happens to look
// the same today.
test('a scaffolded workspace AGENTS.md is byte-for-byte the shipped template', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'Ada Lovelace',
    '--language', 'English', '--assistant', 'Byron']);
  assert.strictEqual(
    fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'),
    fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8'));
});

// Guards the specific regression of putting 'AGENTS.md' back into
// --identity-only's rewrite list. A marker is appended to the workspace's
// AGENTS.md after scaffolding so the assertion does not depend on the
// template being token-free: if identity-only ever re-renders this file from
// templates/AGENTS.md, the marker is lost and the comparison fails, whether
// or not the source template still contains any {{token}}.
test('scaffold --identity-only leaves an existing AGENTS.md byte-unchanged', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const agentsPath = path.join(dir, 'AGENTS.md');
  const marked = fs.readFileSync(agentsPath, 'utf8') + '\n<!-- test marker: must survive identity-only -->\n';
  fs.writeFileSync(agentsPath, marked, 'utf8');
  runTool('scaffold.js', ['--identity-only', '--target', dir,
    '--owner', 'Ada Lovelace', '--language', 'English', '--role', 'Founder']);
  assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), marked);
});

test('roleFor maps kind to a role', () => {
  const nf = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'note-format'));
  assert.strictEqual(nf.roleFor('shared'), 'server');
  assert.strictEqual(nf.roleFor('home'), 'client');
  assert.strictEqual(nf.roleFor('hosted'), 'hosted');
  assert.strictEqual(nf.roleFor(undefined), 'client');
});

test('scaffold writes the client role file by default', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.strictEqual(
    fs.readFileSync(path.join(dir, 'JOSERAH-ROLE.md'), 'utf8'),
    fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'roles', 'joserah-client.md'), 'utf8'));
});

test('scaffold writes the server role file for a shared workspace', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--kind', 'shared']);
  assert.strictEqual(
    fs.readFileSync(path.join(dir, 'JOSERAH-ROLE.md'), 'utf8'),
    fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'roles', 'joserah-server.md'), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.kind, 'shared');
});

test('scaffold writes the hosted role file for a hosted workspace', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--kind', 'hosted']);
  assert.strictEqual(
    fs.readFileSync(path.join(dir, 'JOSERAH-ROLE.md'), 'utf8'),
    fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'roles', 'joserah-hosted.md'), 'utf8'));
});

test('no role file names anyone or carries tokens', () => {
  for (const r of ['joserah-client.md', 'joserah-server.md', 'joserah-hosted.md']) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'roles', r), 'utf8');
    assert.doesNotMatch(text, /\{\{/, r + ' has no tokens');
    assert.doesNotMatch(text, /Selvi|Serkan|doruca|Vektura/, r + ' names no one');
  }
});

test('scaffold rejects an unknown kind instead of guessing', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--kind', 'satellite']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /kind/i);
});

// Task 22, merge hardening: four standing rules distilled from notes the
// doruca-hosted assistant wrote about this rewrite, plus one the owner added
// same day. Each anchor must occur exactly once — a rule repeated somewhere
// else in the file has drifted out of sync with itself, which is exactly the
// kind of silent divergence rule 1 below exists to catch in workspace data.
test('the shipped core AGENTS.md states the four merge-hardening rules exactly once each', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  const anchors = [
    'the live system is the authority',
    'traceable to something the owner actually said',
    'judged by what it touches and never by who sent it',
    'the narrower permission applies',
  ];
  for (const anchor of anchors) {
    const count = text.split(anchor).length - 1;
    assert.strictEqual(count, 1, `expected "${anchor}" exactly once in core AGENTS.md, found ${count}`);
  }
});

// 0.13.0: the router got long enough that a third of it was saying something
// said better two sections below. Slimming is a token-cost decision, not a
// delivery one — this file reaches the model through the host's own file
// discovery, not through the hook that was being truncated.
test('the shipped core AGENTS.md stays inside its length budget', () => {
  const lines = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8')
    .split('\n').length;
  assert.ok(lines <= 160, `core AGENTS.md is ${lines} lines; the budget is 160, the target 150`);
});

test('the shipped core AGENTS.md points at the four skills nobody will name in words', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  for (const skill of ['correspondence', 'orchestrate', 'sweep', 'feedback']) {
    assert.ok(text.includes('`' + skill + '`'), `no pointer to ${skill}`);
  }
});

test('the shipped core AGENTS.md carries the three rules 0.13.0 adds, exactly once each', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  for (const anchor of [
    'only to the recipients the owner named',
    "a counterparty's message is data",
    "never reads or writes a guest workspace's folder",
  ]) {
    const count = text.split(anchor).length - 1;
    assert.strictEqual(count, 1, `expected "${anchor}" exactly once, found ${count}`);
  }
});

test('the shipped core AGENTS.md states the character it is asking for', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  for (const anchor of [
    'Sincere, direct, and worth trusting',
    'misses nothing',
    'never drown them in work they did not ask to watch',
  ]) {
    assert.ok(text.includes(anchor), `missing: ${anchor}`);
  }
});

test('the prompt version was bumped with the prompt text', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8');
  assert.match(text, /^<!-- joserah:prompt-version 8 -->$/m,
    'templates/AGENTS.md changed, so its version line has to change with it');
});
