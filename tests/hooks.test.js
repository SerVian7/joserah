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
function runHook(name, cwd, stdin, configDir, args) {
  return spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', name), ...(args || [])],
    { cwd, input: stdin, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: configDir || HERMETIC_CONFIG_DIR } });
}

test('M1: session-brief on a fresh workspace reports no changed files', (t) => {
  const r = runHook('session-brief.js', hookWs(t));
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

  const r = runHook('session-brief.js', dir);
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

// ---- what the owner actually typed (0.13.0) ---------------------------------
// Claude Code resumes a session by feeding synthetic blocks through this hook
// as if they were the owner's next message. Three task-notifications are in
// this workspace's captures.md as notes, each triaged "hook gürültüsü". The
// trigger word sits in the notification's own boilerplate; the tool-use id
// also matches the secret-looking-token rule. Both consumers read the same
// string, so the guard goes where it is parsed.
const NOTIFICATION = [
  '<task-notification>',
  '<task-id>ab6e72b759c1d4a90</task-id>',
  '<tool-use-id>toolu_01BZjEJwWSD1jm8jSteXg8Ee</tool-use-id>',
  '<status>completed</status>',
  '<summary>Agent "Record today\'s corrections" finished</summary>',
  '<note>A task-notification fires each time this agent stops. Sonucu kaydet.</note>',
  '</task-notification>',
].join('\n');

test('a task-notification is neither captured nor read as carrying a secret', (t) => {
  const ws = hookWs(t);
  const inbox = path.join(ws, '.joserah', 'desk', 'inbox', 'captures.md');
  const before = fs.readFileSync(inbox, 'utf8');

  const r = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: NOTIFICATION }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[capture\]/);
  assert.doesNotMatch(r.stdout, /\[vault\]/);
  assert.strictEqual(fs.readFileSync(inbox, 'utf8'), before, 'nothing was appended to the inbox');
});

test('an unterminated notification block is still not owner text', (t) => {
  const ws = hookWs(t);
  const truncated = NOTIFICATION.slice(0, NOTIFICATION.indexOf('</task-notification>'));
  const r = runHook('user-prompt-submit.js', ws, JSON.stringify({ prompt: truncated }));
  assert.doesNotMatch(r.stdout, /\[capture\]/);
});

test('what the owner typed alongside a notification is still captured', (t) => {
  const ws = hookWs(t);
  const r = runHook('user-prompt-submit.js', ws,
    JSON.stringify({ prompt: NOTIFICATION + '\n\nbunu kaydet lütfen' }));
  assert.match(r.stdout, /\[capture\]/);
  assert.match(r.stdout, /bunu kaydet lütfen/);
  assert.doesNotMatch(r.stdout, /task-notification/, 'the machine text is not written into the note');
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
// `assistantName: "Yarkın"` on record still introduced itself as Claude.
test('session-start injects the assistant name, owner and language', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w',
    '--owner', 'Selvi D. Doruca', '--language', 'Turkish']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.assistantName = 'Yarkın';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  const r = runHook('session-start.js', dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Your name in this workspace is Yarkın/);
  assert.match(ctx, /Selvi D\. Doruca/);
  assert.match(ctx, /Speak \*\*Turkish\*\*/);
  assert.match(ctx, /speak at the level they speak/);
  assert.doesNotMatch(ctx, /not a developer of this software/,
    'the briefing says how much to say, never what the person is not');
  assert.match(ctx, /Open by greeting them by name/);
  // 0.13.1: no middle dot. The name, a space, then Joserah carried by tone;
  // in plain text, where there is no faint, the comma form.
  assert.match(ctx, /you sign \*\*Yarkın Joserah\*\*/);
  assert.match(ctx, /\*\*Yarkın, Joserah\*\*/, 'the plain-text form is not offered');
  assert.doesNotMatch(ctx, /\u00b7 Joserah/, 'the middle-dot signature is gone');
  assert.doesNotMatch(ctx, /mail\.html/, 'where the templates live is the correspondence skill\'s business');
});

// 2026-09-19, the owner: "who decided reports may not name files and tools?
// This is our trade. If you are talking to a developer, of course they appear."
// The briefing asserted the owner is *not* a developer of this software, which
// the shipped AGENTS.md hard rule already excepts ("unless they ask, or they
// are the developer"). `ownerIsDeveloper: true` in config.json flips the line;
// nothing writes the key, so a client workspace never has it.
test('session-start names internals plainly when ownerIsDeveloper is set', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'Serkan']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.ownerIsDeveloper = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /The owner is a developer of this software: name files, tools, commits and versions plainly\./);
  assert.doesNotMatch(ctx, /version numbers they did not ask for\. Few words, concrete data\./);
});

