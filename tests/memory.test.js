'use strict';
// 0.14.0, the Joserah Memory kind (plan 2026-09-30, Part A): a git repository
// holding a company's shared memory, cloned INSIDE a member's workspace at
// .joserah/shared/<name>/. Local repos only — a bare repo in a temp dir stands
// in for the remote; nothing here reaches a network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool, PLUGIN_ROOT, HERMETIC_CONFIG_DIR } = require('./helpers');

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function node(cwd, script, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...env } });
}
function memory(t, target, extra = []) {
  const dir = target || path.join(tmpdir(t), 'acme-memory');
  const r = runTool('scaffold.js', ['--kind', 'memory', '--company', 'Acme', '--members', 'Ada,bora',
    '--sweeper', 'ada', '--language', 'English', '--target', dir, ...extra], { env: GIT_ENV });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  return dir;
}
function workspace(t, owner = 'Ada Lovelace') {
  const dir = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', dir, '--workspace', 'w', '--owner', owner, '--language', 'English']);
  return dir;
}
const cfgOf = (ws) => JSON.parse(fs.readFileSync(path.join(ws, '.joserah', 'config.json'), 'utf8'));
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// ---- A1: the template ---------------------------------------------------------

test('A1: templates/memory carries the layout, its placeholders only, and a .brand folder', () => {
  const tpl = path.join(PLUGIN_ROOT, 'templates', 'memory');
  for (const rel of ['AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore', 'members/.gitkeep', 'inbox/.gitkeep',
    'knowledge/index.md', 'desk/tasks/now.md', '.brand/README.md',
    'tools/sync.js', 'tools/sweep-due.js', 'tools/detect-member.js']) {
    assert.ok(fs.existsSync(path.join(tpl, rel)), `templates/memory/${rel}`);
  }
  for (const f of walk(tpl)) {
    const tokens = fs.readFileSync(f, 'utf8').match(/{{[A-Z_]+}}/g) || [];
    for (const tok of tokens) assert.ok(['{{COMPANY}}', '{{MEMBERS}}', '{{SWEEPER}}', '{{LANGUAGE}}'].includes(tok), `${f}: ${tok}`);
  }
  const agents = fs.readFileSync(path.join(tpl, 'AGENTS.md'), 'utf8');
  assert.match(agents, /\.brand\//, 'reports about the company use its .brand');
  assert.match(agents, /is a proposal, not the company's decision/);
  assert.match(agents, /Never push unannounced/);
  for (const f of ['AGENTS.md', 'README.md']) assert.match(fs.readFileSync(path.join(tpl, f), 'utf8'), /created with Joserah, but Joserah is not required/, f);
  assert.match(fs.readFileSync(path.join(tpl, '.gitignore'), 'utf8'), /^\.memory\/me$/m);
});

test('A1: a workspace scaffold never copies the memory template, and ignores .joserah/shared/*', (t) => {
  const ws = workspace(t);
  assert.ok(!fs.existsSync(path.join(ws, 'memory')), 'templates/memory leaked into a workspace');
  assert.match(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8'), /^\.joserah\/shared\/\*$/m);
});

// ---- A2: scaffold --kind memory ----------------------------------------------

test('A2: scaffold --kind memory writes the memory, fills every placeholder, and makes one commit', (t) => {
  const dir = memory(t);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.memory', 'config.json'), 'utf8'));
  assert.deepStrictEqual({ ...cfg, created: 'x' }, { kind: 'memory', company: 'Acme', language: 'English',
    members: ['ada', 'bora'], sweeper: 'ada', lastSweep: null, created: 'x' });
  for (const f of walk(dir)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /{{[A-Z_]+}}/, f);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /# AGENTS\.md — Acme Memory/);
  for (const rel of ['tools/verify-links.js', 'tools/claims.js', 'tools/sync.js',
    'tools/sweep-due.js', 'tools/detect-member.js']) assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  assert.strictEqual(git(dir, 'rev-list', '--count', 'HEAD').trim(), '1');
  assert.strictEqual(git(dir, 'status', '--porcelain').trim(), '', 'everything committed');
});

test('A2: scaffold --kind memory refuses a non-empty target and a missing --company', (t) => {
  const dir = path.join(tmpdir(t), 'm');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'x.md'), 'x');
  const full = runTool('scaffold.js', ['--kind', 'memory', '--company', 'Acme', '--members', 'a', '--sweeper', 'a', '--target', dir]);
  assert.strictEqual(full.status, 1);
  assert.ok(!fs.existsSync(path.join(dir, '.memory')), 'nothing written');
  const nocompany = runTool('scaffold.js', ['--kind', 'memory', '--members', 'a', '--sweeper', 'a', '--target', path.join(dir, 'n')]);
  assert.strictEqual(nocompany.status, 1);
  const badsweeper = runTool('scaffold.js', ['--kind', 'memory', '--company', 'A', '--members', 'a', '--sweeper', 'z', '--target', path.join(dir, 'n')]);
  assert.strictEqual(badsweeper.status, 1, 'the sweeper is one of the members');
});

test('A2: a memory created at .joserah/shared/<name> is registered in that workspace', (t) => {
  const ws = workspace(t);
  memory(t, path.join(ws, '.joserah', 'shared', 'acme-memory'));
  assert.deepStrictEqual(cfgOf(ws).shared, [{ name: 'acme-memory', path: '.joserah/shared/acme-memory' }]);
});

// ---- A3: the memory's own tools ------------------------------------------------

test('A3: verify-links, claims and sweep-due run clean on a fresh memory', (t) => {
  const dir = memory(t);
  for (const tool of ['verify-links.js', 'claims.js', 'sweep-due.js']) {
    const r = node(dir, path.join(dir, 'tools', tool), [dir]);
    assert.strictEqual(r.status, 0, `${tool}: ${r.stdout}${r.stderr}`);
  }
  assert.strictEqual(node(dir, path.join(dir, 'tools', 'sweep-due.js')).stdout.trim(), '', 'nothing to sweep, nothing said');
});

test('A3: sweep-due says the line once the inbox holds a note, and --stamp clears it', (t) => {
  const dir = memory(t);
  fs.writeFileSync(path.join(dir, 'inbox', '2026-09-30-bora-encoder.md'), '# Encoder\n');
  const due = node(dir, path.join(dir, 'tools', 'sweep-due.js'));
  assert.match(due.stdout, /sweep due: never swept/);
  assert.match(due.stdout, /ada/, 'names the sweeper');
  assert.strictEqual(node(dir, path.join(dir, 'tools', 'sweep-due.js'), ['--stamp']).status, 0);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.memory', 'config.json'), 'utf8')).lastSweep);
  assert.strictEqual(node(dir, path.join(dir, 'tools', 'sweep-due.js')).stdout.trim(), '', 'swept today');
});

test('A3: sync.js --push commits only the member folder and the inbox, and pull brings the others in', (t) => {
  const base = tmpdir(t);
  const bare = path.join(base, 'acme-memory.git');
  const dir = memory(t, path.join(base, 'acme-memory'));
  git(base, 'init', '--bare', '-q', bare);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(dir, '.memory', 'me'), 'bora\n');
  fs.mkdirSync(path.join(dir, 'members', 'bora', 'daily'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'members', 'bora', 'daily', '2026-09-30.md'), '# 2026-09-30\n');
  fs.writeFileSync(path.join(dir, 'inbox', '2026-09-30-bora-x.md'), '# x\n');
  fs.appendFileSync(path.join(dir, 'knowledge', 'index.md'), '\nnot mine to write\n');
  const notice = node(dir, path.join(dir, 'tools', 'sync.js'), ['--push']);
  assert.strictEqual(notice.status, 3, notice.stdout + notice.stderr);
  // 0.15.6: the notice names its target — shared memory <folder name> (<origin url>).
  assert.match(notice.stdout, /^Push notice — shared memory acme-memory \(.*acme-memory\.git\): 2 file\(s\)$/m);
  assert.match(notice.stdout, /inbox\/2026-09-30-bora-x\.md \(added\) - x$/m);
  assert.match(notice.stdout, /members\/bora\/daily\/2026-09-30\.md \(added\) - 2026-09-30$/m);
  assert.doesNotMatch(notice.stdout, /knowledge/);
  assert.strictEqual(git(dir, 'rev-list', '--count', '@{u}..HEAD').trim(), '0', 'notice pushes nothing');
  const r = node(dir, path.join(dir, 'tools', 'sync.js'), ['--push', '--yes']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^pushed to shared memory acme-memory: [0-9a-f]{7,} bora: \d{4}-\d{2}-\d{2}$/m);
  const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();
  assert.deepStrictEqual(files, ['inbox/2026-09-30-bora-x.md', 'members/bora/daily/2026-09-30.md']);
  assert.match(git(dir, 'status', '--porcelain'), /knowledge\/index\.md/, 'knowledge/ stays unstaged');
  assert.strictEqual(git(dir, 'rev-list', '--count', '@{u}..HEAD').trim(), '0', 'pushed');

  const other = path.join(base, 'other');
  git(base, 'clone', '-q', bare, other);
  fs.writeFileSync(path.join(other, 'inbox', '2026-09-30-ada-y.md'), '# y\n');
  git(other, 'add', '.'); git(other, 'commit', '-q', '-m', 'ada: 2026-09-30'); git(other, 'push', '-q');
  const pull = node(dir, path.join(dir, 'tools', 'sync.js'));
  assert.strictEqual(pull.status, 0, pull.stdout + pull.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'inbox', '2026-09-30-ada-y.md')), 'pulled');
});

