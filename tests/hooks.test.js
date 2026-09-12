'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT, HERMETIC_CONFIG_DIR, fakeMarketplace } = require('./helpers');

function hookWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}
// Hermetic like runTool: the session-start hook resolves the prompt source
// from CLAUDE_CONFIG_DIR, and must never see the developer's real clone here.
function runHook(name, cwd, stdin, configDir) {
  return spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', name)],
    { cwd, input: stdin, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: configDir || HERMETIC_CONFIG_DIR } });
}

test('M1: session-start on a fresh workspace reports no changed files', (t) => {
  const r = runHook('session-start.js', hookWs(t));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[backup\]/, 'own journal stub must not count as a change');
});

// P2-2 regression guard: the staleness counter's scope IS the backup scope
// (.joserah/desk, .joserah/knowledge, .joserah/personal). Root imports/
// (formerly raw/) is outside that scope on purpose — it is immutable source
// material, never carried by the repository backup route — so a file dropped
// there must never inflate "[backup] N file(s) changed".
test('staleness counter ignores the root imports/ tree', (t) => {
  const dir = hookWs(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.lastBackup = new Date().toISOString();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  fs.mkdirSync(path.join(dir, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'imports', 'huge-vendor.pdf.md'), 'new source material\n');

  const r = runHook('session-start.js', dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/\[backup\] 1 file/.test(r.stdout), 'imports/ must not inflate the counter');
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

// ---- update check at session start (0.4.1) -----------------------------------

test('session-start says nothing about updates when prompt and plugin are current', (t) => {
  const r = runHook('session-start.js', hookWs(t));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[update\]/);
});

test('session-start refreshes a pristine-but-behind AGENTS.md on the spot and says so', (t) => {
  const dir = hookWs(t);
  const configDir = fakeMarketplace(t, 42);
  const r = runHook('session-start.js', dir, undefined, configDir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[update\] The standing instructions were refreshed to prompt v42 \(was v\d+\)/);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /prompt-version 42/);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.promptVersion, 42);
  // Second start: current now, nothing to say.
  const again = runHook('session-start.js', dir, undefined, configDir);
  assert.doesNotMatch(again.stdout, /\[update\]/);
});

test('session-start leaves a hand-edited AGENTS.md alone and only reports the newer prompt', (t) => {
  const dir = hookWs(t);
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nmy own rule\n');
  const r = runHook('session-start.js', dir, undefined, fakeMarketplace(t, 42));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[update\] Prompt v42 is available but this workspace's AGENTS\.md was hand-edited/);
  assert.match(r.stdout, /joserah:update/);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /my own rule/);
});

test('session-start reports a newer plugin in the marketplace clone without touching anything', (t) => {
  const dir = hookWs(t);
  const installed = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const promptV = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8')).promptVersion;
  const r = runHook('session-start.js', dir, undefined, fakeMarketplace(t, promptV, null, { pluginVersion: '99.0.0' }));
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(`[update] Joserah plugin 99.0.0 is available (installed: ${installed})`), ctx);
  assert.doesNotMatch(ctx, /refreshed to prompt/);
});

// ---- the two standing layers are injected, not pointed at (0.7.0) ------------
// Until 0.7.0 the role file and the workspace's directives were only named by
// AGENTS.md's "read next" sentence. A session either opened them or did not,
// and the owner's own rules were in force only in the sessions that did. They
// are now injected like every other layer, so "in force" no longer depends on
// the assistant's choice.

function writeDirectives(dir, body) {
  fs.writeFileSync(path.join(dir, '.joserah', 'directives.md'),
    `# Directives — w\n\n## Scope\n\n${body}\n`);
}

test('session-start injects the role file and the workspace directives', (t) => {
  const dir = hookWs(t);
  writeDirectives(dir, '- Never mail anyone but the counterparty named here.');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /JOSERAH-ROLE\.md/);
  assert.match(ctx, /There is no ambiguity to resolve/, 'the role file arrives in full');
  assert.match(ctx, /\.joserah\/directives\.md/);
  assert.match(ctx, /Never mail anyone but the counterparty named here/);
  // Order: the role supplements AGENTS.md and comes first; the directives win
  // over everything above them and are read last of the standing layers.
  assert.ok(ctx.indexOf('JOSERAH-ROLE.md') < ctx.indexOf('## This workspace'),
    'the role block comes before the workspace block');
  assert.ok(ctx.indexOf('.joserah/directives.md') > ctx.indexOf('## This workspace'),
    'the directives come after the workspace block');
  assert.ok(ctx.indexOf('.joserah/directives.md') < ctx.indexOf('## Right now'),
    'the directives come before the computed block');
});

// A workspace several people reach carries a different role file, and a hosted
// one carries its own directives: nothing here may assume the layout of the
// workspace it was developed in.
test('a shared workspace is injected its own server role, a hosted one its own directives', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--kind', 'shared']);
  writeDirectives(dir, '- Answer only within what the asker is permitted to see.');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Records here are shared/, 'the server role, not the client one');
  assert.doesNotMatch(ctx, /There is no ambiguity to resolve/);
  assert.match(ctx, /Answer only within what the asker is permitted to see/);

  const hosted = path.join(tmpdir(t), 'hosted');
  runTool('scaffold.js', ['--target', hosted, '--workspace', 'h', '--kind', 'hosted']);
  writeDirectives(hosted, '- The host never speaks for the owner.');
  const hostedCtx = JSON.parse(runHook('session-start.js', hosted).stdout).hookSpecificOutput.additionalContext;
  assert.match(hostedCtx, /The host never speaks for the owner/);
  assert.match(hostedCtx, /There is no ambiguity to resolve/, 'a hosted workspace still has one owner');
});

