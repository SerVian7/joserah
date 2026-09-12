'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');

// CRITICAL 1 (whole-branch review, 2026-08-31): gate 2.6's ls-files pathspec
// never covered .joserah/knowledge/raw/, so a workspace whose pre-branch
// .gitignore never excluded it kept tracking source material there, commit
// after commit, undetected. relocate-raw.js moving the files makes the next
// `add -A` stage only the deletion, so ls-files alone goes quiet forever
// while every past commit still serves the material — which is exactly why
// a `git log --all` probe has to sit beside it. Pin both pathspecs here so a
// future edit to this section cannot quietly drop either check.
function backupSkillText() {
  return fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'backup', 'SKILL.md'), 'utf8');
}

test('gate 2.6 ls-files pathspec covers the current imports/ and both legacy raw locations', () => {
  const text = backupSkillText();
  const m = text.match(/git -C <workspace> ls-files -- "projects\/" "docker-stack\/" "imports\/" "raw\/"[^\n`]*/);
  assert.ok(m, 'gate 2.6 ls-files line not found in the expected shape');
  assert.match(m[0], /"\.joserah\/knowledge\/raw\/"/,
    'ls-files pathspec must also cover the pre-migration .joserah/knowledge/raw/ location');
});

test('gate 2.6 carries a git log --all history probe for raw/ material, not just ls-files', () => {
  const text = backupSkillText();
  const m = text.match(/git -C <workspace> log --all --oneline -- [^\n`]*/);
  assert.ok(m, 'gate 2.6 history probe not found — ls-files alone cannot see source material relocate-raw.js already moved');
  assert.match(m[0], /"\.joserah\/knowledge\/raw\/"/);
  assert.match(m[0], /"raw\/"/);
  assert.match(m[0], /"imports\/"/);
});

test('gate 2.6 prose says a hit routes to the scope reset, and that deleting files does not fix history', () => {
  const text = backupSkillText();
  const start = text.indexOf('2.6.');
  const section = text.slice(start, text.indexOf('\n3.', start));
  assert.match(section, /scope reset/i);
  assert.match(section, /not (be )?fixed by deleting/i);
});
