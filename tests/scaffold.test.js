'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

test('scaffold creates root keys/AGENTS.md and keys-rooted gitignore', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'keys', 'AGENTS.md')), 'keys/AGENTS.md at root');
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'keys')), 'no legacy keys dir');
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /^keys\/\*$/m);
  assert.match(gi, /^!keys\/AGENTS\.md$/m);
});

test('permission-deny lib exports 9 rules on ./keys/**', () => {
  const { PERMISSION_DENY } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));
  assert.strictEqual(PERMISSION_DENY.length, 9);
  for (const rule of PERMISSION_DENY) assert.match(rule, /\.\/keys\/\*\*/);
});

test('I1: fresh scaffold writes .claude/settings.json with all deny rules', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const { PERMISSION_DENY } = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'permission-deny'));
  assert.deepStrictEqual(s.permissions.deny, PERMISSION_DENY);
});

test('K3: --settings-only on a workspace without .claude/ writes the file, exit 0', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const r = runTool('scaffold.js', ['--settings-only', '--target', dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')));
});

test('M15: config.json with a BOM is still readable by identity-only', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfgPath = path.join(dir, '.joserah', 'config.json');
  fs.writeFileSync(cfgPath, '\uFEFF' + fs.readFileSync(cfgPath, 'utf8'));
  const r = runTool('scaffold.js', ['--identity-only', '--target', dir, '--owner', 'O', '--language', 'en']);
  assert.strictEqual(r.status, 0, r.stderr);
});

// R18: a workspace without its own .gitattributes checks out under whatever
// the owner's global core.autocrlf says. On Windows with autocrlf=true \u2014
// the plugin's own target platform \u2014 git rewrites the checked-out copy of
// .joserah/tools/verify-links.js to CRLF while the plugin's own copy stays
// LF, so doctor's byte-for-byte drift check fails on a file that was never
// actually stale. Shipping this file into every scaffolded workspace stops
// the drift at its source.
test('R18: scaffold writes a workspace .gitattributes forcing LF', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.strictEqual(r.status, 0, r.stderr);
  const ga = fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8');
  assert.match(ga, /eol=lf/);
  assert.match(ga, /\*\.js\s+text eol=lf/);
});

test('R18: scaffold treats an existing workspace .gitattributes as a collision, same as every other file it writes', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitattributes'), 'owner-written rules\n');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.notStrictEqual(r.status, 0, 'refuses rather than silently overwriting');
  assert.match(r.stderr, /\.gitattributes/);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8'), 'owner-written rules\n');
});

test('scaffold creates imports/README.md at the workspace root, and no raw/', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  assert.ok(fs.existsSync(path.join(dir, 'imports', 'README.md')), 'imports/README.md at root');
  assert.ok(!fs.existsSync(path.join(dir, 'raw')), 'no raw/ in a fresh workspace');
  assert.ok(!fs.existsSync(path.join(dir, '.joserah', 'knowledge', 'raw')), 'no legacy knowledge/raw');
});

test('scaffold .gitignore excludes imports/ and .joserah/conversations/ from the repository route', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.match(gi, /^imports\/$/m);
  assert.match(gi, /^\.joserah\/conversations\/$/m);
  assert.doesNotMatch(gi, /^raw\/$/m);
});

