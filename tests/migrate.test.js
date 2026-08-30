'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');
const { scanWorkspace } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'workspace-scan'));

function ws(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  return dir;
}
function write(dir, rel, text) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

test('scan includes knowledge notes and excludes raw/, directives and keys', (t) => {
  const dir = ws(t);
  write(dir, '.joserah/knowledge/people/ada-lovelace.md', '# Ada\n');
  write(dir, '.joserah/knowledge/raw/source.md', '# immutable\n');
  write(dir, '.joserah/directives.md', '# rules\n');
  const { files } = scanWorkspace(dir);
  assert.ok(files.includes('.joserah/knowledge/people/ada-lovelace.md'));
  assert.ok(!files.some((f) => f.startsWith('.joserah/knowledge/raw/')), 'raw/ excluded');
  assert.ok(!files.includes('.joserah/directives.md'), 'directives excluded');
  assert.ok(!files.some((f) => f.startsWith('keys/')), 'keys/ excluded');
});

test('scan stops at a nested workspace and reports it as a boundary', (t) => {
  const dir = ws(t);
  const guest = path.join(dir, 'guestws');
  runTool('scaffold.js', ['--target', guest, '--workspace', 'guest']);
  write(dir, 'guestws/.joserah/knowledge/people/sevgi.md', '# Sevgi\n');
  const { files, boundaries } = scanWorkspace(dir);
  assert.ok(!files.some((f) => f.startsWith('guestws/')), 'nothing inside the nested workspace');
  assert.deepStrictEqual(boundaries, ['guestws']);
});
