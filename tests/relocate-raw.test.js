'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

function legacyWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  // recreate the pre-relocation layout scaffold no longer produces:
  const old = path.join(dir, '.joserah', 'knowledge', 'raw', 'imports');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'source.md'), '# immutable source\n');
  // a wiki note that cites it with a relative link:
  const wiki = path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities');
  fs.mkdirSync(wiki, { recursive: true });
  fs.writeFileSync(path.join(wiki, 'thing.md'),
    '# Thing\n\nSource: [source](../../raw/imports/source.md)\n');
  return dir;
}

// There is no portable, permission-based way to make fs.renameSync fail on
// a specific entry (confirmed by experiment: a read-only file still renames
// cleanly on this platform, and a read-only directory does not block
// renaming entries out of it either), and pre-staging a real collision
// under the root raw/ would trip the tool's own guard before the
// moving-raw stage is ever reached. So the fault is injected directly via a
// `-r` preload that makes renaming one specific, named entry throw — this
// exercises the moving-raw catch branch itself, deterministically, without
// depending on OS-specific locking behaviour.
function writeRenameFault(scratchDir, targetName) {
  const fault = path.join(scratchDir, 'inject-rename-fault.js');
  fs.writeFileSync(fault, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const original = fs.renameSync;',
    'fs.renameSync = function patched(from, to) {',
    `  if (path.basename(String(from)) === ${JSON.stringify(targetName)}) {`,
    "    throw new Error('SIMULATED-FAILURE: injected for test');",
    '  }',
    '  return original.call(fs, from, to);',
    '};',
  ].join('\n'));
  return fault;
}

function runFaulted(dir, fault) {
  return spawnSync(process.execPath,
    ['-r', fault, path.join(PLUGIN_ROOT, 'tools', 'relocate-raw.js'), dir],
    { encoding: 'utf8' });
}

test('relocates knowledge/raw to the root and rewrites citing links', (t) => {
  const dir = legacyWs(t);
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'raw', 'imports', 'source.md')), 'moved to root');
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'old dir gone');
  const note = fs.readFileSync(path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities', 'thing.md'), 'utf8');
  assert.match(note, /\(\.\.\/\.\.\/\.\.\/\.\.\/raw\/imports\/source\.md\)/, 'link climbs to the root');
  const links = runTool('verify-links.js', [dir]);
  assert.strictEqual(links.status, 0, 'no broken links after relocation: ' + links.stdout);
});

test('preserves an owner-edited README.md under the old raw/ instead of discarding it', (t) => {
  const dir = legacyWs(t);
  // The old location may carry its own README.md from the pre-migration
  // template. A workspace scaffolded between 2026-08-31 and 2026-09-12 also
  // carries the *current* template's README.md at raw/ — scaffold.js writes
  // imports/README.md now, so the test stages that pre-existing file itself.
  // Then simulate an owner who annotated the old one, so its bytes differ
  // from what is at the root.
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'imports', 'README.md'), path.join(dir, 'raw', 'README.md'));
  const oldReadme = path.join(dir, '.joserah', 'knowledge', 'raw', 'README.md');
  fs.writeFileSync(oldReadme, '# raw/ — IMMUTABLE\n\nOwner note: do not touch, ever.\n');
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.strictEqual(summary.preservedReadme, 'raw/README.old.md');
  const preserved = fs.readFileSync(path.join(dir, 'raw', 'README.old.md'), 'utf8');
  assert.match(preserved, /Owner note: do not touch, ever\./, 'owner content survives, not deleted');
  // The root's own (current-template) README.md is untouched by the merge.
  assert.ok(fs.existsSync(path.join(dir, 'raw', 'README.md')), 'root README.md still present');
});

test('a genuinely pre-branch workspace (no root raw/ yet) gets the current README template, not the legacy three-line one', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  // Simulate a workspace scaffolded before this branch existed: no root
  // raw/ was ever created (scaffold.js pre-dating this branch never wrote
  // one), and the source material — with its own legacy three-line
  // README.md — still sits under .joserah/knowledge/raw/.
  fs.rmSync(path.join(dir, 'raw'), { recursive: true, force: true });
  const old = path.join(dir, '.joserah', 'knowledge', 'raw');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'README.md'),
    '# raw/\n\nImmutable source material. Never edited, never summarized in place.\n');
  fs.writeFileSync(path.join(old, 'statement.pdf'), 'x');
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const got = fs.readFileSync(path.join(dir, 'raw', 'README.md'), 'utf8');
  const current = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'imports', 'README.md'), 'utf8');
  assert.strictEqual(got, current, 'gets the current template explaining the backup exclusion, not the legacy one');
  assert.doesNotMatch(got, /Never edited, never summarized in place\./,
    'the legacy three-line boilerplate does not survive the move');
});

test('is a no-op when there is nothing to relocate, exit 0', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /"moved":\s*false/);
});

