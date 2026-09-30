'use strict';
// 0.15.3: the memory's own tools work with Node and git alone (no Joserah), check on pull,
// detect only real members, and a Joserah member's refresh carries template updates.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT } = require('./helpers');

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const node = (cwd, script, args = []) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
function memory(t) {
  const dir = path.join(tmpdir(t), 'acme-memory');
  const r = runTool('scaffold.js', ['--kind', 'memory', '--company', 'Acme', '--members', 'Ada,bora',
    '--sweeper', 'ada', '--language', 'English', '--target', dir], { env: GIT_ENV });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  return dir;
}
const tool = (dir, n) => path.join(dir, 'tools', n);
const CLAIM = '- [decision] Bought a switch -> 24 ports\n  date: 2026-09-30 · by: ada\n';

test('tools: a fresh memory carries only its own tools/lib and its tools require nothing outside tools/', (t) => {
  const dir = memory(t);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'tools', 'lib')), ['secret.js']);
  assert.ok(!/tools.lib/.test(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')));
  for (const f of ['claims.js', 'detect-member.js', 'sweep-due.js', 'sync.js', 'verify-links.js', 'lib/secret.js']) {
    const reqs = [...fs.readFileSync(path.join(dir, 'tools', f), 'utf8').replace(/^\s*\*.*$/gm, '').matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    for (const r of reqs) assert.ok(!r.startsWith('.') || /^\.\/[\w-]+$/.test(r), `${f} requires ${r}`);
  }
});

test('tools: verify-links finds a broken link', (t) => {
  const dir = memory(t);
  fs.writeFileSync(path.join(dir, 'knowledge', 'a.md'), '# A\n[gone](missing.md) [ok](index.md)\n');
  const r = node(dir, tool(dir, 'verify-links.js'));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /knowledge\/a\.md:2 -> missing\.md/);
});

test('tools: claims flags a malformed claim, counts, and --count counts given files', (t) => {
  const dir = memory(t);
  fs.writeFileSync(path.join(dir, 'knowledge', 'ok.md'), `# Ok\n\n${CLAIM}`);
  const ok = node(dir, tool(dir, 'claims.js'));
  assert.strictEqual(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /claims: 1 ok/);
  fs.writeFileSync(path.join(dir, 'inbox', 'n.md'), '# N\n\n- [measurement] Uplink -> 90 Mbps\n\n' + CLAIM + '\n' + CLAIM);
  const bad = node(dir, tool(dir, 'claims.js'));
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /claims: 1 error\(s\)/);
  assert.match(bad.stdout, /inbox\/n\.md:3 a measurement carries its condition/);
  const c = node(dir, tool(dir, 'claims.js'), ['--count', path.join(dir, 'inbox', 'n.md'), path.join(dir, 'knowledge', 'ok.md')]);
  assert.strictEqual(c.stdout.trim(), '4');
});

test('tools: sync pull prints the checks line and never fails because of them', (t) => {
  const dir = memory(t);
  let r = node(dir, tool(dir, 'sync.js'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /no remote to pull from/);
  assert.match(r.stdout, /checks: links ok, claims 0 ok/);
  fs.writeFileSync(path.join(dir, 'knowledge', 'a.md'), '# A\n[gone](missing.md)\n\n- [measurement] X -> 1\n');
  r = node(dir, tool(dir, 'sync.js'));
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /checks: 1 broken link\(s\), 1 claim error\(s\) — node tools\/verify-links\.js \/ node tools\/claims\.js/);
});

test('tools: sweep-due by inbox count (5) or by days (7, with something waiting)', (t) => {
  const dir = memory(t);
  const inbox = (n) => { for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, 'inbox', `n${i}.md`), '# n\n'); };
  const cfgPath = path.join(dir, '.memory', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.lastSweep = new Date().toISOString();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  inbox(4);
  assert.strictEqual(node(dir, tool(dir, 'sweep-due.js')).stdout.trim(), '', '4 files, swept today');
  inbox(6);
  assert.match(node(dir, tool(dir, 'sweep-due.js')).stdout, /^sweep due: 6 inbox files/);
  fs.rmSync(path.join(dir, 'inbox'), { recursive: true }); fs.mkdirSync(path.join(dir, 'inbox'));
  inbox(1);
  cfg.lastSweep = new Date(Date.now() - 9 * 86400000).toISOString();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  assert.match(node(dir, tool(dir, 'sweep-due.js')).stdout, /^sweep due: 9 days/);
});

test('tools: detect-member rejects a name that is not one of the members', (t) => {
  const dir = memory(t);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Zed Zenger']);
  const r = node(dir, tool(dir, 'detect-member.js'));
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /member 'zed' is not in this memory's members \(ada, bora\); write \.memory\/me/);
  fs.writeFileSync(path.join(dir, '.memory', 'me'), 'Bora\n');
  assert.strictEqual(node(dir, tool(dir, 'detect-member.js')).stdout.trim(), 'bora');
});

