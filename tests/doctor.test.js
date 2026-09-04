'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT, tmpdir, runTool, fakeMarketplace } = require('./helpers');
const nf = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'note-format'));

function freshWs(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}

test('doctor passes a fresh scaffold', (t) => {
  const r = runTool('doctor.js', [freshWs(t)]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  // A passing check must not read like an active problem report: the legacy-
  // keys line on a healthy workspace carries no detail text at all.
  assert.match(r.stdout, /^ok\s+no legacy \.joserah\/keys directory\s*$/m);
});

test('placeholder scan ignores {{...}} inside fenced/inline code but still catches a bare one', (t) => {
  const dir = freshWs(t);
  const p = path.join(dir, '.joserah', 'desk', 'discusses-templating.md');
  fs.writeFileSync(p, [
    'This doc legitimately discusses the templating mechanism:',
    '```js',
    "'{{OWNER_NAME}}': owner,",
    '```',
    'and inline `{{OWNER_ROLE_LINE}}` in prose.',
    '',
  ].join('\n'));
  const safe = runTool('doctor.js', [dir]);
  assert.strictEqual(safe.status, 0, safe.stdout + safe.stderr);

  fs.appendFileSync(p, '\nA bare {{UNFILLED}} outside any code block.\n');
  const bare = runTool('doctor.js', [dir]);
  assert.strictEqual(bare.status, 1);
  assert.match(bare.stdout, /no unfilled \{\{placeholders\}\}.*1 file/i);
});

test('I14: doctor fails when a legacy .joserah/keys directory exists', (t) => {
  const dir = freshWs(t);
  fs.mkdirSync(path.join(dir, '.joserah', 'keys'), { recursive: true });
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /legacy/i);
});

test('G1: doctor fails when the local verify-links copy has drifted', (t) => {
  const dir = freshWs(t);
  fs.appendFileSync(path.join(dir, '.joserah', 'tools', 'verify-links.js'), '\n// drifted\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /verify-links\.js/);
});

// R18: a workspace without its own .gitattributes checks out under whatever
// the owner's global core.autocrlf says — on Windows with autocrlf=true (the
// plugin's own target platform) git rewrites the checked-out copy to CRLF
// while the plugin's copy on disk stays LF, so a freshly re-copied file
// still differs byte-for-byte. That is a checkout artifact, not evidence of
// a stale copy, so it must not fail this check.
test('R18: doctor does not fail when the local verify-links copy differs only by CRLF line endings', (t) => {
  const dir = freshWs(t);
  const localPath = path.join(dir, '.joserah', 'tools', 'verify-links.js');
  const crlf = fs.readFileSync(localPath, 'utf8').replace(/\n/g, '\r\n');
  fs.writeFileSync(localPath, crlf, 'utf8');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok\s+local verify-links\.js current/);
});

// A CRLF-normalised file that ALSO carries genuinely different content must
// still fail — normalising line endings must not blind the check to real
// drift, only to the checkout convention.
test('R18: doctor still fails on genuine drift even when the drifted copy is CRLF', (t) => {
  const dir = freshWs(t);
  const localPath = path.join(dir, '.joserah', 'tools', 'verify-links.js');
  const crlfDrifted = fs.readFileSync(localPath, 'utf8').replace(/\n/g, '\r\n') + '\r\n// drifted\r\n';
  fs.writeFileSync(localPath, crlfDrifted, 'utf8');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /verify-links\.js/);
});

// R20: the same autocrlf cause R18 diagnosed for verify-links.js applies
// here too — a workspace with no .gitattributes checks out JOSERAH-ROLE.md
// as CRLF on Windows with autocrlf=true while the plugin's role template on
// disk stays LF, so this byte-for-byte comparison must be normalised the
// same way, or every such workspace fails a check whose content is actually
// identical.
test('R20: doctor does not fail when JOSERAH-ROLE.md differs from its role template only by CRLF line endings', (t) => {
  const dir = freshWs(t);
  const rolePath = path.join(dir, 'JOSERAH-ROLE.md');
  const crlf = fs.readFileSync(rolePath, 'utf8').replace(/\n/g, '\r\n');
  fs.writeFileSync(rolePath, crlf, 'utf8');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok\s+exists: JOSERAH-ROLE\.md/);
});