// An unnamed assistant IS Joserah and is the sole author: it signs once.
test('session-start signs "Joserah" alone when no assistant name is set', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'Serkan']);
  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /you sign \*\*Joserah\*\*/);
  assert.doesNotMatch(ctx, /Joserah[ \u00b7,]+Joserah/, 'the name is written once, however it is joined');
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
// task in the doruca workspace is a wrapped paragraph, so the briefing
// arrived mid-sentence — one session was told a task concerned "Işılay Gece,
// Orhan" and got nothing further. The indented continuation lines belong to
// the task and must ride along with it, up to the next `- [ ]` or a blank
// line.
test('session-brief carries a wrapped multi-line task in whole, not cut at the marker line', (t) => {
  const dir = hookWs(t);
  const nowPath = path.join(dir, '.joserah', 'desk', 'tasks', 'now.md');
  fs.writeFileSync(nowPath,
    '# now — current focus\n\n' +
    '- [ ] [2026-08-30] Işılay Gece, Orhan ile konuşulacak konular üzerine uzun bir\n' +
    '  paragraf halinde yazılmış bir görev; cümle burada bitmiyor, devam ediyor ve\n' +
    '  önemli detaylar tam da bu devam satırlarında duruyor.\n' +
    '- [ ] [2026-08-30] second task, one line\n');

  const ctx = JSON.parse(runHook('session-brief.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Işılay Gece, Orhan/);
  assert.match(ctx, /önemli detaylar tam da bu devam satırlarında duruyor/,
    'continuation lines must arrive with the task, not be cut off mid-sentence');
  assert.match(ctx, /second task, one line/,
    'the next task is a separate item, not swallowed into the previous one');
});

// ---- update check at session start (0.4.1) -----------------------------------

test('session-brief says nothing about updates when prompt and plugin are current', (t) => {
  const r = runHook('session-brief.js', hookWs(t));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\[update\]/);
});

test('session-brief refreshes a pristine-but-behind AGENTS.md on the spot and says so', (t) => {
  const dir = hookWs(t);
  const configDir = fakeMarketplace(t, 42);
  const r = runHook('session-brief.js', dir, undefined, configDir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[update\] The standing instructions were refreshed to prompt v42 \(was v\d+\)/);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /prompt-version 42/);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.promptVersion, 42);
  // Second start: current now, nothing to say.
  const again = runHook('session-brief.js', dir, undefined, configDir);
  assert.doesNotMatch(again.stdout, /\[update\]/);
});

test('session-brief leaves a hand-edited AGENTS.md alone and only reports the newer prompt', (t) => {
  const dir = hookWs(t);
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nmy own rule\n');
  const r = runHook('session-brief.js', dir, undefined, fakeMarketplace(t, 42));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[update\] Prompt v42 is available but this workspace's AGENTS\.md was hand-edited/);
  assert.match(r.stdout, /joserah:update/);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /my own rule/);
});

test('session-brief reports a newer plugin in the marketplace clone without touching anything', (t) => {
  const dir = hookWs(t);
  const installed = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const promptV = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8')).promptVersion;
  const r = runHook('session-brief.js', dir, undefined, fakeMarketplace(t, promptV, null, { pluginVersion: '99.0.0' }));
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
});

// A workspace several people reach carries a different role file, and a hosted
// one carries its own directives: nothing here may assume the layout of the
// workspace it was developed in.
test('a shared workspace is injected the server role, a hosted one the hosted role', (t) => {
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
  assert.match(hostedCtx, /the party that maintains and services this workspace/,
    'a hosted workspace gets the hosted role, not the client one');
  assert.doesNotMatch(hostedCtx, /There is no ambiguity to resolve/);
});

// A hosted workspace is the one case where "the owner is the person talking to
// you" is not safe to assume, and the briefing is the only layer that knows it.
test('a hosted workspace is told either of two people may be at the keyboard', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--kind', 'hosted']);
  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Either of them may be at the keyboard/);
  assert.match(ctx, /nothing from it goes on the owner's desk/);

  const home = path.join(tmpdir(t), 'home');
  runTool('scaffold.js', ['--target', home, '--workspace', 'h']);
  const homeCtx = JSON.parse(runHook('session-start.js', home).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(homeCtx, /may be at the keyboard/, 'only a hosted workspace has two candidates');
});

