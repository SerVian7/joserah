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
// a `git log --all` probe has to sit beside it. Both pathspecs now live in
// tools/backup-scope.js and tests/backup-scope.test.js holds them to that
// behaviour; what is pinned here is that the skill still *runs* the tool at
// the gate, so no edit to this section can quietly drop the check by
// restating a narrower list in prose.
function backupSkillText() {
  return fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'backup', 'SKILL.md'), 'utf8');
}

test('gate 2.6 runs the scope check instead of restating the pathspec', () => {
  const text = backupSkillText();
  assert.match(text, /backup-scope\.js" <workspace> --check history/,
    'gate 2.6 must run the tool that owns the pathspec');
  assert.doesNotMatch(text, /ls-files -- "projects\//,
    'the pathspec lives in tools/backup-scope.js now, not in prose that can drift from it');
});

test('gate 2.3 runs the gitignore check instead of listing the lines', () => {
  const text = backupSkillText();
  assert.match(text, /backup-scope\.js" <workspace> --check gitignore/);
});

test('gate 2.6 prose says a hit routes to the scope reset, and that deleting files does not fix history', () => {
  const text = backupSkillText();
  const start = text.indexOf('2.6.');
  const section = text.slice(start, text.indexOf('\n3.', start));
  assert.match(section, /scope reset/i);
  assert.match(section, /not (be )?fixed by deleting/i);
});