// The check exists to catch exactly this: a workspace scaffolded under one
// role whose `kind` was changed afterwards without re-scaffolding. That must
// still fail even once the comparison is CRLF-tolerant — normalising line
// endings must not blind the check to a genuinely different role file.
test('R20: doctor still fails when JOSERAH-ROLE.md genuinely does not match its role template', (t) => {
  const dir = freshWs(t);
  const rolePath = path.join(dir, 'JOSERAH-ROLE.md');
  fs.appendFileSync(rolePath, '\nHand-edited after scaffolding.\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /does not match the "client" role template/);
});

test('I3: doctor fails when the deny set is a subset', (t) => {
  const dir = freshWs(t);
  const sPath = path.join(dir, '.claude', 'settings.json');
  const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
  s.permissions.deny = s.permissions.deny.slice(0, 3);
  fs.writeFileSync(sPath, JSON.stringify(s, null, 2));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /missing \d+ rule.*deny set/i);
});

test('I-K3: a 0.3.0-created workspace with .claude/ removed fails doctor', (t) => {
  const dir = freshWs(t);
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL\s+\.claude\/settings\.json \(absent\).*0\.3\.0/);
});

test('I-K3: a workspace recorded as created by an older plugin version still passes with .claude/ removed', (t) => {
  const dir = freshWs(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.createdByPluginVersion = '0.2.0';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok\s+\.claude\/settings\.json \(absent\)/);
});

test('M3: a missing local checker is named, not reported as broken links', (t) => {
  const dir = freshWs(t);
  fs.rmSync(path.join(dir, '.joserah', 'tools', 'verify-links.js'));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /local verify-links\.js current.*missing/i);
  assert.match(r.stdout, /ok\s+internal links resolve/);
});

test('doctor fails when a guest workspace carries only the owner deny set', (t) => {
  const path2 = require('path');
  const fs2 = require('fs');
  const dir = path2.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path2.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs2.readFileSync(cfgPath, 'utf8'));
  cfg.trust = 'guest';
  fs2.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = runTool('doctor.js', [dir]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /deny set/i);
});

// R11: the session-start hook injects only text below the overlay marker in
// .joserah/agent.md — a hand-edit that loses the marker is a silent no-op
// forever, and no other check would ever notice since the file is still
// present. Non-fatal: an owner's hand-edit is their call, not a doctor
// failure, so this must never turn `doctor` exit 1.
test('R11: doctor flags a missing overlay marker in agent.md without failing', (t) => {
  const dir = freshWs(t);
  const p = path.join(dir, '.joserah', 'agent.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('<!-- joserah:agent-overlay-below -->', ''));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok\s+agent\.md overlay marker present.*missing/i);
});

// A passing check must not read like an active problem report (same
// discipline as the legacy-keys check above): a healthy workspace's line
// carries no detail text at all.
test('R11: a healthy agent.md overlay marker line carries no problem-sounding text', (t) => {
  const r = runTool('doctor.js', [freshWs(t)]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok\s+agent\.md overlay marker present\s*$/m);
});

// Step 4 of task 19: an informational line, never a failure, so an owner
// sees at a glance whether anything is waiting on feedback.js --report.
test('doctor prints nothing about feedback when the workspace has no feedback notes', (t) => {
  const r = runTool('doctor.js', [freshWs(t)]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /feedback/i);
});

test('doctor counts unreported feedback notes per area, without failing', (t) => {
  const dir = freshWs(t);
  const GOOD = {
    area: 'prompt', created: '2026-08-30',
    symptom: 'The assistant restated a rule it had already been given, twice in one session.',
    cause: 'The rule is injected in two layers and neither knows the other ran.',
    suggestion: 'Inject the layer once and let the later layer reference it.',
  };
  const promptDir = path.join(dir, '.joserah', 'feedback', 'prompt');
  fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(path.join(promptDir, 'a.md'), nf.renderFeedbackNote(GOOD, []));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /prompt.*1/i);
});