test('refresh: an outdated tool and AGENTS.md are renewed, member data is left, a second run says nothing', (t) => {
  const dir = memory(t);
  fs.writeFileSync(path.join(dir, 'tools', 'sweep-due.js'), '// old\n');
  fs.rmSync(path.join(dir, 'tools', 'claims.js'));
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nstale line\n');
  fs.writeFileSync(path.join(dir, '.memory', 'me'), 'ada\n');
  fs.writeFileSync(path.join(dir, 'knowledge', 'k.md'), '# K\nmine\n');
  const first = runTool('scaffold.js', ['--refresh-memory', dir]);
  assert.strictEqual(first.status, 0, first.stderr);
  for (const f of ['AGENTS.md', 'tools/sweep-due.js', 'tools/claims.js']) assert.match(first.stdout, new RegExp(f.replace('.', '\.')));
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(!agents.includes('stale line') && agents.includes('Acme') && !/{{[A-Z]+}}/.test(agents));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'knowledge', 'k.md'), 'utf8'), '# K\nmine\n');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.memory', 'me'), 'utf8'), 'ada\n');
  assert.match(runTool('scaffold.js', ['--refresh-memory', dir]).stdout, /up to date/);
});

test('refresh: doctor names the fix for a drifted memory tool', (t) => {
  const dir = memory(t);
  fs.appendFileSync(path.join(dir, 'tools', 'sync.js'), '\n// edited\n');
  assert.match(runTool('doctor.js', [dir]).stdout, /--refresh-memory/);
});

const getSecretIn = (dir, env, input) => spawnSync(process.execPath, ['-e',
  "require(process.argv[1]).getSecret('T_ENV', 'acme.t.pw').then((v) => process.stdout.write('got:' + v), (e) => { process.stderr.write(e.message); process.exit(1); })",
  path.join(dir, 'tools', 'lib', 'secret.js')], { encoding: 'utf8', input: '', env: { ...process.env, T_ENV: '', ...env } });

test('getSecret: env first, then the workspace vault, else an error without a terminal', (t) => {
  const dir = memory(t);
  assert.strictEqual(getSecretIn(dir, { T_ENV: 'from-env' }).stdout, 'got:from-env');
  const none = getSecretIn(dir, {});
  assert.strictEqual(none.status, 1);
  assert.match(none.stderr, /secret acme.t.pw not available: set T_ENV or run in a terminal/);
  const ws = path.join(tmpdir(t), 'ws2');
  const shared = path.join(ws, '.joserah', 'shared', 'm');
  fs.mkdirSync(path.join(ws, '.joserah', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.joserah', 'tools', 'secret.js'), "process.stdout.write('vault:' + process.argv[2]);");
  fs.cpSync(dir, shared, { recursive: true });
  assert.strictEqual(getSecretIn(shared, {}).stdout, 'got:vault:acme.t.pw');
});

test('sync --push: a non-sweeper push also carries a refreshed AGENTS.md, README.md and tools/**', (t) => {
  const dir = memory(t);
  const bare = path.join(tmpdir(t), 'up.git');
  const g = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  g(dir, 'init', '-q', '-b', 'main'); g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'init');
  assert.strictEqual(g(tmpdir(t), 'init', '-q', '--bare', bare).status, 0);
  g(dir, 'remote', 'add', 'origin', bare); g(dir, 'push', '-q', '-u', 'origin', 'main');
  fs.mkdirSync(path.join(dir, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.memory', 'me'), 'bora\n');
  fs.appendFileSync(path.join(dir, 'tools', 'sync.js'), '\n// refreshed\n');
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nrefreshed\n');
  fs.mkdirSync(path.join(dir, 'members', 'bora'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'members', 'bora', 'note.md'), '# Note\n');
  const n = node(dir, tool(dir, 'sync.js'), ['--push']);
  assert.strictEqual(n.status, 3, n.stderr + n.stdout);
  assert.match(n.stdout, /tools\/sync\.js \(modified\)[^\n]*\(refresh\)/);
  assert.match(n.stdout, /AGENTS\.md \(modified\)[^\n]*\(refresh\)/);
  assert.match(n.stdout, /members\/bora\/note\.md/);
  const y = node(dir, tool(dir, 'sync.js'), ['--push', '--yes']);
  assert.strictEqual(y.status, 0, y.stderr + y.stdout);
  const up = g(bare, 'show', '--stat', '--format=', 'main').stdout;
  assert.match(up, /tools\/sync\.js/); assert.match(up, /AGENTS\.md/); assert.match(up, /members\/bora\/note\.md/);
});

// ---- 0.15.5: the memory's own vault, sweep check, wikilinks ----
const secretIn = (dir, args, input) => spawnSync(process.execPath, [tool(dir, 'secret.js'), ...args], { cwd: dir, encoding: 'utf8', input: input ?? '' });

test('vault: set, get, has, list, index, remove in the memory, flat store, names only in the index', (t) => {
  const dir = memory(t);
  assert.strictEqual(secretIn(dir, ['--set', 'acme.peplink.password'], 's3cret\n').status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'keys', 'secrets.json'), 'utf8')), { 'acme.peplink.password': 's3cret' });
  assert.strictEqual(secretIn(dir, ['acme.peplink.password']).stdout, 's3cret');
  assert.strictEqual(secretIn(dir, ['--has', 'acme.peplink.password']).status, 0);
  assert.strictEqual(secretIn(dir, ['--has', 'acme.nope']).status, 2);
  assert.strictEqual(secretIn(dir, ['--set', 'BadName'], 'x').status, 1);
  assert.strictEqual(secretIn(dir, ['--list']).stdout.trim(), 'acme.peplink.password');
  secretIn(dir, ['--index']);
  const idx = fs.readFileSync(path.join(dir, '.memory', 'vault-index.md'), 'utf8');
  assert.ok(idx.includes('acme.peplink.password') && !idx.includes('s3cret'));
  assert.strictEqual(secretIn(dir, ['--remove', 'acme.peplink.password']).status, 0);
  assert.strictEqual(secretIn(dir, ['acme.peplink.password']).status, 2);
  assert.ok(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split('\n').includes('keys/*'));
  assert.ok(fs.existsSync(path.join(dir, 'keys', 'AGENTS.md')));
});

