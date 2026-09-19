'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

function ws(t, notes) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  for (const [rel, text] of Object.entries(notes)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return dir;
}
// Totals below are workspace-wide: every scaffold ships the two example claim
// lines in .joserah/conventions.md (both valid), so a count includes them.
const GOOD = [
  '# Box', '',
  '- [measurement] Box VRAM @65536 -> 20009 MiB',
  '  condition: RTX 4090 · LM Studio · Q4_K_M',
  '  date: 2026-08-28 · by: owner · source: ../../../../imports/2026-09-10-x/',
  '- [calculation] ~~Box VRAM @65536 -> 25000 MiB~~',
  '  date: 2026-08-25 · by: assistant · superseded: the measurement above',
  '',
].join('\n');

test('a fresh scaffold has no claim errors', (t) => {
  const r = runTool('check-claims.js', [ws(t, {})]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('a well-formed page with a superseded calculation passes', (t) => {
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': GOOD })]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /0 error\(s\), 0 warning\(s\) in 4 claim\(s\)/);
});

test('a measurement without a condition is an error with file and line', (t) => {
  const note = '# Box\n\n- [measurement] Box VRAM -> 20009 MiB\n  date: 2026-08-28 · by: owner\n';
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': note })]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /^error {2}\.joserah\/knowledge\/wiki\/entities\/box\.md:3 {2}measurement-without-condition/m);
});

test('a live calculation beside a live measurement on the same subject is an error', (t) => {
  const note = [
    '# Box', '',
    '- [measurement] Box VRAM @65536 -> 20009 MiB',
    '  condition: RTX 4090 · by: owner',
    '- [calculation] Box VRAM @65536 -> 25000 MiB',
    '  by: assistant',
    '',
  ].join('\n');
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': note })]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /box\.md:5 {2}calculation-open/);
});

test('struck without superseded, conflict, and missing by are reported at their levels', (t) => {
  const note = [
    '# Box', '',
    '- [decision] ~~Box stays on shelf A~~',
    '  by: owner',
    '- [measurement] Box weight -> 4 kg',
    '  condition: kitchen scale · by: owner',
    '- [measurement] Box weight -> 5 kg',
    '  condition: kitchen scale · by: owner',
    '- [estimate] Box delivery -> Friday',
    '',
  ].join('\n');
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': note })]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /box\.md:3 {2}struck-without-superseded/);
  assert.match(r.stdout, /box\.md:7 {2}conflict/);
  assert.match(r.stdout, /^warn {3}\.joserah\/knowledge\/wiki\/entities\/box\.md:9 {2}missing-by/m);
  // Two errors, not three: the struck decision (line 3), and the conflict
  // reported once — on the later of the pair (line 7). The earlier line of a
  // conflicting pair carries no finding of its own; the later one names it
  // ("contradicts line 5").
  assert.match(r.stdout, /2 error\(s\), 1 warning\(s\) in 6 claim\(s\)/);
});

test('--json prints the findings as an array', (t) => {
  const note = '# Box\n\n- [measurement] Box VRAM -> 1 MiB\n  by: owner\n';
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': note }), '--json']);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.findings.length, 1);
  assert.strictEqual(out.findings[0].kind, 'measurement-without-condition');
  assert.strictEqual(out.claims, 3);
});

test('imports/ and projects/ are never scanned', (t) => {
  const r = runTool('check-claims.js', [ws(t, {
    'imports/2026-09-09-x/note.md': '- [measurement] x -> 1\n',
    'projects/O/P/docs/a.md': '- [measurement] y -> 2\n',
  })]);
  assert.strictEqual(r.status, 0, r.stdout);
});

// ---- the audit no longer lies about what it could not read (0.8.0) ---------
// Three shapes that used to report "0 errors" while the claims they carried
// were never audited at all. Each is an error, not a warning: in all three the
// tool's answer is wrong about itself, and doctor must not pass a workspace
// whose claim audit is blind.

test('a near-miss claim type is an error naming the four valid types', (t) => {
  const note = [
    '# Box', '',
    '- [claim] Box throughput -> 40 per second',
    '  date: 2026-09-12 · by: assistant',
    '',
  ].join('\n');
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': note })]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /^error {2}\.joserah\/knowledge\/wiki\/entities\/box\.md:3 {2}unknown-claim-type/m);
  assert.match(r.stdout, /measurement, calculation, decision, estimate/);
});

test('a field line written with the wrong separator is an error', (t) => {
  const note = [
    '# Box', '',
    '- [measurement] Box weight -> 4 kg',
    '  condition: kitchen scale',
    '  date: 2026-09-12 - by: owner',
    '',
  ].join('\n');
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': note })]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /^error {2}\.joserah\/knowledge\/wiki\/entities\/box\.md:5 {2}swallowed-field/m);
});

test('a wrapped claim sentence that severs its fields is an error', (t) => {
  const note = [
    '# Box', '',
    '- [decision] Box stays on shelf A because shelf B is reserved',
    '  for the other line',
    '  date: 2026-09-12 · by: owner',
    '',
  ].join('\n');
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': note })]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /^error {2}\.joserah\/knowledge\/wiki\/entities\/box\.md:4 {2}severed-claim/m);
});

test('the three blind spots are found together, and --json carries their kinds', (t) => {
  const note = [
    '# Box', '',
    '- [claim] Box throughput -> 40 per second',
    '  date: 2026-09-12 · by: assistant',
    '- [measurement] Box weight -> 4 kg',
    '  condition: kitchen scale',
    '  date: 2026-09-12 - by: owner',
    '- [decision] Box stays on shelf A because shelf B is reserved',
    '  for the other line',
    '  date: 2026-09-12 · by: owner',
    '',
  ].join('\n');
  const dir = ws(t, { '.joserah/knowledge/wiki/entities/box.md': note });
  const r = runTool('check-claims.js', [dir, '--json']);
  assert.strictEqual(r.status, 1);
  const out = JSON.parse(r.stdout);
  const kinds = out.findings.filter((f) => f.file.endsWith('box.md')).map((f) => f.kind);
  assert.ok(kinds.includes('unknown-claim-type'), JSON.stringify(kinds));
  assert.ok(kinds.includes('swallowed-field'), JSON.stringify(kinds));
  assert.ok(kinds.includes('severed-claim'), JSON.stringify(kinds));
  for (const f of out.findings.filter((f) => f.file.endsWith('box.md'))) {
    if (['unknown-claim-type', 'swallowed-field', 'severed-claim'].includes(f.kind)) {
      assert.strictEqual(f.level, 'error');
    }
  }
});

test('the five original finding kinds are unchanged by the new ones', (t) => {
  const r = runTool('check-claims.js', [ws(t, { '.joserah/knowledge/wiki/entities/box.md': GOOD })]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /0 error\(s\), 0 warning\(s\) in 4 claim\(s\)/);
});
