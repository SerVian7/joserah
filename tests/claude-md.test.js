'use strict';
// 0.13.3: the standing layers reach a session through a plugin-owned CLAUDE.md
// that @-imports them, not through the SessionStart hook. Measured 2026-09-23:
// headless CLI 2.1.251 does not load AGENTS.md at all, does load CLAUDE.md and
// expands its @ imports whole (a 59,928-byte file arrived), while any single
// hook command over 10,000 characters is replaced by a ~2,000-character stub.
// Also measured: started from a SUBFOLDER, the parent CLAUDE.md loads but its
// @ imports do not expand — so the hook stands down only at the workspace root.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT, HERMETIC_CONFIG_DIR } = require('./helpers');
const { CLAUDE_MD, CLAUDE_MD_IMPORTS } = require(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'standing-context'));

function ws(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  fs.writeFileSync(path.join(dir, '.joserah', 'directives.md'),
    '# Directives — w\n\n## Scope\n\n- DIRECTIVE-MARKER never mail anyone.\n');
  return dir;
}
const claudeMd = (dir) => path.join(dir, 'CLAUDE.md');
function standing(cwd, args = []) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'session-start.js'), ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC_CONFIG_DIR } });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}
const migrate = (dir, extra = []) => JSON.parse(runTool('migrate.js', [dir, ...extra]).stdout);
const doctorLine = (dir) => runTool('doctor.js', [dir]).stdout.split('\n')
  .find((l) => /CLAUDE\.md imports the standing layers/.test(l)) || '';

test('the stub imports AGENTS.md, the role file and the directives, workspace-relative', () => {
  assert.deepStrictEqual(CLAUDE_MD_IMPORTS, ['AGENTS.md', 'JOSERAH-ROLE.md', '.joserah/directives.md']);
  for (const rel of CLAUDE_MD_IMPORTS) assert.match(CLAUDE_MD, new RegExp(`^@${rel.replace(/\./g, '\\.')}$`, 'm'));
  assert.doesNotMatch(CLAUDE_MD, /@\.joserah\/agent\.md/,
    'the overlay is only the text below its marker; importing the file would hand over the shipped essay');
});

test('scaffold writes the stub', (t) => {
  const dir = ws(t);
  assert.strictEqual(fs.readFileSync(claudeMd(dir), 'utf8'), CLAUDE_MD);
});

test('scaffold leaves a CLAUDE.md it did not write untouched', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claudeMd(dir), '# my own notes\n');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(claudeMd(dir), 'utf8'), '# my own notes\n');
});

test('migrate installs a missing stub, refreshes a stale one, and is idempotent', (t) => {
  const dir = ws(t);
  fs.rmSync(claudeMd(dir));
  const dry = migrate(dir, ['--dry-run']);
  assert.ok(dry.created.includes('CLAUDE.md'));
  assert.ok(!fs.existsSync(claudeMd(dir)), 'a dry run writes nothing');

  assert.ok(migrate(dir).created.includes('CLAUDE.md'));
  assert.strictEqual(fs.readFileSync(claudeMd(dir), 'utf8'), CLAUDE_MD);
  const again = migrate(dir);
  assert.ok(!again.created.includes('CLAUDE.md') && !again.refreshed.includes('CLAUDE.md'), 'second run changes nothing');

  fs.writeFileSync(claudeMd(dir), CLAUDE_MD.replace('@JOSERAH-ROLE.md\n', ''));
  assert.ok(migrate(dir).refreshed.includes('CLAUDE.md'));
  assert.strictEqual(fs.readFileSync(claudeMd(dir), 'utf8'), CLAUDE_MD);
});

test('migrate never touches, deletes or frontmatters an owner-written CLAUDE.md', (t) => {
  const dir = ws(t);
  fs.writeFileSync(claudeMd(dir), 'see AGENTS.md\n');
  const out = migrate(dir);
  assert.strictEqual(fs.readFileSync(claudeMd(dir), 'utf8'), 'see AGENTS.md\n');
  assert.ok(out.skipped.some((s) => s.file === 'CLAUDE.md'), 'reported, not silent');
  assert.ok(!out.created.includes('CLAUDE.md') && !out.refreshed.includes('CLAUDE.md'));
});

test('at the workspace root the hook leaves the imported layers to CLAUDE.md', (t) => {
  const dir = ws(t);
  for (const args of [[], ['subagent']]) {
    const ctx = standing(dir, args);
    assert.doesNotMatch(ctx, /DIRECTIVE-MARKER/, 'sent once, through CLAUDE.md');
    assert.doesNotMatch(ctx, /\(JOSERAH-ROLE\.md\)/);
    assert.match(ctx, /## This workspace/, 'identity stays in the hook');
  }
});

test('the hook still injects every layer without the stub, or from a subfolder', (t) => {
  const dir = ws(t);
  fs.mkdirSync(path.join(dir, 'projects', 'p'), { recursive: true });
  const sub = standing(path.join(dir, 'projects', 'p'));
  assert.match(sub, /DIRECTIVE-MARKER/, 'a parent CLAUDE.md\'s imports do not expand in a subfolder');
  assert.match(sub, /\(JOSERAH-ROLE\.md\)/);

  fs.rmSync(claudeMd(dir));
  const bare = standing(dir);
  assert.match(bare, /DIRECTIVE-MARKER/);
  assert.match(bare, /\(JOSERAH-ROLE\.md\)/);
});

test('an owner-written CLAUDE.md stands the hook down only for the layers it imports', (t) => {
  const dir = ws(t);
  fs.writeFileSync(claudeMd(dir), '# mine\n\n@.joserah/directives.md\n');
  const ctx = standing(dir);
  assert.doesNotMatch(ctx, /DIRECTIVE-MARKER/);
  assert.match(ctx, /\(JOSERAH-ROLE\.md\)/, 'not imported, so still injected');
});

test('doctor: ok on the stub, FAIL when missing or stale, warn on an owner file that lacks imports', (t) => {
  const dir = ws(t);
  assert.match(doctorLine(dir), /^ok\s/);

  fs.writeFileSync(claudeMd(dir), CLAUDE_MD.replace('@AGENTS.md\n', ''));
  assert.match(doctorLine(dir), /^FAIL\s.*migrate\.js/);

  fs.rmSync(claudeMd(dir));
  assert.match(doctorLine(dir), /^FAIL\s.*missing.*migrate\.js/);

  fs.writeFileSync(claudeMd(dir), '# mine\n');
  const line = doctorLine(dir);
  assert.match(line, /^warn\s/);
  for (const rel of CLAUDE_MD_IMPORTS) assert.ok(line.includes('@' + rel), `names @${rel}`);

  fs.writeFileSync(claudeMd(dir), '# mine\n\n' + CLAUDE_MD_IMPORTS.map((r) => '@' + r).join('\n') + '\n');
  assert.match(doctorLine(dir), /^ok\s/);
});
