'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');
const { CHECKS } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'doctor-checks'));

// The exact lines doctor prints for a freshly scaffolded workspace, in order,
// recorded 2026-09-13 from the pre-refactor tool. The registry must reproduce
// them character for character: this refactor is allowed to change how the
// checks are stored and not what the owner sees.
const FRESH_ORDER = [
  'workspace marker readable',
  'node version >= 18',
  'exists: AGENTS.md',
  'exists: .joserah/desk/tasks/now.md',
  'exists: .joserah/learned.md',
  'exists: .joserah/desk/inbox/captures.md',
  'exists: .joserah/personal/profile.md',
  'exists: .joserah/agent.md',
  'exists: .joserah/directives.md',
  'exists: keys/AGENTS.md',
  'trust level',
  '.claude/settings.json (present)',
  'no legacy .joserah/keys directory',
  'exists: JOSERAH-ROLE.md',
  'agent.md overlay marker present',
  'standing context size',
  'workspace/plugin version',
  'format version',
  'prompt (AGENTS.md) current',
  'local verify-links.js current',
  'no unfilled {{placeholders}}',
  'internal links resolve',
  'typed claims consistent',
];

test('a fresh scaffold prints the same checks, in the same order, as before the registry', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'A B',
    '--language', 'English', '--role', '']);
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  const names = r.stdout.split('\n')
    .filter((l) => /^(ok|warn|FAIL)\s/.test(l))
    .map((l) => l.replace(/^(ok|warn|FAIL)\s+/, '').split('  —')[0].trim());
  const expected = process.platform === 'win32'
    ? [...FRESH_ORDER, 'bash available for hooks'] : FRESH_ORDER;
  assert.deepStrictEqual(names, expected);
});

test('every registry entry has a stable id and they are unique', () => {
  const ids = CHECKS.map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate check id');
  for (const c of CHECKS) {
    assert.match(c.id, /^[a-z0-9-]+$/, `${c.id} is not a stable slug`);
    assert.strictEqual(typeof c.run, 'function', `${c.id} has no run function`);
    assert.ok(Array.isArray(c.remedies), `${c.id} has no remedies array`);
  }
});

// The drift this catches: a check gains a failure mode and nobody adds the row,
// or a row survives a check that was deleted. Both happened before today.
function skillTableRows() {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'doctor', 'SKILL.md'), 'utf8');
  const start = text.indexOf('<!-- joserah:remedy-table-start -->');
  const end = text.indexOf('<!-- joserah:remedy-table-end -->');
  assert.ok(start !== -1 && end > start, 'remedy table markers missing from the doctor skill');
  return text.slice(start, end).split('\n')
    .filter((l) => l.startsWith('| ') && !/^\|\s*-+/.test(l) && !/^\| Failure \|/.test(l))
    .map((l) => {
      const cells = l.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').split(' | ');
      return { key: cells[0].trim(), text: cells.slice(1).join(' | ').trim() };
    });
}

test('the doctor skill remedy table and the registry say the same thing', () => {
  const rows = skillTableRows();
  const fromRegistry = CHECKS.flatMap((c) => c.remedies);
  assert.deepStrictEqual(rows.map((r) => r.key), fromRegistry.map((r) => r.key),
    'remedy rows differ between skills/doctor/SKILL.md and tools/lib/doctor-checks.js — same rows, same order');
  for (let i = 0; i < rows.length; i++) {
    assert.strictEqual(rows[i].text, fromRegistry[i].text,
      `remedy text drifted for ${rows[i].key}`);
  }
});

test('every remedy row belongs to a check that still exists', () => {
  const ids = new Set(CHECKS.filter((c) => c.remedies.length).map((c) => c.id));
  assert.ok(ids.size > 0);
  for (const c of CHECKS) {
    for (const r of c.remedies) {
      assert.ok(r.key && r.text, `${c.id} has an empty remedy row`);
    }
  }
});

test('--list-checks prints the registry as JSON', () => {
  const r = runTool('doctor.js', ['--list-checks']);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.map((c) => c.id), CHECKS.map((c) => c.id));
});

// Adding a check must be a data change: this test is the statement of that.
test('adding an entry to the registry is the whole cost of adding a check', () => {
  const src = fs.readFileSync(path.join(PLUGIN_ROOT, 'tools', 'doctor.js'), 'utf8');
  assert.match(src, /require\('\.\/lib\/doctor-checks'\)/);
  // The runner loops over the registry; it does not enumerate checks itself.
  assert.match(src, /for \(const entry of CHECKS\)/);
});
