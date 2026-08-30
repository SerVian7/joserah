'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

function hookWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}
function runHook(name, cwd, stdin) {
  return spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', name)],
    { cwd, input: stdin, encoding: 'utf8' });
}

test('M1: session-start on a fresh workspace reports no changed files', (t) => {
  const r = runHook('session-start.js', hookWs(t));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[backup\]/, 'own journal stub must not count as a change');
});

test('M11: trigger inside a longer word does not capture', (t) => {
  const ws = hookWs(t);
  const r = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: 'dosyayı kaydettim az önce' }));
  assert.doesNotMatch(r.stdout, /\[capture\]/);
  const r2 = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: 'bunu kaydet lütfen' }));
  assert.match(r2.stdout, /\[capture\]/);
});

test('M11: trigger glued to a Turkish capital dotted I does not capture', (t) => {
  // toLowerCase() is not locale-aware: 'İ' (U+0130) lowercases to 'i' plus a
  // COMBINING DOT ABOVE (U+0307), not a single 'i'. A trigger glued directly
  // to an 'İ'-prefixed word must still be treated as embedded, not boundary-hit.
  const ws = hookWs(t);
  const r = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: 'İkaydet bunu' }));
  assert.doesNotMatch(r.stdout, /\[capture\]/);
  const r2 = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: 'kaydet bunu' }));
  assert.match(r2.stdout, /\[capture\]/);
});

test('M10: a git SHA survives redaction; an sk- key does not', () => {
  const { redact } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'redactions'));
  const sha = 'a'.repeat(39) + 'b';
  assert.strictEqual(redact(`commit ${sha}`).text, `commit ${sha}`);
  assert.match(redact('key sk-' + 'x'.repeat(20)).text, /\[redacted\]/);
});

test('M15: BOM in config.json does not blank the config', (t) => {
  const ws = hookWs(t);
  const cfgPath = path.join(ws, '.joserah', 'config.json');
  fs.writeFileSync(cfgPath, '\uFEFF' + fs.readFileSync(cfgPath, 'utf8'));
  const { readConfig } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'workspace'));
  assert.strictEqual(readConfig(ws).workspaceName, 'w');
});

// Identity must arrive through the injected context, not through a file the
// model may never open. Regression guard for 2026-08-30: an assistant with
// `assistantName: "Rıfkı"` on record still introduced itself as Claude.
test('session-start injects the assistant name, owner and language', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w',
    '--owner', 'Sevgi D. Akkaya', '--language', 'Turkish']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.assistantName = 'Rıfkı';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  const r = runHook('session-start.js', dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Your name in this workspace is Rıfkı/);
  assert.match(ctx, /Sevgi D\. Akkaya/);
  assert.match(ctx, /Speak \*\*Turkish\*\*/);
  assert.match(ctx, /not a developer of this software/);
  assert.match(ctx, /Open by greeting them by name/);
});

test('session-start adds the guest confinement line only for a guest workspace', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');

  let ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /Trust: \*\*guest\*\*/);

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.trust = 'guest';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Trust: \*\*guest\*\*/);
});

test('scaffold ships an agent overlay that is empty of rules', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const text = fs.readFileSync(path.join(dir, '.joserah', 'agent.md'), 'utf8');
  assert.match(text, /^#\s/m, 'has a heading explaining what it is for');
  assert.doesNotMatch(text, /^\s*[-*]\s+\w/m, 'ships no rules of its own');
});

test('session-start injects the agent overlay only when it has content', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--assistant', 'Ada']);
  const agentPath = path.join(dir, '.joserah', 'agent.md');

  let ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /## This assistant/, 'an empty overlay adds nothing');

  fs.appendFileSync(agentPath, '\n- Always answer in bullet points.\n');
  ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /## This assistant/);
  assert.match(ctx, /Always answer in bullet points/);
  assert.ok(ctx.indexOf('## This workspace') < ctx.indexOf('## This assistant'),
    'agent overlay comes after the workspace block');
  assert.ok(ctx.indexOf('## This assistant') < ctx.indexOf('## Right now'),
    'agent overlay comes before the computed block');
});