test('a hosted workspace names its host when config.json records one', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--kind', 'hosted']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.hosting = { ...(cfg.hosting || {}), host: 'atlas' };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /belong to \*\*atlas\*\*/);
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

  const r = runHook('session-brief.js', dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /appended at the bottom/, 'the newest entry never reached the session');
  assert.doesNotMatch(r.stdout, /not a learning, carries no date/, 'an undated section is not a learning');
  // Three slots, and the oldest of four dated entries is the one that loses its
  // place — not whichever happened to be typed last.
  assert.doesNotMatch(r.stdout, /ancient/, 'the oldest entry took a slot from a newer one');
});

// 0.14.0 (FACTS #14): three full entries was also a silent cap — a fourth rule
// the owner wrote down was invisible to every session, with nothing saying so.
// Every dated rule is named now; only the newest few are carried in full.
test('every learned rule is at least named, and the newest few are carried in full', (t) => {
  const dir = hookWs(t);
  fs.writeFileSync(path.join(dir, '.joserah', 'learned.md'), [
    '# Learned', '',
    '## 2024-01-01 — rule one', 'body one', '',
    '## 2024-01-02 — rule two', 'body two', '',
    '## 2024-01-03 — rule three', 'body three', '',
    '## 2026-09-11 — rule four', 'body four', '',
    '## 2026-09-12 — rule five', 'body five', '',
    '## 2026-09-13 — rule six', 'body six', '',
    '## Relations', 'not a learning, carries no date', '',
  ].join('\n'));

  const ctx = JSON.parse(runHook('session-brief.js', dir).stdout).hookSpecificOutput.additionalContext;
  for (const h of ['rule one', 'rule two', 'rule three', 'rule four', 'rule five', 'rule six']) {
    assert.match(ctx, new RegExp(h), `${h} is written down but no session can see it exists`);
  }
  // Only the newest three carry their body; the rest are index lines.
  for (const b of ['body four', 'body five', 'body six']) assert.match(ctx, new RegExp(b));
  for (const b of ['body one', 'body two', 'body three']) {
    assert.doesNotMatch(ctx, new RegExp(b), 'an older rule spent the budget of a newer one');
  }
  assert.doesNotMatch(ctx, /not a learning, carries no date/);
  assert.doesNotMatch(ctx, /^- Relations/m, 'an undated section is not a learning, not even in the index');
});

// 0.12.0: the vault guard. A secret's value may only be embedded in the command
// that uses it, and the store is read only through secret.js.
const GUARD_CASES = [
  ['git add .joserah/tools/secret.js keys/AGENTS.md', false],
  ['node .joserah/tools/secret.js a.b.password', true],
  ['node "D:/w/.joserah/tools/secret.js" a.b.password', true],
  ['curl -H "x: $(node .joserah/tools/secret.js a.b.token)" u', false],
  ['curl -u "$(node .joserah/tools/secret.js a.user):$(node .joserah/tools/secret.js a.pw)" u', false],
  ['x=$(node .joserah/tools/secret.js a.pw); echo ok', false],
  ['echo ok; node .joserah/tools/secret.js a.pw', true],
  ['node .joserah/tools/secret.js --list', false],
  ['printf %s v | node .joserah/tools/secret.js --set a.b.c', false],
  ['cat keys/secrets.json', true],
  ['type keys\\secrets.json', true],
  ['grep secret.js README.md', false],
  ['node --test tests/*.test.js', false],
];

