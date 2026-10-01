'use strict';
// 0.16.9 (owner, 2026-10-01): a published report is kept current. The Stop
// hook reads the transcript and holds the turn open once when something
// changed after the last publish of a report-like artifact.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');
const { toolCalls, staleReport, reminderLine } = require('../hooks/report-fresh');

const T0 = Date.parse('2026-10-01T09:00:00Z');
const call = (min, name, input) => ({ at: T0 + min * 60000, name, input });
const titles = { 'r.html': 'Gün Sonu Takip', 'x.html': 'Veliefendi Ekipman' };
const titleOf = (p) => titles[p] || '';

test('no report published: nothing to say', () => {
  assert.strictEqual(staleReport([call(0, 'Artifact', { file_path: 'x.html' }), call(1, 'Edit', { file_path: 'a.md' })], titleOf), null);
});

test('a report with nothing after it is current', () => {
  assert.strictEqual(staleReport([call(0, 'Edit', { file_path: 'a.md' }), call(1, 'Artifact', { file_path: 'r.html' })], titleOf), null);
});

test('edits and other publishes after the report are counted, each file or page once', () => {
  const s = staleReport([
    call(0, 'Artifact', { file_path: 'r.html' }),
    call(1, 'Edit', { file_path: 'a.md' }),
    call(2, 'Write', { file_path: 'a.md' }),
    call(3, 'Artifact', { file_path: 'x.html' }),
    call(4, 'Artifact', { file_path: 'x.html' }),
    call(5, 'Read', { file_path: 'b.md' }),
  ], titleOf);
  assert.deepStrictEqual([s.file, s.at, s.n], ['r.html', T0, 2]);
});

test('republishing the report resets it; the description alone marks a report', () => {
  const calls = [
    call(0, 'Artifact', { file_path: 'y.html', description: 'Weekly status' }),
    call(1, 'Edit', { file_path: 'a.md' }),
    call(2, 'Artifact', { file_path: 'y.html' }),
  ];
  assert.strictEqual(staleReport(calls, titleOf), null);
  assert.strictEqual(staleReport(calls.slice(0, 2), titleOf).n, 1);
});

test('quickstart, asset uploads and reads are not publishes', () => {
  assert.strictEqual(staleReport([
    call(0, 'Artifact', { file_path: 'r.html' }),
    call(1, 'Artifact', { action: 'quickstart', intent: 'other' }),
    call(2, 'Artifact', { action: 'read', url: 'u' }),
    call(3, 'Artifact', { url: 'u', asset: true, file_path: 'p.png' }),
  ], titleOf), null);
});

test('files git sees changed after the publish count; older ones do not', () => {
  const s = staleReport([call(0, 'Artifact', { file_path: 'r.html' })], titleOf,
    [['/w/new.md', T0 + 1000], ['/w/old.md', T0 - 1000]]);
  assert.strictEqual(s.n, 1);
});

test('the line is in the owner language', () => {
  const s = { at: new Date(2026, 9, 1, 14, 5).valueOf(), n: 3 };
  assert.strictEqual(reminderLine(s, 'Turkish'), 'Yayınlanan rapor güncel mi? Son yayın 14:05, sonrasında 3 değişiklik.');
  assert.strictEqual(reminderLine(s, 'English'), 'Is the published report current? Last publish 14:05, 3 changes since.');
});

test('toolCalls keeps main-thread tool_use lines and skips the rest', () => {
  const line = (o) => JSON.stringify(o);
  const text = [
    line({ timestamp: '2026-10-01T09:00:00Z', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a' } }] } }),
    line({ timestamp: '2026-10-01T09:01:00Z', isSidechain: true, message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } }),
    '{"type":"tool_use" broken',
    line({ timestamp: '2026-10-01T09:02:00Z', message: { content: [{ type: 'text', text: 'tool_use' }] } }),
  ].join('\n');
  assert.deepStrictEqual(toolCalls(text).map((c) => c.name), ['Edit']);
});

test('the hook blocks once with the line, then stays quiet', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'Turkish', '--role', 'r']);
  const report = path.join(dir, 'report.html');
  fs.writeFileSync(report, '<html><head><title>Gün Sonu 01.10</title></head></html>');
  const tool = (ts, name, input) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', name, input }] } });
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, [
    tool('2026-10-01T09:00:00Z', 'Artifact', { file_path: report }),
    tool('2026-10-01T09:05:00Z', 'Edit', { file_path: path.join(dir, 'a.md') }),
  ].join('\n'));
  const run = (extra) => spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'report-fresh.js')], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ transcript_path: transcript, ...extra }),
  });
  const id = `test-${process.pid}-${Date.now()}`;
  const first = run({ session_id: id });
  assert.strictEqual(first.status, 0, first.stderr);
  const out = JSON.parse(first.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /^Yayınlanan rapor güncel mi\? Son yayın \d\d:\d\d, sonrasında \d+ değişiklik\.$/);
  assert.strictEqual(run({ session_id: id }).stdout, '', 'same state twice is one reminder');
  assert.strictEqual(run({ stop_hook_active: true }).stdout, '', 'never loops');
  assert.strictEqual(spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'report-fresh.js')],
    { cwd: dir, input: 'not json', encoding: 'utf8' }).stdout, '', 'fails silent');
});

test('the report-freshness hook is registered on Stop', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.ok((hooks.hooks.Stop || []).some((e) => e.hooks.some((h) =>
    h.command === 'node "${CLAUDE_PLUGIN_ROOT}/hooks/report-fresh.js"' && h.shell === 'bash')));
});
