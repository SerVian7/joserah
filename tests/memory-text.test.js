'use strict';
// 0.15.3 (plan 2026-09-30, Task 2): the memory's own rules, pinned as text.
// Whitespace is flattened so a re-wrap does not break a pin; a rewording does.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');

const read = (f) => fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'memory', f), 'utf8').replace(/\s+/g, ' ');

test('memory AGENTS.md: the pull checks, early push, the decision criterion, the sweep rules', () => {
  const text = read('AGENTS.md');
  for (const sentence of [
    'It also checks links and claim lines and prints one line — say it to the member in one line, with the sweep-due line if any.',
    'Push as soon as you wrote something worth sharing — an inbox note, a question, a decision — and at the end of the session; do not wait for the end of the day.',
    "What makes it a company decision: a dated purchase or operating decision inside that member's own responsibility, with who decided and when — that goes into `knowledge/` as `[decision]`.",
    'a claim line travels as it is, never rewritten, summarised or dropped; `node tools/claims.js --count <inbox files>` before and `node tools/claims.js` after must agree.',
    'Sweep is due when `inbox/` holds 5 or more files or 7 days have passed since the last sweep, whichever comes first.',
  ]) assert.ok(text.includes(sentence), `missing: ${sentence}`);
  assert.strictEqual(text.split('Joserah is not required').length - 1, 1, 'said once');
});

test('memory README: works without Joserah, with git and Node', () => {
  assert.ok(read('README.md').includes('Joserah is not required: anyone with git and Node can work here — the rules are in `AGENTS.md`, the tools in `tools/`.'));
});

test('memory AGENTS.md: verified procedures live as scripts that hold no secret', () => {
  const text = read('AGENTS.md');
  assert.ok(text.includes("Record first, script later. What was verified against a system"));
  assert.ok(text.includes("A script enters `tools/<system>/` only when a sweep decides it (§5), built from a recorded, verified procedure; it holds no secret"));
  assert.ok(text.includes("Node by default, PowerShell only where the host is Windows-only."));
  assert.ok(text.includes("From the R&D records merged in this sweep, list tool proposals"));
  assert.ok(text.includes("`desk/tools-proposed.md`"));
  assert.ok(text.includes("Every member uses the same secret names; `tools/<system>/README.md` lists them."));
  assert.ok(read('README.md').includes('they never contain a secret, they ask for it or take it from your vault.'));
});