test('pre-tool-use denies a bare secret.js call and a direct read of the store', (t) => {
  const dir = hookWs(t);
  for (const [command, deny] of GUARD_CASES) {
    const r = runHook('pre-tool-use.js', dir, JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
    assert.strictEqual(r.status, 0, r.stderr);
    if (deny) {
      const out = JSON.parse(r.stdout).hookSpecificOutput;
      assert.strictEqual(out.hookEventName, 'PreToolUse');
      assert.strictEqual(out.permissionDecision, 'deny', command);
    } else {
      assert.strictEqual(r.stdout, '', command);
    }
  }
});

test('pre-tool-use is silent outside a workspace', (t) => {
  const r = runHook('pre-tool-use.js', tmpdir(t),
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat keys/secrets.json' } }));
  assert.strictEqual(r.stdout, '');
});

test('user-prompt-submit hints the vault for a secret-looking message only', (t) => {
  const dir = hookWs(t);
  for (const prompt of ['router şifre: fake123', 'the api key = abc', 'use Xk9fakeTokenValue42z']) {
    assert.match(runHook('user-prompt-submit.js', dir, JSON.stringify({ prompt })).stdout, /\[vault\]/, prompt);
  }
  for (const prompt of ['bugün ne yapıyoruz', 'spinning up the server', 'README.md is fine']) {
    assert.doesNotMatch(runHook('user-prompt-submit.js', dir, JSON.stringify({ prompt })).stdout, /\[vault\]/, prompt);
  }
});

// ---- the per-command output budget (0.13.0) ---------------------------------
// Claude Code replaces any single hook command's additionalContext over 10,000
// characters with a stub carrying only the first 2,000. Measured over 25
// sessions on CLI 2.1.269-2.1.273: this hook produced 10,140-16,417 characters
// and 2,263 arrived, every single time, for about a week — the role block's
// opening lines and nothing else. No hook command may ever hand back more than
// the budget again, and a briefing that has to be cut must say so where the
// harness preview can still show it.
const { MAX_HOOK_CHARS } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'standing-context'));

function overlongWorkspace(t) {
  const dir = hookWs(t);
  writeDirectives(dir, '- First rule, at the top.\n\n' +
    'a filler line long enough to matter, repeated.\n'.repeat(500));
  fs.writeFileSync(path.join(dir, 'JOSERAH-ROLE.md'),
    '# role\n\n' + 'a filler line in the role file, repeated.\n'.repeat(500));
  return dir;
}

test('the budget leaves real headroom under the harness cut', () => {
  assert.ok(MAX_HOOK_CHARS <= 8000, 'the harness replaces any hook command output over 10,000 characters');
  assert.ok(MAX_HOOK_CHARS >= 6000, 'a budget this low would cut ordinary workspaces');
});

test('session-start hands back no more than the per-command budget', (t) => {
  const r = runHook('session-start.js', overlongWorkspace(t));
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.length <= MAX_HOOK_CHARS,
    `session-start.js produced ${ctx.length} characters; the budget is ${MAX_HOOK_CHARS}`);
});

test('an over-budget briefing says so inside the first 2000 characters', (t) => {
  const ctx = JSON.parse(runHook('session-start.js', overlongWorkspace(t)).stdout)
    .hookSpecificOutput.additionalContext;
  assert.match(ctx.slice(0, 2000), /\[cut\] This session briefing was \d+ characters/,
    'the harness preview keeps only the first 2000 characters, so the warning has to live there');
  assert.match(ctx, /character\(s\) were dropped from the end/);
});

test('a briefing under the budget is passed through untouched', (t) => {
  const dir = hookWs(t);
  writeDirectives(dir, '- Weekly report goes out on Friday, never before.');
  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /This session briefing was/, 'nothing to announce when nothing was cut');
  assert.match(ctx, /Weekly report goes out on Friday/);
});