test('doctor reports a workspace still on an older format version', (t) => {
  const path2 = require('path');
  const fs2 = require('fs');
  const dir = path2.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path2.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs2.readFileSync(cfgPath, 'utf8'));
  delete cfg.formatVersion;
  fs2.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = runTool('doctor.js', [dir]);
  assert.match(r.stdout, /format version/i);
  assert.match(r.stdout, /migrate/i);
});

// --- IMPORTANT 6 -----------------------------------------------------------
// doctor's remedy for a missing JOSERAH-ROLE.md was a scaffold.js command
// that cannot run as printed on an existing workspace — and forcing it past
// that refusal makes copyTree overwrite .joserah/directives.md and
// .joserah/learned.md wholesale, the owner's own standing rules. Migration is
// the installer for this file; every remedy must say so.

function detailLine(stdout, name) {
  const line = stdout.split('\n').find((l) => l.includes(name));
  assert.ok(line, 'no check line named ' + name);
  return line;
}

test('IMPORTANT 6: a missing JOSERAH-ROLE.md sends an agent to migrate.js, never scaffold.js', (t) => {
  const dir = freshWs(t);
  fs.rmSync(path.join(dir, 'JOSERAH-ROLE.md'));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout);
  const line = detailLine(r.stdout, 'exists: JOSERAH-ROLE.md');
  assert.match(line, /migrate\.js/);
  assert.doesNotMatch(line, /scaffold\.js/, 'never a command that overwrites directives.md');
});

test('IMPORTANT 6: a drifted JOSERAH-ROLE.md names a remedy too', (t) => {
  const dir = freshWs(t);
  fs.appendFileSync(path.join(dir, 'JOSERAH-ROLE.md'), '\nhand-edited\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout);
  const line = detailLine(r.stdout, 'exists: JOSERAH-ROLE.md');
  assert.match(line, /migrate\.js/);
  assert.doesNotMatch(line, /scaffold\.js/);
});

test('IMPORTANT 6: a missing .joserah/agent.md carries a remedy at all', (t) => {
  const dir = freshWs(t);
  fs.rmSync(path.join(dir, '.joserah', 'agent.md'));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(detailLine(r.stdout, 'exists: .joserah/agent.md'), /migrate\.js/);
});

// A corrupted trust value made denyFor throw inside the settings block's JSON
// try, so a trust misconfiguration was reported as "present but not valid
// JSON" — pointing the owner at the wrong file entirely.
test('a corrupted trust value is reported as a trust problem, not as invalid JSON', (t) => {
  const dir = freshWs(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.trust = 'sandboxed';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+trust level.*sandboxed/);
  assert.doesNotMatch(r.stdout, /not valid JSON/,
    'the settings file parses fine; the trust level is what is broken');
});

// The trust check read `cfg ? cfg.trust : undefined`, so an unparsable
// config.json — which yields a null cfg, `kind` included — printed
// `not recorded — a "home" workspace is its owner's own`. The overall exit was
// still 1, so nothing was certified green, but the line made a claim the file
// cannot support.
test('an unparsable config.json is not reported as a home workspace with no trust key', (t) => {
  const dir = freshWs(t);
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{ not json at all');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(detailLine(r.stdout, 'trust level'), /could not be read or parsed/);
  assert.ok(!r.stdout.includes('a "home" workspace is its owner'),
    'never claims a kind it could not read');
});

test('doctor summary reports a warning count so a "warn" line is never silently skipped by a reader told to skim past passing checks', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.mkdirSync(path.join(dir, '.joserah', 'knowledge', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'knowledge', 'raw', 'old.pdf'), 'x');
  fs.mkdirSync(path.join(dir, 'projects', 'Own', 'orphan'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'Own', 'orphan', 'work.md'), 'unsaved work\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /All checks passed\.\s*2 warning\(s\)\.\s*$/);
});

test('doctor summary carries no warning count when nothing warned', (t) => {
  const r = runTool('doctor.js', [freshWs(t)]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /All checks passed\.\s*$/);
  assert.ok(!/warning\(s\)/.test(r.stdout));
});

test('doctor warns about the legacy knowledge/raw location, exit stays 0', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.mkdirSync(path.join(dir, '.joserah', 'knowledge', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'knowledge', 'raw', 'old.pdf'), 'x');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /^warn {2}.*legacy .*knowledge\/raw/m);
  assert.match(r.stdout, /relocate-raw/, 'points at the migration tool');
});

