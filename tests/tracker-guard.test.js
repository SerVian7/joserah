'use strict';
// hooks/tracker-guard.js (owner, 2026-10-05: "bunu da sık sık yapıyorsun iki konuda kızdım ciddiye alıp
// gerçekten testini yapıp çözmek lazım bu iki sorunu"). Rules alone failed, so the main session's turn
// cannot end while the owner's Daily Tracker is out of date or answers only in chat:
//   A2  today's Tracker page changed since its last publish (publishes recorded by PostToolUse on Artifact)
//   B1  an owner row waiting on a decision fails the decision-row check
//   B2  the reply is a deliverable (a fenced block of 4+ lines, or more than 15 lines) with no page link
// Payloads are the real ones captured 2026-10-05 (tests/fixtures/hook-payloads), fields as captured.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

const FX = path.join(__dirname, 'fixtures', 'hook-payloads');
const STOP = JSON.parse(fs.readFileSync(path.join(FX, 'fg-Stop1.json'), 'utf8'));
const NOW = '2026-10-05T09:00:00';
function setup(t) {
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'A B']);
  const tr = path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-05', 'daily-tracker');
  runTool('tracker.js', ['init', tr, '--title', 'A B · Daily Tracker'], { env: { JOSERAH_NOW: '2026-10-05T08:00:00' } });
  runTool('tracker.js', [tr], { env: { JOSERAH_NOW: '2026-10-05T08:00:00' } });
  const state = path.join(tmpdir(t), 'state');
  fs.mkdirSync(state);
  const env = { ...process.env, JOSERAH_NOW: NOW, JOSERAH_STATE_DIR: state };
  const run = (event, payload) => spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'tracker-guard.js'), event],
    { cwd: ws, input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env, timeout: 8000 });
  const stop = (over = {}) => run('stop', { ...STOP, cwd: ws, ...over });
  const publish = (file = path.join(tr, 'index.html'), over = {}) => run('post-tool-use', {
    session_id: STOP.session_id, cwd: ws, hook_event_name: 'PostToolUse', tool_name: 'Artifact',
    tool_input: { file_path: file, ...over }, tool_response: {}, tool_use_id: 'toolu_x',
  });
  const out = (r) => (r.stdout ? JSON.parse(r.stdout) : null);
  return { ws, tr, state, env, run, stop, publish, out };
}

test('A2: an unpublished Tracker page holds the turn; a publish of it lets it end', (t) => {
  const f = setup(t);
  const o = f.out(f.stop());
  assert.strictEqual(o.decision, 'block');
  assert.match(o.reason, /Daily Tracker changed since its last publish/);
  assert.strictEqual(f.publish().status, 0);
  assert.strictEqual(f.stop().stdout, '', 'published, unchanged: the turn ends');
});
test('A2: a change to the page after its publish holds the turn; a re-render that changes only the stamp does not', (t) => {
  const f = setup(t);
  f.publish();
  runTool('tracker.js', [f.tr], { env: { JOSERAH_NOW: '2026-10-05T08:30:00' } });
  assert.strictEqual(f.stop().stdout, '', 'only the updated stamp moved');
  runTool('tracker.js', ['row', f.tr, '--title', 'New job', '--state', 'wait'], { env: { JOSERAH_NOW: '2026-10-05T08:40:00' } });
  assert.match(f.out(f.stop()).reason, /Daily Tracker changed since its last publish/);
});
test('A2: another file published, a read of the Tracker, or an asset upload is no publish of the page', (t) => {
  const f = setup(t);
  f.publish(path.join(f.ws, 'other.html'));
  f.publish(path.join(f.tr, 'index.html'), { action: 'read' });
  f.publish(path.join(f.tr, 'index.html'), { asset: true });
  assert.strictEqual(f.out(f.stop()).decision, 'block');
});
test('A2: no Tracker today, or dailyTracker off, asks nothing about it', (t) => {
  const f = setup(t);
  fs.rmSync(f.tr, { recursive: true });
  assert.strictEqual(f.stop().stdout, '');
  const g = setup(t);
  const cfg = path.join(g.ws, '.joserah', 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), dailyTracker: false }));
  assert.strictEqual(g.stop().stdout, '');
});

