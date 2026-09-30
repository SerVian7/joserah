'use strict';
// 0.15.8 (owner via ctrl, 2026-09-30): a module repo got 20+ commits in 13 hours while its
// page in the shared memory stayed at the first one. A commit inside projects/ now says
// which records to update, and the memory reports the pages that fell behind their repo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT, HERMETIC_CONFIG_DIR } = require('./helpers');

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function repo(dir, origin, subject = 'first') {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(dir, 'a.txt'), crypto.randomUUID());
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', subject);
  return git(dir, 'rev-parse', '--short', 'HEAD');
}
function commit(dir, subject) {
  fs.writeFileSync(path.join(dir, 'a.txt'), crypto.randomUUID());
  git(dir, 'commit', '-qam', subject);
  return git(dir, 'rev-parse', '--short', 'HEAD');
}
function workspace(t) {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  return dir;
}
function memory(t, target) {
  const r = runTool('scaffold.js', ['--kind', 'memory', '--company', 'Acme', '--members', 'ada,bora',
    '--sweeper', 'ada', '--language', 'English', '--target', target], { env: GIT_ENV });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  return target;
}
const page = (repoUrl, hash) => `---\nrepo: ${repoUrl}\n---\n# X module\n\n${hash ? `Last change: ${hash} · 2026-09-30 02:13 +0300 · first\n` : ''}`;
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const drift = (mem) => spawnSync(process.execPath, [path.join(mem, 'tools', 'project-drift.js')], { encoding: 'utf8' });
function hook(ws, command, session = 'once-' + crypto.randomUUID()) {
  return spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'post-tool-use.js')], {
    cwd: ws, encoding: 'utf8', input: JSON.stringify({ session_id: session, tool_name: 'Bash', tool_input: { command }, cwd: ws }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC_CONFIG_DIR, CLAUDE_PLUGIN_ROOT: '' } });
}
const ctx = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '');

// ---- the memory's drift report ----------------------------------------------------

test('drift: normaliseRepo gives one form for https, ssh and .git spellings', () => {
  const { normaliseRepo } = require(path.join(PLUGIN_ROOT, 'templates', 'memory', 'tools', 'project-drift.js'));
  for (const u of ['git@GitHub.com:Zenger/zcm-peplink.git', 'https://GITHUB.com/Zenger/zcm-peplink.git/',
    'ssh://git@github.com/Zenger/zcm-peplink', 'https://user@github.com/Zenger/zcm-peplink']) {
    assert.strictEqual(normaliseRepo(u), 'https://github.com/Zenger/zcm-peplink', u);
  }
});

