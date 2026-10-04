'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

const page = (dir) => fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const logo = (t) => { const f = path.join(tmpdir(t), 'l.svg'); fs.writeFileSync(f, '<svg xmlns="http://www.w3.org/2000/svg"/>'); return f; };

test('init writes json and page, logo as a separate file; refuses overwrite without --force', (t) => {
  const dir = tmpdir(t);
  const r = runTool('changelog.js', ['init', dir, '--title', 'Module X', '--lang', 'tr', '--desc', 'One sentence.', '--logo', logo(t)]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'logo.svg')));
  const h = page(dir);
  assert.match(h, /<html lang="tr"/);
  assert.match(h, /<img src="logo.svg"/);
  assert.match(h, /<h1>Module X<\/h1><p>One sentence\.<\/p>/);
  assert.strictEqual(runTool('changelog.js', ['init', dir, '--title', 'T', '--lang', 'en']).status, 1);
  assert.strictEqual(runTool('changelog.js', ['init', dir, '--title', 'T', '--lang', 'en', '--force']).status, 0);
  assert.strictEqual(runTool('changelog.js', ['init', dir, '--title', 'T']).status, 1);
});

test('add: sections newest first, all closed, no base64, no footer', (t) => {
  const dir = tmpdir(t);
  runTool('changelog.js', ['init', dir, '--title', 'M', '--lang', 'en', '--logo', logo(t)]);
  assert.strictEqual(runTool('changelog.js', ['add', dir, '--date', '2026-10-01', '--line', 'Old one', '--line', 'Old two']).status, 0);
  const r = runTool('changelog.js', ['add', dir, '--date', '2026-10-03', '--line', 'New <one>', '--line', 'New two', '--line', 'New three']);
  assert.match(r.stdout, /sections: 2/);
  const h = page(dir);
  assert.strictEqual((h.match(/<details/g) || []).length, 2);
  assert.doesNotMatch(h, /<details[^>]* open/);
  assert.ok(h.indexOf('03.10.2026') < h.indexOf('01.10.2026'));
  assert.match(h, /New &lt;one&gt;/);
  assert.doesNotMatch(h, /base64|data:/);
  assert.doesNotMatch(h, /<footer|<script/);
});

test('add: a section holds 2 to 5 lines; same date appends', (t) => {
  const dir = tmpdir(t);
  runTool('changelog.js', ['init', dir, '--title', 'M', '--lang', 'en']);
  assert.strictEqual(runTool('changelog.js', ['add', dir, '--date', '2026-10-01', '--line', 'only one']).status, 1);
  assert.strictEqual(runTool('changelog.js', ['add', dir, '--date', '2026-10-01', '--line', 'a', '--line', 'b']).status, 0);
  assert.strictEqual(runTool('changelog.js', ['add', dir, '--date', '2026-10-01', '--line', 'c']).status, 0);
  assert.match(runTool('changelog.js', ['render', dir]).stdout, /sections: 1/);
  assert.strictEqual(runTool('changelog.js', ['add', dir, '--date', '2026-10-01', '--line', 'd', '--line', 'e', '--line', 'f']).status, 1);
  assert.strictEqual(runTool('changelog.js', ['add', dir, '--date', 'bad', '--line', 'a', '--line', 'b']).status, 1);
});

test('description is a single short sentence, never a list', (t) => {
  const dir = tmpdir(t);
  assert.strictEqual(runTool('changelog.js', ['init', dir, '--title', 'Peplink Integration', '--lang', 'en', '--desc', 'Direct access and automation for Peplink products.']).status, 0);
  for (const bad of ['It shows A. It does B.', 'Shows: A, B', 'A; B', 'x'.repeat(101)]) {
    assert.strictEqual(runTool('changelog.js', ['init', dir, '--title', 'M', '--lang', 'en', '--desc', bad, '--force']).status, 1, bad);
  }
});