test('A3: sync.js --push --sweep is the sweeper\'s alone', (t) => {
  const dir = memory(t);
  fs.writeFileSync(path.join(dir, '.memory', 'me'), 'bora\n');
  const r = node(dir, path.join(dir, 'tools', 'sync.js'), ['--push', '--sweep']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout + r.stderr, /ada/);
});

// ---- A4: who the member is -----------------------------------------------------

test('A4: the member is .memory/me, else the workspace owner\'s first name, else the git user', (t) => {
  const { detectMember, memberSlug } = require(path.join(PLUGIN_ROOT, 'templates', 'memory', 'tools', 'detect-member.js'));
  assert.strictEqual(memberSlug('Şükrü Çağlar'), 'sukru');
  assert.strictEqual(memberSlug('  İpek Işık '), 'ipek');
  const ws = workspace(t, 'Serkan Adem Atay');
  const dir = memory(t, path.join(ws, '.joserah', 'shared', 'acme-memory'), ['--members', 'Ada,bora,Serkan']);
  assert.strictEqual(detectMember(dir), 'serkan');
  fs.writeFileSync(path.join(dir, '.memory', 'me'), 'Bora\n');
  assert.strictEqual(detectMember(dir), 'bora');
  const alone = memory(t);
  git(alone, 'config', 'user.name', 'Ada Kaya');
  assert.strictEqual(detectMember(alone), 'ada');
  const r = node(alone, path.join(alone, 'tools', 'detect-member.js'));
  assert.strictEqual(r.stdout.trim(), 'ada');
});