test('doctor warns when a project directory has no repository of its own', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.mkdirSync(path.join(dir, 'projects', 'Own', 'orphan'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'Own', 'orphan', 'work.md'), 'unsaved work\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /^warn {2}.*projects\/Own\/orphan.*no repository/m);
});

test('doctor does not claim a remote for a non-repo subdir inside a repo workspace', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const g = (a) => require('child_process').spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  if (g(['--version']).status !== 0) return t.skip('git unavailable');
  g(['init']); g(['remote', 'add', 'origin', 'https://example.invalid/parent.git']);
  fs.mkdirSync(path.join(dir, 'projects', 'Own', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'Own', 'sub', 'w.md'), 'x\n');
  const r = runTool('doctor.js', [dir]);
  // the parent's remote must NOT be reported as the subproject's:
  assert.ok(!/sub.*parent\.git/.test(r.stdout), 'parent remote never attributed to the subdir');
  assert.match(r.stdout, /^warn {2}.*projects\/Own\/sub.*no repository/m);
});

// A repo can sit directly at projects/<Name> with no Owner/Project split.
// Its own .git-containing working tree must be audited as itself, never by
// walking into its subdirectories (`.git`, `docs/`, ...) as if they were
// separate unbacked projects — that would both miss the real project's
// warning and print false "no repository of its own" claims about content
// that is in fact versioned one directory up (Important 1 from review).
test('a project that is itself a repo directly under projects/ is audited as itself, not via its internals', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const g = (cwd, a) => require('child_process').spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  if (g(dir, ['--version']).status !== 0) return t.skip('git unavailable');
  const projDir = path.join(dir, 'projects', 'Zenger-SDWAN');
  fs.mkdirSync(path.join(projDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(projDir, 'docs', 'notes.md'), 'x\n');
  g(projDir, ['init']);
  g(projDir, ['config', 'user.email', 'a@b.c']);
  g(projDir, ['config', 'user.name', 'a']);
  g(projDir, ['add', '.']);
  g(projDir, ['commit', '-m', 'init']);
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /^warn {2}.*projects\/Zenger-SDWAN\s+—.*no remote/m,
    'the project itself is audited and reported for having no remote');
  assert.ok(!/projects\/Zenger-SDWAN\/\.git/.test(r.stdout), 'never audits the repo\'s own .git directory');
  assert.ok(!/projects\/Zenger-SDWAN\/docs/.test(r.stdout), 'never audits the repo\'s own subfolders as separate projects');
});

test('doctor warns when a project repo has no remote at all', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const g = (cwd, a) => require('child_process').spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  if (g(dir, ['--version']).status !== 0) return t.skip('git unavailable');
  const projDir = path.join(dir, 'projects', 'Own', 'noremote');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'w.md'), 'x\n');
  g(projDir, ['init']);
  g(projDir, ['config', 'user.email', 'a@b.c']);
  g(projDir, ['config', 'user.name', 'a']);
  g(projDir, ['add', '.']);
  g(projDir, ['commit', '-m', 'init']);
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /^warn {2}.*projects\/Own\/noremote\s+—.*no remote.*only on this machine/m);
});

test('doctor warns about unpushed commits when a project repo has a remote', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const g = (cwd, a) => require('child_process').spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  if (g(dir, ['--version']).status !== 0) return t.skip('git unavailable');
  const projDir = path.join(dir, 'projects', 'Own', 'ahead');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'w.md'), 'x\n');
  g(projDir, ['init']);
  g(projDir, ['config', 'user.email', 'a@b.c']);
  g(projDir, ['config', 'user.name', 'a']);
  g(projDir, ['add', '.']);
  g(projDir, ['commit', '-m', 'init']);
  g(projDir, ['remote', 'add', 'origin', 'https://example.invalid/ahead.git']);
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout,
    /^warn {2}.*projects\/Own\/ahead\s+—.*1 commit\(s\) not pushed to https:\/\/example\.invalid\/ahead\.git/m);
});