test('refuses when the root already has a non-empty raw/ of its own', (t) => {
  const dir = legacyWs(t);
  // Add real owner content under the root raw/ to create a genuine
  // collision (scaffold.js writes imports/, not raw/, since 2026-09-12).
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw', 'existing.md'), 'x\n');
  const r = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.ok(fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'nothing was moved');
});

test('--dry-run reports and changes nothing', (t) => {
  const dir = legacyWs(t);
  const r = runTool('relocate-raw.js', [dir, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'still in place');
});

test('the .gitignore exclusion is written even when a later stage fails', (t) => {
  const dir = legacyWs(t);
  // A genuinely pre-migration workspace has no raw/ exclusion of its own
  // (scaffold.js writes imports/ since 2026-09-12) — assert that, so the
  // write this test is checking for is not a no-op.
  const giPath = path.join(dir, '.gitignore');
  const stripped = fs.readFileSync(giPath, 'utf8').replace(/^raw\/\n/m, '');
  fs.writeFileSync(giPath, stripped);
  assert.doesNotMatch(stripped, /^raw\/$/m, 'precondition: no raw/ exclusion yet');

  // Force the later writing-notes stage to fail, deterministically and
  // without needing any pre-existing content under the root raw/ (which
  // the tool's own collision guard would refuse before touching anything):
  // make the citing note itself unwritable.
  const notePath = path.join(dir, '.joserah', 'knowledge', 'wiki', 'entities', 'thing.md');
  fs.chmodSync(notePath, 0o444);
  const r = runTool('relocate-raw.js', [dir]);
  fs.chmodSync(notePath, 0o666);

  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stderr, /writing-notes/);
  assert.match(fs.readFileSync(giPath, 'utf8'), /^raw\/$/m,
    'gitignore exclusion written despite the later failure');
  assert.ok(fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'raw/ untouched by the failed run');
});

test('a moving-raw failure on the very first entry says retrying is safe, and a real re-run succeeds', (t) => {
  const dir = legacyWs(t);
  // 'explode.md' sorts before 'imports', so it is the entry the moving-raw
  // loop reaches first: the injected failure hits before anything has
  // actually moved into the destination.
  fs.writeFileSync(path.join(dir, '.joserah', 'knowledge', 'raw', 'explode.md'), 'x\n');
  const fault = writeRenameFault(tmpdir(t), 'explode.md');

  const faulted = runFaulted(dir, fault);
  assert.strictEqual(faulted.status, 1, faulted.stdout + faulted.stderr);
  assert.match(faulted.stderr, /moving raw\/ itself failed partway/);
  assert.match(faulted.stderr, /already moved:\s*\(none\)/);
  assert.match(faulted.stderr, /safe to retry/i, 'says retrying is safe when nothing has moved');
  assert.doesNotMatch(faulted.stderr, /refused by design/,
    'must not claim a re-run will be refused when nothing has actually moved');

  // The claim only means something if a real re-run is checked against it,
  // not just read off the message: run the real tool (no fault) and confirm
  // it actually succeeds, exactly as promised.
  const real = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(real.status, 0, real.stderr);
  assert.strictEqual(JSON.parse(real.stdout).moved, true, 'the promised re-run genuinely succeeds');
});

test('a moving-raw failure after an entry has moved says a re-run will be refused, and it is', (t) => {
  const dir = legacyWs(t);
  // 'zzz-explode.md' sorts after 'imports', so 'imports' has already landed
  // in the destination by the time the loop reaches the entry made to fail.
  fs.writeFileSync(path.join(dir, '.joserah', 'knowledge', 'raw', 'zzz-explode.md'), 'x\n');
  const fault = writeRenameFault(tmpdir(t), 'zzz-explode.md');

  const faulted = runFaulted(dir, fault);
  assert.strictEqual(faulted.status, 1, faulted.stdout + faulted.stderr);
  const oldRaw = path.join(dir, '.joserah', 'knowledge', 'raw');
  const newRaw = path.join(dir, 'raw');
  assert.match(faulted.stderr, /moving raw\/ itself failed partway/);
  assert.ok(faulted.stderr.includes(oldRaw), 'names the old directory by absolute path');
  assert.ok(faulted.stderr.includes(newRaw), 'names the new directory by absolute path');
  assert.match(faulted.stderr, /already moved:\s*imports/);
  assert.match(faulted.stderr, /by hand/i, 'tells the operator to finish manually');
  assert.match(faulted.stderr, /refused by design/i, 'states plainly that a re-run will not help');
  assert.doesNotMatch(faulted.stderr, /safe to retry/i, 'must not also claim retrying is safe');

  // Check the claim against what a real re-run actually does, not just the
  // message's wording: it must genuinely be refused by the collision guard.
  const real = runTool('relocate-raw.js', [dir]);
  assert.strictEqual(real.status, 1, 'the promised refusal genuinely happens');
  assert.match(real.stderr, /already exists at the root and is not empty/);
});