// ---- A5: doctor ----------------------------------------------------------------

test('A5: doctor on a fresh memory passes, and names a drifted tool', (t) => {
  const dir = memory(t);
  const ok = runTool('doctor.js', [dir]);
  assert.strictEqual(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /ok\s+memory config readable/);
  fs.appendFileSync(path.join(dir, 'tools', 'sync.js'), '\n// edited\n');
  const drift = runTool('doctor.js', [dir]);
  assert.strictEqual(drift.status, 1);
  assert.match(drift.stdout, /FAIL\s+memory tool current: tools\/sync\.js/);
});

test('A5: doctor warns on an overdue sweep and on a member writing outside their folder', (t) => {
  const dir = memory(t);
  fs.writeFileSync(path.join(dir, 'inbox', '2026-09-01-bora-x.md'), '# x\n');
  const cfgPath = path.join(dir, '.memory', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.lastSweep = '2026-01-01T00:00:00.000Z';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  fs.appendFileSync(path.join(dir, 'knowledge', 'index.md'), '\nx\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'bora: 2026-09-30');
  const r = runTool('doctor.js', [dir]);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /warn\s+memory sweep\s+— \d+ days since last sweep/);
  assert.match(r.stdout, /warn\s+members write only their own folder and inbox\/\s+— .*bora: knowledge\/index\.md/);
});

test('A5: a workspace doctor checks each shared memory it names', (t) => {
  const ws = workspace(t);
  memory(t, path.join(ws, '.joserah', 'shared', 'acme-memory'));
  const ok = runTool('doctor.js', [ws]);
  assert.strictEqual(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /ok\s+shared memory acme-memory/);
  fs.rmSync(path.join(ws, '.joserah', 'shared', 'acme-memory'), { recursive: true, force: true });
  assert.match(runTool('doctor.js', [ws]).stdout, /warn\s+shared memory acme-memory\s+— no memory at \.joserah\/shared\/acme-memory/);
});

// ---- joining an existing memory -------------------------------------------------

test('join: --join-memory clones into .joserah/shared/<repo name>, registers it and ignores it', (t) => {
  const base = tmpdir(t);
  const src = memory(t, path.join(base, 'src'));
  const bare = path.join(base, 'acme-memory.git');
  git(base, 'clone', '-q', '--bare', src, bare);
  const ws = workspace(t);
  fs.writeFileSync(path.join(ws, '.gitignore'), fs.readFileSync(path.join(ws, '.gitignore'), 'utf8').replace('.joserah/shared/*\n', ''));
  const r = runTool('scaffold.js', ['--join-memory', bare, '--target', ws]);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(ws, '.joserah', 'shared', 'acme-memory', '.memory', 'config.json')));
  assert.deepStrictEqual(cfgOf(ws).shared, [{ name: 'acme-memory', path: '.joserah/shared/acme-memory' }]);
  assert.match(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8'), /^\.joserah\/shared\/\*$/m, 'added back');
  const again = runTool('scaffold.js', ['--join-memory', bare, '--target', ws]);
  assert.strictEqual(again.status, 1, 'already there: refused, nothing overwritten');
  assert.strictEqual(cfgOf(ws).shared.length, 1);
});