// git normalises the drive letter it prints on Windows regardless of how it
// was invoked, but path.resolve() preserves whatever case it was given — and
// the workspace root here comes from an uncanonicalised argv/cwd. A genuine
// repo with a remote must not be reported as "no repository of its own" just
// because the path doctor was invoked with happens to carry a lowercase
// drive letter (Important 2 from review; this environment's own cwd is
// lowercase, so this is not a hypothetical).
test('a lowercase drive letter in the workspace path does not misreport a genuine repo as unbacked', (t) => {
  if (process.platform !== 'win32') return t.skip('drive-letter casing only applies on Windows');
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const g = (cwd, a) => require('child_process').spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  if (g(dir, ['--version']).status !== 0) return t.skip('git unavailable');
  const projDir = path.join(dir, 'projects', 'Own', 'proj');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'w.md'), 'x\n');
  g(projDir, ['init']);
  g(projDir, ['config', 'user.email', 'a@b.c']);
  g(projDir, ['config', 'user.name', 'a']);
  g(projDir, ['add', '.']);
  g(projDir, ['commit', '-m', 'init']);
  g(projDir, ['remote', 'add', 'origin', 'https://example.invalid/proj.git']);
  const lowerDir = dir.charAt(0).toLowerCase() + dir.slice(1);
  const r = runTool('doctor.js', [lowerDir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(!/no repository of its own/.test(r.stdout),
    'a genuine repo with a remote must not be reported as unbacked due to drive-letter case alone');
});

test('doctor fails when .joserah/directives.md is missing and points at migrate', (t) => {
  const dir = freshWs(t);
  fs.unlinkSync(path.join(dir, '.joserah', 'directives.md'));
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL\s+exists: \.joserah\/directives\.md\s+— missing — run: node tools\/migrate\.js/);
});

test('doctor reports a current prompt with its version and source', (t) => {
  const r = runTool('doctor.js', [freshWs(t)]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /^ok\s+prompt \(AGENTS\.md\) current\s+— v\d+ \(plugin\)/m);
});

test('doctor fails a hand-edited AGENTS.md and does not call it behind', (t) => {
  const dir = freshWs(t);
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nmy own rule\n');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL\s+prompt \(AGENTS\.md\) current\s+— hand-edited/);
  assert.match(r.stdout, /directives\.md/);
  assert.match(r.stdout, /refresh-prompt\.js .*--force/);
});

test('doctor fails a pristine AGENTS.md when the marketplace clone carries a newer prompt', (t) => {
  const dir = freshWs(t);
  const r = runTool('doctor.js', [dir], { env: { CLAUDE_CONFIG_DIR: fakeMarketplace(t, 42) } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAIL\s+prompt \(AGENTS\.md\) current\s+— v\d+, marketplace clone has v42 — run: node tools\/refresh-prompt\.js/);
  assert.doesNotMatch(r.stdout, /--force/);
});

test('doctor fails an unrecorded AGENTS.md that differs, and only warns about one that matches', (t) => {
  const dir = freshWs(t);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  delete cfg.promptVersion; delete cfg.promptSha256;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  const matching = runTool('doctor.js', [dir]);
  assert.strictEqual(matching.status, 0, matching.stdout);
  assert.match(matching.stdout, /^warn\s+prompt \(AGENTS\.md\) current\s+— matches v\d+ but nothing recorded it/m);

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md — Core AI Folder\n\nold generation\n');
  const differs = runTool('doctor.js', [dir]);
  assert.strictEqual(differs.status, 1);
  assert.match(differs.stdout, /FAIL\s+prompt \(AGENTS\.md\) current\s+— no install record and differs/);
});

test('doctor warns when the source differs at the same prompt version (version not bumped)', (t) => {
  const dir = freshWs(t);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  const configDir = fakeMarketplace(t, cfg.promptVersion, (text) => text + '\nan edit without a bump\n');
  const r = runTool('doctor.js', [dir], { env: { CLAUDE_CONFIG_DIR: configDir } });
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /^warn\s+prompt source drift\s+— marketplace clone v\d+ differs from the installed v\d+ without a version bump/m);
});