test('session-start says nothing when either file is missing', (t) => {
  const dir = hookWs(t);
  fs.rmSync(path.join(dir, 'JOSERAH-ROLE.md'));
  fs.rmSync(path.join(dir, '.joserah', 'directives.md'));

  const r = runHook('session-start.js', dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /JOSERAH-ROLE\.md/, 'no empty block, no placeholder');
  assert.doesNotMatch(ctx, /\.joserah\/directives\.md/);
  assert.match(ctx, /## This workspace/, 'the rest of the briefing is unaffected');
});

test('session-start says nothing for an empty directives file', (t) => {
  const dir = hookWs(t);
  fs.writeFileSync(path.join(dir, '.joserah', 'directives.md'), '\n   \n');
  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /\.joserah\/directives\.md/);
});

// A freshly scaffolded workspace ships the directives skeleton: explanation,
// three headings, and HTML comments telling the owner what to write under
// each. That is not a rule, and injecting it spends context on instructions
// addressed to the owner — the assistant would be reading an empty form.
test('session-start does not inject the untouched directives skeleton', (t) => {
  const dir = hookWs(t);
  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /\.joserah\/directives\.md/);
  assert.doesNotMatch(ctx, /Who the assistant is in this workspace/,
    'the authoring comments must never reach a session');

  // One rule written under a heading is enough to make the file real.
  fs.appendFileSync(path.join(dir, '.joserah', 'directives.md'),
    '\n- Weekly report goes out on Friday, never before.\n');
  const after = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(after, /Weekly report goes out on Friday/);
});

// A silently truncated rule is worse than no rule: this is the exact failure
// the whole change exists to fix, so the cut has to be announced.
test('session-start cuts an over-long directives file and says so in the text', (t) => {
  const dir = hookWs(t);
  writeDirectives(dir, '- First rule, at the top.\n\n' + 'filler line to make this file long.\n'.repeat(400) +
    '\n- LAST-RULE-MARKER, past the cap.');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /First rule, at the top/);
  assert.doesNotMatch(ctx, /LAST-RULE-MARKER/, 'the tail is past the cap');
  assert.match(ctx, /\[cut\]/, 'the model is told the text was cut');
  assert.match(ctx, /character\(s\) of it were not injected/i);
  assert.match(ctx, /\.joserah\/directives\.md/);
});

test('a role file is capped the same way, and nothing short of the cap is touched', (t) => {
  const dir = hookWs(t);
  const role = path.join(dir, 'JOSERAH-ROLE.md');
  const original = fs.readFileSync(role, 'utf8');
  let ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(original.trim().replace(/\r\n/g, '\n')), 'a normal role file arrives whole');

  fs.writeFileSync(role, original + '\nX'.repeat(12000) + '\nROLE-TAIL-MARKER\n');
  ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /ROLE-TAIL-MARKER/);
  assert.match(ctx, /\[cut\] JOSERAH-ROLE\.md/);
});

// ---- D3: after a move or rename, the link check runs (0.10.0) ----------------

function brokenLink(dir) {
  fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n\n[gone](does-not-exist.md)\n');
}

test('post-tool-use reports broken links after a move command', (t) => {
  const dir = hookWs(t);
  brokenLink(dir);
  const r = runHook('post-tool-use.js', dir,
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git mv a.md b.md' } }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /does-not-exist\.md/, 'the broken link must be named');
});

test('post-tool-use says nothing after a command that moves nothing', (t) => {
  const dir = hookWs(t);
  brokenLink(dir);
  const r = runHook('post-tool-use.js', dir,
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'node --test tests/*.test.js' } }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
});

// 0.11.2: the briefing picked the first three sections of learned.md and called
// them the newest. That is true only while the file happens to be written
// newest-first — and in a workspace kept oldest-first, or one where a single
// entry was appended at the bottom, the newest rules reached no session at all
// while the owner could see them written down and assumed they were in force.
test('the briefing carries the newest learnings wherever they sit in the file', (t) => {
  const dir = hookWs(t);
  fs.writeFileSync(path.join(dir, '.joserah', 'learned.md'), [
    '# Learned', '',
    '## 2024-01-01 — oldest rule', 'ancient', '',
    '## 2024-01-02 — middle rule', 'middling', '',
    '## 2026-09-11 — a later rule', 'later still', '',
    '## 2026-09-13 — appended at the bottom', 'the newest rule of all', '',
    '## Relations', 'not a learning, carries no date', '',
  ].join('\n'));

  const r = runHook('session-start.js', dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /appended at the bottom/, 'the newest entry never reached the session');
  assert.doesNotMatch(r.stdout, /not a learning, carries no date/, 'an undated section is not a learning');
  // Three slots, and the oldest of four dated entries is the one that loses its
  // place — not whichever happened to be typed last.
  assert.doesNotMatch(r.stdout, /ancient/, 'the oldest entry took a slot from a newer one');
});