// ---- the briefing is two hook commands, not one (0.13.0) --------------------
// The 10,000-character cliff is per hook command, not per session: a 3,321-char
// sibling hook arrived whole beside the truncated one. Splitting the standing
// layers from the computed block gives each half its own budget, so neither is
// ever near the cliff. Delivery order across commands is not guaranteed by
// anything we can read, so each block names itself and the computed one says
// where it belongs.
test('the standing layers and the computed block come from two different hook commands', (t) => {
  const dir = hookWs(t);
  writeDirectives(dir, '- Never mail anyone but the counterparty named here.');

  const standing = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(standing, /JOSERAH-ROLE\.md/);
  assert.match(standing, /## This workspace/);
  assert.match(standing, /Never mail anyone but the counterparty named here/);
  assert.doesNotMatch(standing, /## Right now/, 'the computed block moved out of this command');

  const brief = JSON.parse(runHook('session-brief.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(brief, /## Right now \(computed for this session\)/);
  assert.match(brief, /read last, after the standing layers/,
    'the block says where it belongs, because command order is not guaranteed');
  assert.doesNotMatch(brief, /## This workspace/, 'the standing layers stayed behind');
});

test('session-brief hands back no more than the per-command budget', (t) => {
  const dir = hookWs(t);
  fs.writeFileSync(path.join(dir, '.joserah', 'desk', 'tasks', 'now.md'),
    '# now\n\n' + '- [ ] a task long enough to matter, written out at length.\n'.repeat(400));
  fs.writeFileSync(path.join(dir, '.joserah', 'learned.md'),
    '# learned\n\n' + '## 2026-09-01 a rule\n\nwith a long body, repeated.\n'.repeat(400));
  const r = runHook('session-brief.js', dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.length <= MAX_HOOK_CHARS,
    `session-brief.js produced ${ctx.length} characters; the budget is ${MAX_HOOK_CHARS}`);
});

test('both SessionStart commands are registered, each as its own command string', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const commands = hooks.hooks.SessionStart[0].hooks;
  assert.strictEqual(commands.length, 2, 'one command per half — that is what gives each its own budget');
  const joined = commands.map((c) => c.command).join(' ');
  assert.match(joined, /session-start\.js/);
  assert.match(joined, /session-brief\.js/);
  for (const c of commands) {
    assert.strictEqual(c.type, 'command');
    assert.strictEqual(c.shell, 'bash');
    assert.match(c.command, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\//);
  }
});

// ---- per-layer caps (0.13.0) ------------------------------------------------
const { MAX_LAYER_CHARS } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'standing-context'));

test('no single standing layer may fill a whole hook command on its own', () => {
  assert.ok(MAX_LAYER_CHARS < MAX_HOOK_CHARS,
    'a per-file cap equal to the command budget lets one file starve every other layer');
});

test('the agent overlay is capped and announces its cut, like every other layer', (t) => {
  const dir = hookWs(t);
  fs.writeFileSync(path.join(dir, '.joserah', 'agent.md'),
    '# This assistant\n\n<!-- joserah:agent-overlay-below -->\n' +
    '- Always answer in bullet points.\n' +
    'pasted procedure text that goes on and on.\n'.repeat(400) +
    '\n- OVERLAY-TAIL-MARKER\n');

  const ctx = JSON.parse(runHook('session-start.js', dir).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Always answer in bullet points/, 'the top of the overlay still arrives');
  assert.doesNotMatch(ctx, /OVERLAY-TAIL-MARKER/, 'the tail is past the cap');
  assert.match(ctx, /\[cut\] \.joserah\/agent\.md/, 'the cut is announced, naming the file');
});

// ---- SubagentStart (0.14.0) -------------------------------------------------
// An agent spawned by the Agent tool got none of the standing layers: no name,
// no language, no trust level, no directives. Same script, same workspace read
// — only the envelope's `hookEventName` must be the literal of the FIRING
// event, and the firing event has to be known without reading stdin (a piped
// stdin that never delivers `end` on Windows would hang every spawn).
test('the subagent marker emits SubagentStart with the same standing context', (t) => {
  const dir = hookWs(t);
  const sub = runHook('session-start.js', dir, undefined, undefined, ['subagent']);
  assert.strictEqual(sub.status, 0, sub.stderr);
  const main = runHook('session-start.js', dir);
  assert.strictEqual(main.status, 0, main.stderr);
  assert.strictEqual(JSON.parse(sub.stdout).hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.strictEqual(JSON.parse(main.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.strictEqual(JSON.parse(sub.stdout).hookSpecificOutput.additionalContext,
    JSON.parse(main.stdout).hookSpecificOutput.additionalContext,
    'a subagent gets the same standing layers the main session gets');
});

test('an unknown or absent argument still means SessionStart', (t) => {
  const dir = hookWs(t);
  for (const args of [[], ['SubagentStop'], ['--whatever']]) {
    const r = runHook('session-start.js', dir, undefined, undefined, args);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'SessionStart',
      `argv ${JSON.stringify(args)} must not become an event name`);
  }
});

test('SubagentStart is registered for every subagent, standing layers only', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const entries = hooks.hooks.SubagentStart;
  assert.ok(Array.isArray(entries) && entries.length === 1, 'one SubagentStart entry');
  assert.ok(!('matcher' in entries[0]),
    'no matcher key — an omitted matcher is what means every subagent');
  const commands = entries[0].hooks;
  assert.strictEqual(commands.length, 1);
  assert.strictEqual(commands[0].type, 'command');
  assert.strictEqual(commands[0].shell, 'bash');
  assert.match(commands[0].command, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-start\.js" subagent$/);
  assert.doesNotMatch(commands[0].command, /session-brief\.js/,
    'the per-moment layer is the parent session\'s state, not a subagent\'s');
});
