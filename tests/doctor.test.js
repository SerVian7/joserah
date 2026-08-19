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

test('M3: a missing local checker is named, not reported as broken links', (t) => {
  const dir = freshWs(t);
  fs.rmSync(path.join(dir, '.joserah', 'tools', 'verify-links.js'));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /local verify-links\.js current.*missing/i);
  assert.match(r.stdout, /ok\s+internal links resolve/);
});