test('drift: current page, page behind, page without Last change, no repos.json', (t) => {
  const base = tmpdir(t);
  const mem = memory(t, path.join(base, 'acme'));
  const r1 = path.join(base, 'r1'), r2 = path.join(base, 'r2'), r3 = path.join(base, 'r3');
  const h1 = repo(r1, 'git@github.com:acme/one.git');
  const old2 = repo(r2, 'https://github.com/acme/two');
  repo(r3, 'https://github.com/acme/three.git');
  write(path.join(mem, 'knowledge', 'modules', 'one.md'), page('https://github.com/acme/one', h1));
  assert.match(drift(mem).stdout, /^projects: no local checkouts mapped$/m);

  write(path.join(mem, '.memory', 'repos.json'), JSON.stringify({ 'https://github.com/acme/one': r1 }));
  const cur = drift(mem);
  assert.strictEqual(cur.status, 0);
  assert.match(cur.stdout, /^projects: all current$/m);

  write(path.join(mem, 'knowledge', 'modules', 'two.md'), page('https://github.com/acme/two', old2));
  write(path.join(mem, 'knowledge', 'three.md'), page('git@github.com:acme/three.git', null));
  write(path.join(mem, '.memory', 'repos.json'), JSON.stringify({
    'https://github.com/acme/one': r1, 'https://github.com/acme/two': r2, 'https://github.com/acme/three': r3 }));
  const new2 = commit(r2, 'second');
  const behind = drift(mem);
  assert.strictEqual(behind.status, 0, 'a report, never a failure');
  assert.match(behind.stdout, /^projects: 2 behind — /m);
  assert.match(behind.stdout, new RegExp(`two \\(page ${old2}, repo ${new2}\\)`));
  assert.match(behind.stdout, /three \(page none, repo [0-9a-f]{7,}\)/);
  assert.doesNotMatch(behind.stdout, /one \(/);
  assert.ok(fs.readFileSync(path.join(mem, '.gitignore'), 'utf8').includes('.memory/repos.json'), 'the local map never travels');
});

test('drift: sync pull prints the projects line after the checks', (t) => {
  const base = tmpdir(t);
  const mem = memory(t, path.join(base, 'acme'));
  write(path.join(mem, 'knowledge', 'one.md'), page('https://github.com/acme/one', 'abc1234'));
  const r = spawnSync(process.execPath, [path.join(mem, 'tools', 'sync.js')], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^checks: .*\r?\nprojects: no local checkouts mapped\r?$/m);
});

// ---- doctor maps checkouts and reports drift -----------------------------------------

test('doctor: maps projects/ checkouts into .memory/repos.json and warns on a page behind', (t) => {
  const ws = workspace(t);
  const mem = memory(t, path.join(ws, '.joserah', 'shared', 'acme'));
  const proj = path.join(ws, 'projects', 'Acme', 'one');
  const old = repo(proj, 'git@github.com:acme/one.git');
  write(path.join(mem, 'knowledge', 'modules', 'one-integration.md'), page('https://github.com/acme/one', old));
  git(mem, 'add', '-A');
  git(mem, 'commit', '-qm', 'ada: page');
  const ok = runTool('doctor.js', [ws]);
  const map = JSON.parse(fs.readFileSync(path.join(mem, '.memory', 'repos.json'), 'utf8'));
  assert.strictEqual(path.resolve(map['https://github.com/acme/one']), path.resolve(proj));
  assert.match(ok.stdout, /ok\s+project pages in acme\s+— projects: all current/);
  assert.strictEqual(git(mem, 'status', '--porcelain'), '', 'repos.json stays out of the memory\'s commits');
  const neu = commit(proj, 'second');
  const warn = runTool('doctor.js', [ws]);
  assert.match(warn.stdout, new RegExp(`warn\\s+project pages in acme\\s+— projects: 1 behind — one-integration \\(page ${old}, repo ${neu}\\)`));
});

// ---- the hook ------------------------------------------------------------------------

test('hook: a commit inside projects/<x> emits the [project] line once per HEAD, with the memory page when repo: matches', (t) => {
  const ws = workspace(t);
  const proj = path.join(ws, 'projects', 'Acme', 'one');
  const h = repo(proj, 'git@github.com:acme/one.git', 'wire the uplink');
  const mem = path.join(ws, '.joserah', 'shared', 'acme');
  write(path.join(mem, 'knowledge', 'modules', 'one-integration.md'), page('https://github.com/acme/one', 'abc1234'));
  const cfgPath = path.join(ws, '.joserah', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.shared = [{ name: 'acme', path: '.joserah/shared/acme' }];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const session = 'fixed-' + crypto.randomUUID();
  const first = hook(ws, `cd "${proj}" && git commit -m "wire the uplink"`, session);
  assert.strictEqual(first.status, 0, first.stderr);
  const line = ctx(first);
  assert.match(line, new RegExp(`^\\[project\\] one — HEAD ${h} "wire the uplink"\\. Update its record: docs/status\\.md "Last change: ${h} · \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} [+-]\\d{4} · wire the uplink"`));
  assert.match(line, /shared memory acme: knowledge\/modules\/one-integration\.md \(via inbox note unless you are the sweeper\)/);
  assert.strictEqual(hook(ws, `git -C "${proj}" push`, session).stdout, '', 'the same HEAD never nags twice');
  const h2 = commit(proj, 'second');
  assert.match(ctx(hook(ws, `git -C "${proj}" commit -am second`, session)), new RegExp(`HEAD ${h2} "second"`));
});

test('hook: silent outside projects/ and for a non-git command; no memory part without a matching page', (t) => {
  const ws = workspace(t);
  const other = path.join(ws, 'elsewhere');
  repo(other, 'https://github.com/acme/other');
  assert.strictEqual(hook(ws, `cd "${other}" && git commit -m x`).stdout, '');
  const proj = path.join(ws, 'projects', 'Acme', 'two');
  repo(proj, 'https://github.com/acme/two');
  assert.strictEqual(hook(ws, `cd "${proj}" && git status`).stdout, '');
  const line = ctx(hook(ws, `cd "${proj}" && git push`));
  assert.match(line, /^\[project\] two — HEAD/);
  assert.doesNotMatch(line, /shared memory/);
});

test('hook: a commit that only touches the record files is silent; with src alongside it speaks', (t) => {
  const ws = workspace(t);
  const proj = path.join(ws, 'projects', 'Acme', 'three');
  repo(proj, 'https://github.com/acme/three');
  write(path.join(proj, 'docs', 'status.md'), 'x');
  git(proj, 'add', '-A');
  git(proj, 'commit', '-qm', 'record only');
  assert.strictEqual(hook(ws, `cd "${proj}" && git commit -m "record only"`).stdout, '', 'the record does not ask to record itself');
  write(path.join(proj, 'docs', 'status.md'), 'y');
  write(path.join(proj, 'src', 'a.js'), 'z');
  git(proj, 'add', '-A');
  git(proj, 'commit', '-qm', 'code and record');
  assert.match(ctx(hook(ws, `cd "${proj}" && git commit -m "code and record"`)), /^\[project\] three — HEAD/);
});
