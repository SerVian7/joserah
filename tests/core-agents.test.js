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