test('getSecret: the memory vault comes before the workspace vault', async (t) => {
  const ws = tmpdir(t);
  fs.mkdirSync(path.join(ws, '.joserah', 'tools'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.joserah', 'tools', 'secret.js'), "process.stdout.write('from-workspace')");
  const dir = path.join(ws, '.joserah', 'shared', 'acme-memory');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const r = runTool('scaffold.js', ['--kind', 'memory', '--company', 'Acme', '--members', 'Ada', '--sweeper', 'ada', '--language', 'English', '--target', dir], { env: GIT_ENV });
  assert.strictEqual(r.status, 0, r.stderr);
  const { getSecret } = require(path.join(dir, 'tools', 'lib', 'secret.js'));
  delete process.env.ACME_PW;
  assert.strictEqual(await getSecret('ACME_PW', 'acme.x.password'), 'from-workspace');
  secretIn(dir, ['--set', 'acme.x.password'], 'from-memory');
  assert.strictEqual(await getSecret('ACME_PW', 'acme.x.password'), 'from-memory');
});

test('sweep.js: --before counts the inbox, --after names every claim line that did not reach knowledge/', (t) => {
  const dir = memory(t);
  const c = (s) => `- [decision] ${s} -> yes\n  date: 2026-09-30 · by: ada\n`;
  fs.writeFileSync(path.join(dir, 'inbox', 'a.md'), '# A\n' + c('alpha') + c('beta'));
  fs.writeFileSync(path.join(dir, 'inbox', 'b.md'), '# B\n' + c('gamma'));
  const sw = (a) => node(dir, tool(dir, 'sweep.js'), [a]);
  assert.match(sw('--before').stdout, /3/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.memory', 'sweep-state.json'), 'utf8')).count, 3);
  fs.writeFileSync(path.join(dir, 'knowledge', 'k.md'), '# K\n' + c('alpha').replace(' -> ', '   ->  ') + '~~' + '\n' + c('beta'));
  fs.rmSync(path.join(dir, 'inbox', 'a.md')); fs.rmSync(path.join(dir, 'inbox', 'b.md'));
  let r = sw('--after');
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /claims: 2\/3 carried — 1 missing:/);
  assert.match(r.stdout, /gamma/);
  fs.appendFileSync(path.join(dir, 'knowledge', 'k.md'), '\n' + c('gamma'));
  r = sw('--after');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /claims: 3\/3 carried/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.memory', 'config.json'), 'utf8')).lastSweep);
});

test('tools: verify-links reports a dangling wikilink and resolves titled ones', (t) => {
  const dir = memory(t);
  fs.writeFileSync(path.join(dir, 'knowledge', 'a.md'), '# Alpha Note\n[[nowhere]] [[alpha note]] [[Alpha Note|the a]] `[[code]]`\n');
  const r = node(dir, tool(dir, 'verify-links.js'));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /knowledge\/a\.md:2 -> \[\[nowhere\]\]/);
  assert.strictEqual((r.stdout.match(/\[\[/g) || []).length, 1);
});
