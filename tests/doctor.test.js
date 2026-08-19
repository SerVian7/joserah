'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

function freshWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}

test('doctor passes a fresh scaffold', (t) => {
  const r = runTool('doctor.js', [freshWs(t)]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  // A passing check must not read like an active problem report: the legacy-
  // keys line on a healthy workspace carries no detail text at all.
  assert.match(r.stdout, /^ok\s+no legacy \.joserah\/keys directory\s*$/m);
});

test('placeholder scan ignores {{...}} inside fenced/inline code but still catches a bare one', (t) => {
  const dir = freshWs(t);
  const p = path.join(dir, '.joserah', 'desk', 'discusses-templating.md');
  fs.writeFileSync(p, [
    'This doc legitimately discusses the templating mechanism:',
    '```js',
    "'{{OWNER_NAME}}': owner,",
    '```',
    'and inline `{{OWNER_ROLE_LINE}}` in prose.',
    '',
  ].join('\n'));
  const safe = runTool('doctor.js', [dir]);
  assert.strictEqual(safe.status, 0, safe.stdout + safe.stderr);

  fs.appendFileSync(p, '\nA bare {{UNFILLED}} outside any code block.\n');
  const bare = runTool('doctor.js', [dir]);
  assert.strictEqual(bare.status, 1);
  assert.match(bare.stdout, /no unfilled \{\{placeholders\}\}.*1 file/i);
});

test('I14: doctor fails when a legacy .joserah/keys directory exists', (t) => {
  const dir = freshWs(t);
  fs.mkdirSync(path.join(dir, '.joserah', 'keys'), { recursive: true });
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /legacy/i);
});

test('G1: doctor fails when the local verify-links copy has drifted', (t) => {
  const dir = freshWs(t);
  fs.appendFileSync(path.join(dir, '.joserah', 'tools', 'verify-links.js'), '\n// drifted\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /verify-links\.js/);
});

test('I3: doctor fails when the deny set is a subset', (t) => {
  const dir = freshWs(t);
  const sPath = path.join(dir, '.claude', 'settings.json');
  const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
  s.permissions.deny = s.permissions.deny.slice(0, 3);
  fs.writeFileSync(sPath, JSON.stringify(s, null, 2));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /missing \d+ deny rule/);
});

test('I-K3: a 0.3.0-created workspace with .claude/ removed fails doctor', (t) => {
  const dir = freshWs(t);
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL\s+\.claude\/settings\.json \(absent\).*0\.3\.0/);
});

test('I-K3: a workspace recorded as created by an older plugin version still passes with .claude/ removed', (t) => {
  const dir = freshWs(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.createdByPluginVersion = '0.2.0';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok\s+\.claude\/settings\.json \(absent\)/);
});

test('M3: a missing local checker is named, not reported as broken links', (t) => {
  const dir = freshWs(t);
  fs.rmSync(path.join(dir, '.joserah', 'tools', 'verify-links.js'));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /local verify-links\.js current.*missing/i);
  assert.match(r.stdout, /ok\s+internal links resolve/);
});
