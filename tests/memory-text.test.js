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
    'a claim line travels as it is, never rewritten, summarised or dropped.',
    'Sweep is due when `inbox/` holds 5 or more files or 7 days have passed since the last sweep, whichever comes first.',
  ]) assert.ok(text.includes(sentence), `missing: ${sentence}`);
  assert.strictEqual(text.split('Joserah is not required').length - 1, 1, 'said once');
});

test('memory README: works without Joserah, with git and Node', () => {
  assert.ok(read('README.md').includes('Joserah is not required: anyone with git and Node can work here — the rules are in `AGENTS.md`, the tools in `tools/` (Node built-ins only, nothing to install).'));
});

test('memory AGENTS.md: verified procedures live as scripts that hold no secret', () => {
  const text = read('AGENTS.md');
  assert.ok(text.includes("Record first, script later. What was verified against a system"));
  assert.ok(text.includes("A script enters `tools/<system>/` only when a sweep decides it (§7), built from a recorded, verified procedure; it holds no secret"));
  assert.ok(text.includes("Node by default, PowerShell only where the host is Windows-only."));
  assert.ok(text.includes("From the R&D records merged in this sweep, list tool proposals"));
  assert.ok(text.includes("`desk/tools-proposed.md`"));
  assert.ok(text.includes("Every member uses the same secret names; `tools/<system>/README.md` lists them."));
  assert.ok(read('README.md').includes('they never contain a secret, they ask for it or take it from your vault.'));
});

test('memory AGENTS.md and README: own vault and sweep check', () => {
  const a = read('AGENTS.md');
  for (const s of [
    'node tools/sweep.js --before',
    'node tools/sweep.js --after',
    'A sweep with missing lines is not finished',
    '5. `keys/` is never opened by an assistant; what exists is in `.memory/vault-index.md`; a secret is saved with `node tools/secret.js --set <name>` — run by the assistant on this machine, where a Joserah Vault window takes the value from the member unseen; over SSH or remote, by the member in their own terminal — or lives in their Joserah vault.',
  ]) assert.ok(a.includes(s), `missing: ${s}`);
  assert.ok(read('README.md').includes('The memory carries its own vault (names only ever leave the machine) and its own sweep check, so no plugin is needed for either:'));
});

// 0.15.6 (owner, 2026-09-30): the memory reads well to an AI opening it cold, names the clone
// location, and its push notice is shown, then pushed.
test('memory README: what this is, the first three steps, the clone location, the push target', () => {
  const text = read('README.md');
  for (const s of [
    "{{COMPANY}}'s shared memory: what the company knows about its own work",
    '## If you are an AI assistant opening this repository',
    '1. `node tools/sync.js` — pulls, checks links and claim lines, lists questions waiting for the member.',
    '2. `node tools/detect-member.js` — prints which member you work for (from `.memory/me`).',
    "3. Read the member's folder, `members/<member>/`, and the company's open items, `desk/tasks/now.md`.",
    '**With Joserah:** the plugin clones it into the workspace, at `.joserah/shared/<name>/`.',
    '**Without Joserah:** clone it to `~/<name>`. One clone per machine; every workspace on that machine points at that clone instead of keeping its own.',
    '— `shared memory <name> (<origin url>)` — and every file about to leave the machine.',
  ]) assert.ok(text.includes(s), `missing: ${s}`);
  assert.ok(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'memory', 'README.md'), 'utf8').trimEnd().split(/\r?\n/).length <= 90, 'README ≤ 90 lines');
});

test('memory AGENTS.md: start steps, where never, the push is shown then made, the clone location', () => {
  const text = read('AGENTS.md');
  for (const s of [
    '3. Read `members/<member>/` (`tasks.md`, the latest daily file, `notes/`) and `desk/tasks/now.md`.',
    "Never: `knowledge/` (the sweeper's, §6), another member's folder, `keys/` (§8).",
    "Show the list in the member's language, one line per file, wait for their yes, then run it again with `--yes`. Never push unannounced.",
    '`pushed to shared memory <name>: <commit>`',
    'or at `~/<name>` without Joserah — one clone per machine, every workspace on that machine points at it.',
    'A command uses it only embedded, `$(node tools/secret.js <name>)`, never printed.',
  ]) assert.ok(text.includes(s), `missing: ${s}`);
  assert.ok(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'memory', 'AGENTS.md'), 'utf8').trimEnd().split(/\r?\n/).length <= 110, 'AGENTS.md ≤ 110 lines');
});

test('memory AGENTS.md: company pages start from .brand/', () => {
  assert.ok(read('AGENTS.md').includes('is built from `.brand/`: read `.brand/REPORTING.md` first, start from its template (`report.html`, `changelog.html`), embed its logo; never an improvised design.'));
});