test('join: a repository that is not a memory is refused and leaves nothing behind', (t) => {
  const base = tmpdir(t);
  const plain = path.join(base, 'plain');
  fs.mkdirSync(plain); git(plain, 'init', '-q'); git(plain, 'commit', '-q', '--allow-empty', '-m', 'x');
  const ws = workspace(t);
  const r = runTool('scaffold.js', ['--join-memory', plain, '--target', ws]);
  assert.strictEqual(r.status, 1);
  assert.ok(!fs.existsSync(path.join(ws, '.joserah', 'shared', 'plain')));
  assert.strictEqual(cfgOf(ws).shared, undefined);
});

// ---- A6: the session brief -------------------------------------------------------

function brief(ws) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'joserah-brief-tmp-'));
  try {
    const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'session-brief.js')],
      { cwd: ws, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, CLAUDE_CONFIG_DIR: HERMETIC_CONFIG_DIR,
        CLAUDE_PLUGIN_ROOT: '', TEMP: tmp, TMP: tmp, TMPDIR: tmp } });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('A6: the brief carries one block per memory: sync state, the sweep line, the member\'s open items', (t) => {
  const base = tmpdir(t);
  const src = memory(t, path.join(base, 'src'));
  const bare = path.join(base, 'acme-memory.git');
  git(base, 'clone', '-q', '--bare', src, bare);
  const ws = workspace(t, 'Bora Tan');
  assert.strictEqual(runTool('scaffold.js', ['--join-memory', bare, '--target', ws]).status, 0);
  const mem = path.join(ws, '.joserah', 'shared', 'acme-memory');
  fs.mkdirSync(path.join(mem, 'members', 'bora'), { recursive: true });
  fs.writeFileSync(path.join(mem, 'members', 'bora', 'tasks.md'), '# Tasks\n\n- [ ] ship the encoder note\n- [x] done one\n');
  // Upstream moves on: one commit the member's clone has not pulled.
  const other = path.join(base, 'other');
  git(base, 'clone', '-q', bare, other);
  fs.writeFileSync(path.join(other, 'inbox', '2026-09-30-ada-y.md'), '# y\n');
  git(other, 'add', '.'); git(other, 'commit', '-q', '-m', 'ada: 2026-09-30'); git(other, 'push', '-q');
  fs.writeFileSync(path.join(mem, 'inbox', '2026-09-30-bora-x.md'), '# x\n');

  const ctx = brief(ws);
  assert.match(ctx, /### Shared memory: acme-memory \(\.joserah\/shared\/acme-memory\), you are "bora"/);
  assert.match(ctx, /The Acme shared memory is behind: 1 new commit — latest: t, 'ada: 2026-09-30', (just now|\d+ minutes? ago)\. It will be pulled at session start\./);
  assert.match(ctx, /sweep due: never swept/);
  assert.match(ctx, /- \[ \] ship the encoder note/);
  assert.doesNotMatch(ctx, /done one/);
});

// 0.15.0: the sync state reads as a sentence in the owner's language.
function joinedTr(t) {
  const base = tmpdir(t);
  const src = memory(t, path.join(base, 'src'));
  const bare = path.join(base, 'acme-memory.git');
  git(base, 'clone', '-q', '--bare', src, bare);
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'Bora Tan', '--language', 'Turkish']);
  assert.strictEqual(runTool('scaffold.js', ['--join-memory', bare, '--target', ws]).status, 0);
  return { base, bare, ws, mem: path.join(ws, '.joserah', 'shared', 'acme-memory') };
}
const syncLines = (ctx) => ctx.split('\n').filter((l) => /ortak hafıza/.test(l));