// Fix round 1 for task 16: the reviewer found that comparing the workspace's
// agent.md against a template read from `../templates/.joserah/agent.md` at
// runtime had two opposite failure modes — a missing/unreadable templates/
// tree makes the read return '', which makes every file trivially "start
// with" it, silently injecting the whole untouched essay; and a future
// reword of the shipped prose would make an *old* workspace's copy stop
// matching, leaking its own stale essay instead. Both are impossible once
// there is no comparison at all — this guards that the fix actually removed
// the read rather than just papering over one of the two symptoms.
test('session-start reads no path outside the workspace to detect the agent overlay', (t) => {
  const src = fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'session-start.js'), 'utf8');
  assert.doesNotMatch(src, /__dirname/,
    'the agent-overlay check must not depend on any path relative to the plugin install — ' +
    'that read is exactly what let a missing templates/ tree silently inject boilerplate');
});

test('session-start ignores stale or mismatched boilerplate above the marker', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const agentPath = path.join(dir, '.joserah', 'agent.md');
  // Deliberately NOT what templates/.joserah/agent.md ships today — simulates
  // a workspace scaffolded under an older wording that has since been
  // reworded. If the hook compared against the *current* template text this
  // would fail to match and the whole paragraph below would leak into
  // context alongside the owner's real line.
  fs.writeFileSync(agentPath,
    '# This assistant (some since-reworded explanation, long gone from the current template)\n\n' +
    'A paragraph that no longer matches anything the plugin ships today.\n\n' +
    '<!-- joserah:agent-overlay-below -->\n' +
    '- Always answer in bullet points.\n');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Always answer in bullet points/);
  assert.doesNotMatch(ctx, /since-reworded explanation/,
    'stale boilerplate above the marker must never leak into context, no matter how it reads');
});

test('session-start injects nothing when the marker is missing', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const agentPath = path.join(dir, '.joserah', 'agent.md');
  // A hand-made or hand-edited file with no marker at all: there is no
  // reliable boundary between "explanation" and "rule" left to detect, so
  // the safe default is silence, not dumping the whole file into context —
  // this owner never opted into the marker protocol at all.
  fs.writeFileSync(agentPath, '# Some hand-made file\n\nJust some notes, no marker anywhere.\n');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /## This assistant/);
});

// Task 22: firstNOpenTasks kept only the `- [ ]` marker line itself. Every
// task in the akkaya workspace is a wrapped paragraph, so the briefing
// arrived mid-sentence — one session was told a task concerned "Işılay Gece,
// Orhan" and got nothing further. The indented continuation lines belong to
// the task and must ride along with it, up to the next `- [ ]` or a blank
// line.
test('session-start carries a wrapped multi-line task in whole, not cut at the marker line', (t) => {
  const dir = hookWs(t);
  const nowPath = path.join(dir, '.joserah', 'desk', 'tasks', 'now.md');
  fs.writeFileSync(nowPath,
    '# now — current focus\n\n' +
    '- [ ] [2026-08-30] Işılay Gece, Orhan ile konuşulacak konular üzerine uzun bir\n' +
    '  paragraf halinde yazılmış bir görev; cümle burada bitmiyor, devam ediyor ve\n' +
    '  önemli detaylar tam da bu devam satırlarında duruyor.\n' +
    '- [ ] [2026-08-30] second task, one line\n');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Işılay Gece, Orhan/);
  assert.match(ctx, /önemli detaylar tam da bu devam satırlarında duruyor/,
    'continuation lines must arrive with the task, not be cut off mid-sentence');
  assert.match(ctx, /second task, one line/,
    'the next task is a separate item, not swallowed into the previous one');
});
