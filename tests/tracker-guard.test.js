'use strict';
// hooks/tracker-guard.js: a deliverable that lives only in chat holds the turn once (owner, 2026-10-05).
// The Tracker checks it used to carry (page published, decision rows) moved to the live page and tools/jobs-check.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

const FX = path.join(__dirname, 'fixtures', 'hook-payloads');
const STOP = JSON.parse(fs.readFileSync(path.join(FX, 'fg-Stop1.json'), 'utf8'));
function setup(t) {
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'A B']);
  const state = path.join(tmpdir(t), 'state');
  fs.mkdirSync(state);
  const env = { ...process.env, JOSERAH_STATE_DIR: state };
  const run = (event, payload) => spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'tracker-guard.js'), event],
    { cwd: ws, input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env, timeout: 8000 });
  const stop = (over = {}) => run('stop', { ...STOP, cwd: ws, ...over });
  const out = (r) => (r.stdout ? JSON.parse(r.stdout) : null);
  return { ws, env, run, stop, out };
}

const fence = (n) => ['Taslak:', '```', ...Array.from({ length: n }, (_, i) => `satır ${i + 1}`), '```'].join('\n');
test('a deliverable in chat without a page link holds the turn; with the link, or a one-line command, it does not', (t) => {
  const f = setup(t);
  assert.strictEqual(f.stop().stdout, '', 'a plain reply ends the turn');
  assert.match(f.out(f.stop({ last_assistant_message: fence(4) })).reason, /deliverable must be a page/);
  assert.strictEqual(f.stop({ last_assistant_message: `${fence(4)}\nhttps://claude.ai/artifact/abc123` }).stdout, '');
  assert.strictEqual(f.stop({ last_assistant_message: 'Çalıştırın:\n```\nnode .joserah/tools/secret.js --set a.b.c\n```' }).stdout, '', 'a command to run is no deliverable');
  const lines = (n) => Array.from({ length: n }, (_, i) => `madde ${i + 1}`).join('\n');
  assert.strictEqual(f.stop({ last_assistant_message: lines(15) }).stdout, '', '15 lines is a reply');
  assert.match(f.out(f.stop({ last_assistant_message: lines(16) })).reason, /deliverable must be a page/);
  assert.strictEqual(f.stop({ last_assistant_message: `${lines(20)}\nhttps://claude.ai/code/artifact/0f0e` }).stdout, '');
});

test('no loop: a reason already blocked on is not blocked again while the hook holds the turn', (t) => {
  const f = setup(t);
  assert.strictEqual(f.out(f.stop({ last_assistant_message: fence(5) })).decision, 'block');
  assert.strictEqual(f.stop({ stop_hook_active: true, last_assistant_message: fence(5) }).stdout, '', 'the same reason, once');
  assert.strictEqual(f.out(f.stop({ stop_hook_active: false, last_assistant_message: fence(5) })).decision, 'block', 'a fresh turn starts over');
});

test('fail-open: a broken payload, a subagent or an outside folder ends the turn silently', (t) => {
  const f = setup(t);
  for (const p of ['not json', '', '[]', '{"stop_hook_active":"x"}']) {
    const r = f.run('stop', p);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '', JSON.stringify(p));
  }
  assert.strictEqual(f.stop({ agent_id: 'a1', last_assistant_message: fence(9) }).stdout, '', 'a subagent payload is never held');
  const out = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'tracker-guard.js'), 'stop'],
    { cwd: tmpdir(t), input: JSON.stringify({ ...STOP, last_assistant_message: fence(9) }), encoding: 'utf8', env: f.env });
  assert.strictEqual(out.stdout, '', 'outside a workspace');
});

test('tracker-guard.js is registered on Stop only', () => {
  const h = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const cmd = { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/tracker-guard.js" stop', shell: 'bash' };
  assert.ok(h.Stop.some((g) => g.hooks.some((x) => JSON.stringify(x) === JSON.stringify(cmd))));
  assert.ok(!JSON.stringify(h.PostToolUse).includes('tracker-guard'));
});

// owner, 2026-10-05: "Otomatik Artifact yayınlamayı bırak. ama dosyaları yine de oluştur. MD olarak oluştur."
const switchOff = (f) => {
  const cfg = path.join(f.ws, '.joserah', 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), artifacts: false }));
};
const long = Array.from({ length: 20 }, (_, i) => `madde ${i + 1}`).join('\n');
test('artifacts off: a deliverable must name a local .md file, a page link no longer does', (t) => {
  const f = setup(t);
  switchOff(f);
  const o = f.out(f.stop({ last_assistant_message: long }));
  assert.strictEqual(o.reason, 'deliverable must be saved as a Markdown file: write it and name the file in one line');
  assert.strictEqual(f.stop({ last_assistant_message: `${long}\nhttps://claude.ai/artifact/abc123` }).stdout !== '', true, 'a page link is not a file');
  assert.strictEqual(f.stop({ last_assistant_message: `${long}\nhttps://example.com/readme.md` }).stdout !== '', true, 'a URL is not a local path');
  for (const named of ['Dosya: C:\\Users\\x\\notes\\rapor.md', 'Yazdım: ./notes/rapor.md', 'Yazdım: `rapor.md`', 'bkz. [rapor](docs/rapor.md)']) {
    assert.strictEqual(f.stop({ last_assistant_message: `${long}\n${named}` }).stdout, '', named);
  }
});
test('artifacts on or absent: a .md path does not stand in for the page link', (t) => {
  const f = setup(t);
  assert.match(f.out(f.stop({ last_assistant_message: `${long}\n./notes/rapor.md` })).reason, /deliverable must be a page/);
});