test('A6: in Turkish, a level memory is one sentence: güncel', (t) => {
  const { ws } = joinedTr(t);
  assert.deepStrictEqual(syncLines(brief(ws)), ['Acme ortak hafızası güncel.']);
});

test('A6: in Turkish, behind names the count, the latest author, subject and age', (t) => {
  const { base, bare, ws } = joinedTr(t);
  const other = path.join(base, 'other');
  git(base, 'clone', '-q', bare, other);
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(other, 'inbox', `2026-09-30-ada-${n}.md`), '# y\n');
    git(other, 'add', '.'); git(other, 'commit', '-q', '-m', `sweep 2026-09-30 ${n}`);
  }
  git(other, 'push', '-q');
  const lines = syncLines(brief(ws));
  assert.strictEqual(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^Acme ortak hafızası eski kalmış: 3 yeni commit var — son: t, 'sweep 2026-09-30 3', (az önce|\d+ dakika önce)\. Oturum başında çekilecek\./);
});

test('A6: in Turkish, ahead says the unpushed commits and the push notice', (t) => {
  const { ws, mem } = joinedTr(t);
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(mem, 'inbox', `2026-09-30-bora-${n}.md`), '# x\n');
    git(mem, 'add', '.'); git(mem, 'commit', '-q', '-m', `bora ${n}`);
  }
  assert.deepStrictEqual(syncLines(brief(ws)), ["Acme ortak hafızasında gönderilmemiş 2 commit'in var — push bildirimi için sync --push."]);
});

test('A6: a workspace with no shared memory has no memory block', (t) => {
  assert.doesNotMatch(brief(workspace(t)), /Shared memory/);
});

// ---- A7: setup and README ---------------------------------------------------------

test('A7: setup recognises joining and creating a shared memory; README has the section', () => {
  const setup = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'setup', 'SKILL.md'), 'utf8');
  const description = /^description:(.*)$/m.exec(setup)[1];
  assert.match(description, /shared memory/);
  assert.match(description, /ortak hafızamız/);
  assert.ok(setup.includes('--join-memory'));
  assert.ok(setup.includes('--kind memory'));
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const section = readme.slice(readme.indexOf('## Shared memory'), readme.indexOf('\n## ', readme.indexOf('## Shared memory') + 3));
  assert.ok(readme.includes('## Shared memory'));
  assert.ok(section.trim().split('\n').length <= 14, 'about ten lines');
});

