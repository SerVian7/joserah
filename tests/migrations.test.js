'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool } = require('./helpers');

const MIGRATIONS = path.join(PLUGIN_ROOT, 'docs', 'migrations');

function freshWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}

function editConfig(dir, mutate) {
  const p = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  mutate(cfg);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}

// The notes are matched by filename, so a note named anything else is not a
// note that doctor skips — it is a note nobody will ever be told about.
test('every structure note is named for a version, and none is past the next release', () => {
  const version = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const files = fs.readdirSync(MIGRATIONS);
  assert.ok(files.length, 'docs/migrations is empty — the check reads it and would stay silent forever');
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  };
  // A note may be staged for the next release before its version bump (doctor
  // asks for it only once that version is installed), but no further ahead
  // than the next minor: a mistyped version would sit unread for years.
  const [maj, min] = version.split('.').map(Number);
  for (const f of files) {
    assert.match(f, /^\d+\.\d+\.\d+\.md$/, `${f} is not named <version>.md and will never be read`);
    assert.ok(cmp(f.slice(0, -3), `${maj}.${min + 1}.0`) <= 0,
      `${f} is past the next release after the plugin's own version ${version}`);
    assert.ok(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').trim().length > 200, `${f} says nothing`);
  }
});

test('doctor names the structure notes a workspace has not caught up to, and stops once it has', (t) => {
  const dir = freshWs(t);

  // A fresh scaffold is built by this very version: nothing to catch up on.
  const clean = runTool('doctor.js', [dir]);
  assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
  assert.doesNotMatch(clean.stdout, /structure migrations applied/);

  editConfig(dir, (c) => { c.createdByPluginVersion = '0.3.0'; delete c.migratedTo; });
  const behind = runTool('doctor.js', [dir]);
  assert.match(behind.stdout, /warn\s+structure migrations applied.*newer than 0\.3\.0/);
  assert.strictEqual(behind.status, 0, 'being behind on structure is a warning, not a failure');

  // migratedTo is what the update stamps, and it must win over the version
  // that merely created the workspace — otherwise the warning is permanent.
  const current = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  editConfig(dir, (c) => { c.migratedTo = current; });
  const done = runTool('doctor.js', [dir]);
  assert.doesNotMatch(done.stdout, /structure migrations applied/);
});

test('doctor asks for a sweep only once there are notes old enough to have gone stale', (t) => {
  const dir = freshWs(t);

  const fresh = runTool('doctor.js', [dir]);
  assert.doesNotMatch(fresh.stdout, /knowledge sweep/, 'a workspace made today has nothing to sweep');

  // Never swept, and created long enough ago that the prose has had time to
  // accumulate numbers nobody turned into claims.
  editConfig(dir, (c) => { c.created = '2026-01-01'; });
  const never = runTool('doctor.js', [dir]);
  assert.match(never.stdout, /warn\s+knowledge sweep.*never swept/);
  assert.strictEqual(never.status, 0);

  // A sweep that ran today silences it regardless of how old the workspace is.
  editConfig(dir, (c) => { c.lastSweep = new Date().toISOString(); });
  const swept = runTool('doctor.js', [dir]);
  assert.doesNotMatch(swept.stdout, /knowledge sweep/);

  // ...and a sweep that ran long ago does not.
  editConfig(dir, (c) => { c.lastSweep = '2026-02-01T00:00:00.000Z'; });
  const stale = runTool('doctor.js', [dir]);
  assert.match(stale.stdout, /warn\s+knowledge sweep.*days since the last one/);
});

// 0.15.1 (owner, 2026-09-30): a week, or five journal days, whichever comes first.
test('doctor asks for a sweep after a week, or after five journal days', (t) => {
  const dir = freshWs(t);
  const day = (i) => { const d = new Date(Date.now() - i * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const note = (i) => { const p = path.join(dir, '.joserah', 'desk', 'daily', day(i).slice(0, 4), `${day(i)}.md`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '# x\n\n## Notes\n- real\n'); };
  editConfig(dir, (c) => { c.lastSweep = new Date(Date.now() - 8 * 864e5).toISOString(); });
  assert.match(runTool('doctor.js', [dir]).stdout, /warn\s+knowledge sweep.*8 days since the last one/);
  editConfig(dir, (c) => { c.lastSweep = new Date(Date.now() - 6 * 864e5).toISOString(); });
  [1, 2, 3, 4].forEach(note);
  assert.doesNotMatch(runTool('doctor.js', [dir]).stdout, /knowledge sweep/);
  note(5);
  assert.match(runTool('doctor.js', [dir]).stdout, /warn\s+knowledge sweep.*5 journal days/);
});

// 0.18.0 (crew plan, Task 6.4): the crew turns on with the update that ships it.
test('the 0.18.0 note names crew.js, the optional crew block, devMode off by default and the restart case', () => {
  const p = path.join(MIGRATIONS, '0.18.0.md');
  assert.ok(fs.existsSync(p), 'docs/migrations/0.18.0.md exists');
  const text = fs.readFileSync(p, 'utf8');
  assert.ok(text.includes('crew.js'), 'the generator run');
  assert.match(text, /`crew` block/, 'the crew block in config');
  assert.match(text, /optional/i, 'the block is optional');
  assert.ok(text.includes('devMode'), 'developer mode');
  assert.match(text, /off by default|absent means off/i, 'devMode off by default');
  assert.match(text, /\.claude\/agents\//);
  assert.match(text, /restart/i, 'a first-ever .claude/agents/ needs a restart');
});