test('--root-shell-only restores imports/README.md from the template', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  // simulate a .joserah-only clone: root shell files are gone, imports/
  // included (imports/ is gitignored by construction, so a .joserah-only
  // backup never carried it either)
  fs.rmSync(path.join(dir, 'imports'), { recursive: true });
  for (const f of ['AGENTS.md', 'JOSERAH-ROLE.md', '.gitignore']) fs.rmSync(path.join(dir, f));
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const r = runTool('scaffold.js', ['--root-shell-only', '--target', dir]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const f of ['AGENTS.md', 'JOSERAH-ROLE.md', '.gitignore', path.join('.claude', 'settings.json'),
                   path.join('imports', 'README.md')]) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} regenerated`);
  }
  // AGENTS.md is the template byte-for-byte (modulo EOL):
  const agentsTpl = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
  const agentsGot = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(agentsGot, agentsTpl);
  // imports/README.md is the template too — the explanation of why the folder
  // is empty and outside the backup, not silence:
  const tpl = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'imports', 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const got = fs.readFileSync(path.join(dir, 'imports', 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(got, tpl);
});

test('--root-shell-only never overwrites an existing imports/README.md', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.writeFileSync(path.join(dir, 'imports', 'README.md'), '# owner-edited\n');
  const r = runTool('scaffold.js', ['--root-shell-only', '--target', dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'imports', 'README.md'), 'utf8'), '# owner-edited\n');
  assert.match(r.stdout, /kept imports[\/]README\.md/);
});

test('--root-shell-only never overwrites files that exist', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  fs.writeFileSync(path.join(dir, '.gitignore'), '# owner-edited\n');
  const r = runTool('scaffold.js', ['--root-shell-only', '--target', dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '# owner-edited\n');
  assert.match(r.stdout, /kept \.gitignore/);
});

test('--root-shell-only without a workspace marker exits 1', (t) => {
  const dir = path.join(tmpdir(t), 'empty');
  fs.mkdirSync(dir, { recursive: true });
  const r = runTool('scaffold.js', ['--root-shell-only', '--target', dir]);
  assert.strictEqual(r.status, 1);
});

test('scaffold records the prompt version and sha of the AGENTS.md it installs', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w']);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  const prompt = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'prompt'));
  const installed = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.strictEqual(cfg.promptVersion, prompt.readPromptVersion(installed));
  assert.strictEqual(cfg.promptSha256, prompt.promptSha(installed));
});

test('a fresh scaffold has the five crew definitions, each stamped, and no devMode key', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'A B']);
  assert.strictEqual(r.status, 0, r.stderr);
  const { STAMP } = require(path.join(PLUGIN_ROOT, 'tools', 'crew'));
  for (const role of ['lead', 'architect', 'builder', 'scout', 'sentry']) {
    const f = path.join(dir, '.claude', 'agents', `${role}.md`);
    assert.ok(fs.existsSync(f), `${role}.md written`);
    assert.ok(fs.readFileSync(f, 'utf8').includes(STAMP), `${role}.md stamped`);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.joserah', 'config.json'), 'utf8'));
  assert.ok(!('devMode' in cfg), 'devMode absent means off; never written');
  assert.ok(!('crew' in cfg), 'no crew block needed; defaults apply');
  const d = runTool('doctor.js', [dir]);
  assert.strictEqual(d.status, 0, d.stdout + d.stderr);
});

// Task 6.5: templates/ holds two kinds of thing — what a workspace is made of,
// and what the plugin's own tools read from the plugin root (role supplements,
// the memory kind's tree, page templates, crew role bodies). Only the first
// may land in a workspace. Every top-level entry of templates/ must be named in
// exactly one of these two lists, so a new folder cannot be added without
// deciding which kind it is.
const WORKSPACE_CONTENT = ['.gitattributes', '.joserah', 'AGENTS.md', 'imports', 'keys', 'projects'];
const PLUGIN_SIDE = ['case', 'changelog', 'crew', 'memory', 'roles', 'tracker', 'trail'];

function filesUnder(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, base, acc);
    else acc.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return acc;
}

test('6.5: every top-level entry of templates/ is classified as workspace content or plugin-side', () => {
  const entries = fs.readdirSync(path.join(PLUGIN_ROOT, 'templates')).sort();
  assert.deepStrictEqual(entries, [...WORKSPACE_CONTENT, ...PLUGIN_SIDE].sort());
});

test('6.5: a fresh scaffold has no plugin-side template folder at its root', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'A B']);
  assert.strictEqual(r.status, 0, r.stderr);
  for (const name of PLUGIN_SIDE) {
    assert.ok(!fs.existsSync(path.join(dir, name)), `${name}/ must not be copied into a workspace`);
  }
});

test('6.5: a fresh scaffold still has every workspace-content file and everything written beside it', (t) => {
  const dir = path.join(tmpdir(t), 'ws');
  const r = runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'A B']);
  assert.strictEqual(r.status, 0, r.stderr);
  const tpl = path.join(PLUGIN_ROOT, 'templates');
  for (const name of WORKSPACE_CONTENT) {
    const src = path.join(tpl, name);
    const rels = fs.statSync(src).isDirectory() ? filesUnder(src).map((f) => `${name}/${f}`) : [name];
    for (const rel of rels) assert.ok(fs.existsSync(path.join(dir, rel)), `${rel} copied`);
  }
  for (const rel of ['.joserah/config.json', '.claude/settings.json', '.gitignore', 'CLAUDE.md',
    'JOSERAH-ROLE.md', '.joserah/tools/verify-links.js', '.joserah/tools/lib/untouchable.js',
    '.joserah/tools/secret.js', '.joserah/tools/lib/vault-dialog.js', 'keys/secrets.json']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `${rel} written`);
  }
  const d = runTool('doctor.js', [dir]);
  assert.strictEqual(d.status, 0, d.stdout + d.stderr);
});