test('the workspace tools never walk into a shared memory', () => {
  const u = require(path.join(PLUGIN_ROOT, 'tools', 'lib', 'untouchable'));
  for (const set of ['LINK_SCAN_SKIP_REL', 'MIGRATION_SKIP_REL', 'SECRET_SCAN_SKIP_REL']) {
    assert.ok(u[set].includes('.joserah/shared'), set);
  }
});

// ---- questions between members --------------------------------------------------

test('questions: sync lists open and answered counts, the push notice carries them, doctor warns on a foreign edit', (t) => {
  const base = tmpdir(t);
  const bare = path.join(base, 'acme-memory.git');
  const dir = memory(t, path.join(base, 'acme-memory'));
  git(base, 'init', '--bare', '-q', bare);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  assert.ok(fs.existsSync(path.join(dir, 'questions', '.gitkeep')));
  const q = (name, from, to, status) => fs.writeFileSync(path.join(dir, 'questions', name),
    `---\nfrom: ${from}\nto: ${to}\ndate: 2026-09-30\nstatus: ${status}\n---\n## Question\nWhich port does the encoder use?\n`);
  q('2026-09-30-ada-bora-port.md', 'ada', 'bora', 'open');
  q('2026-09-30-bora-ada-key.md', 'bora', 'ada', 'answered');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'ada: 2026-09-30'); git(dir, 'push', '-q');
  fs.writeFileSync(path.join(dir, '.memory', 'me'), 'bora\n');
  const s = node(dir, path.join(dir, 'tools', 'sync.js'));
  assert.match(s.stdout, /Questions for bora: 1 open\n  questions\/2026-09-30-ada-bora-port\.md - Which port/);
  assert.match(s.stdout, /Answers to your questions: 1\n  questions\/2026-09-30-bora-ada-key\.md/);
  q('2026-09-30-ada-bora-port.md', 'ada', 'bora', 'answered');
  fs.appendFileSync(path.join(dir, 'questions', '2026-09-30-ada-bora-port.md'), '## Answer\n9000\n');
  const n = node(dir, path.join(dir, 'tools', 'sync.js'), ['--push']);
  assert.strictEqual(n.status, 3, n.stdout + n.stderr);
  assert.match(n.stdout, /questions\/2026-09-30-ada-bora-port\.md \(modified\)/);
  // doctor: the addressee (bora) editing is fine; the asker editing it after the fact is not
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'bora: 2026-09-30');
  assert.doesNotMatch(runTool('doctor.js', [dir]).stdout, /edited a question/);
  fs.appendFileSync(path.join(dir, 'questions', '2026-09-30-bora-ada-key.md'), 'tampered\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'bora: again');
  assert.match(runTool('doctor.js', [dir]).stdout, /warn\s+members write only.*bora edited a question for ada: questions\/2026-09-30-bora-ada-key\.md/);
});

test('questions: the member AGENTS.md tells the assistant to write an answer only after approval', () => {
  const agents = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'memory', 'AGENTS.md'), 'utf8');
  assert.match(agents, /Write the answer only after the member approves its wording/);
});

// ce2b7a7 re-added a questions paragraph 8f0b96c already had.
test('the memory AGENTS.md states the questions rule once', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'memory', 'AGENTS.md'), 'utf8');
  assert.strictEqual(text.split('Questions between members').length - 1, 1);
});

test('A8: setup takes a git URL; README install prompt uses the real URL', () => {
  const setup = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'setup', 'SKILL.md'), 'utf8');
  assert.match(/^description:(.*)$/m.exec(setup)[1], /git url/);
  assert.ok(setup.includes('git clone <url>'));
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('Install Joserah from https://github.com/SerVian7/joserah'));
  assert.ok(!readme.includes('<path-to-clone>'));
});