test('B1: an owner row waiting on a decision without its options holds the turn', (t) => {
  const f = setup(t);
  const store = path.join(f.tr, 'rows.json');
  // written by hand, as a session would, past the updater's own check
  fs.writeFileSync(store, JSON.stringify([{ state: 'you', title: 'Hangi yapı?', time: '08:10' }]));
  f.publish();
  let o = f.out(f.stop());
  assert.match(o.reason, /owner row "Hangi yapı\?" waits on a decision without options, recommend and why/);
  fs.writeFileSync(store, JSON.stringify([{ state: 'you', title: 'Seçim', why: 'x', time: '08:10' }]));
  o = f.out(f.stop());
  assert.match(o.reason, /owner row "Seçim" waits on a decision without options, recommend and why/, 'the updater\'s own check');
  fs.writeFileSync(store, JSON.stringify([
    { state: 'you', title: 'Hangi yapı?', options: [{ key: 'A', label: 'x' }, { key: 'B', label: 'y' }], recommend: 'A', why: 'z', time: '08:10' },
    { state: 'you', title: 'Eklentileri yeniden yükleyin', time: '08:11' },
    { state: 'ok', title: 'Bitti mi?', time: '08:12' },
  ]));
  assert.strictEqual(f.stop().stdout, '', 'a full decision, an action row and a done row pass');
});

const fence = (n) => ['Taslak:', '```', ...Array.from({ length: n }, (_, i) => `satır ${i + 1}`), '```'].join('\n');
test('B2: a deliverable in chat without a page link holds the turn; with the link, or a one-line command, it does not', (t) => {
  const f = setup(t);
  f.publish();
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
  assert.strictEqual(f.out(f.stop()).decision, 'block');
  assert.strictEqual(f.stop({ stop_hook_active: true }).stdout, '', 'the same reason, once');
  // a new reason while held still blocks once, then the turn ends
  assert.match(f.out(f.stop({ stop_hook_active: true, last_assistant_message: fence(5) })).reason, /deliverable must be a page/);
  assert.strictEqual(f.stop({ stop_hook_active: true, last_assistant_message: fence(5) }).stdout, '');
  // a fresh turn starts over
  assert.strictEqual(f.out(f.stop({ stop_hook_active: false })).decision, 'block');
});
test('several reasons: one block, one line each', (t) => {
  const f = setup(t);
  const o = f.out(f.stop({ last_assistant_message: fence(6) }));
  assert.strictEqual(o.decision, 'block');
  assert.match(o.reason, /^Daily Tracker changed since its last publish[^\n]* · deliverable must be a page[^\n]*$/);
});

test('fail-open: a broken payload, a broken store, a subagent or an outside folder ends the turn silently', (t) => {
  const f = setup(t);
  for (const p of ['not json', '', '[]', '{"stop_hook_active":"x"}']) {
    const r = f.run('stop', p);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '', JSON.stringify(p));
  }
  assert.strictEqual(f.stop({ agent_id: 'a1' }).stdout, '', 'a subagent payload is never held');
  f.publish();
  fs.writeFileSync(path.join(f.tr, 'rows.json'), '{ broken');
  const r = f.stop();
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '', 'a store it cannot read decides nothing');
  const out = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'tracker-guard.js'), 'stop'],
    { cwd: tmpdir(t), input: JSON.stringify({ ...STOP, last_assistant_message: fence(9) }), encoding: 'utf8', env: f.env });
  assert.strictEqual(out.stdout, '', 'outside a workspace');
  assert.strictEqual(f.run('post-tool-use', 'not json').status, 0);
});

test('tracker-guard.js is registered on Stop and on the Artifact tool\'s PostToolUse', () => {
  const h = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const cmd = (e) => ({ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/tracker-guard.js" ${e}`, shell: 'bash' });
  assert.ok(h.Stop.some((g) => g.hooks.some((x) => JSON.stringify(x) === JSON.stringify(cmd('stop')))));
  const pt = h.PostToolUse.find((g) => g.matcher === 'Artifact');
  assert.ok(pt);
  assert.deepStrictEqual(pt.hooks, [cmd('post-tool-use')]);
});
