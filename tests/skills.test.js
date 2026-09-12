'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');

// 0.10.0: the S-column rules from the 2026-09-12 behaviour list get their
// homes. Same rule as the prompt (prompt.test.js): Joserah names no
// third-party plugin, skill, vendor or product — the skills are read into a
// session the same way the prompt is.
const FORBIDDEN = [/superpowers/i, /obsidian/i, /notion/i, /chatgpt/i, /copilot/i];
const SKILLS = ['research', 'dispatch', 'plan', 'sweep'];

for (const name of SKILLS) {
  test(`skills/${name}/SKILL.md has frontmatter and names nobody else`, () => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, 'no frontmatter block');
    assert.match(fm[1], new RegExp(`^name: ${name}$`, 'm'));
    assert.match(fm[1], /^description: \S.*$/m);
    for (const bad of FORBIDDEN) assert.doesNotMatch(text, bad, `names ${bad}`);
  });
}
