'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

function hookWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}
function runHook(name, cwd, stdin) {
  return spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', name)],
    { cwd, input: stdin, encoding: 'utf8' });
}

test('M1: session-start on a fresh workspace reports no changed files', (t) => {
  const r = runHook('session-start.js', hookWs(t));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[backup\]/, 'own journal stub must not count as a change');
});

test('M11: trigger inside a longer word does not capture', (t) => {
  const ws = hookWs(t);
  const r = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: 'dosyayı kaydettim az önce' }));
  assert.doesNotMatch(r.stdout, /\[capture\]/);
  const r2 = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: 'bunu kaydet lütfen' }));
  assert.match(r2.stdout, /\[capture\]/);
});

test('M10: a git SHA survives redaction; an sk- key does not', () => {
  const { redact } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'redactions'));
  const sha = 'a'.repeat(39) + 'b';
  assert.strictEqual(redact(`commit ${sha}`).text, `commit ${sha}`);
  assert.match(redact('key sk-' + 'x'.repeat(20)).text, /\[redacted\]/);
});

test('M15: BOM in config.json does not blank the config', (t) => {
  const ws = hookWs(t);
  const cfgPath = path.join(ws, '.joserah', 'config.json');
  fs.writeFileSync(cfgPath, '﻿' + fs.readFileSync(cfgPath, 'utf8'));
  const { readConfig } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'workspace'));
  assert.strictEqual(readConfig(ws).workspaceName, 'w');
});
