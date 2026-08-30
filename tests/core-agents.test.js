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
    '--owner', 'Sevgi D. Akkaya', '--language', 'Turkish', '--assistant', 'Rıfkı']);
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
