'use strict';
// exp/shared-assistant (design docs/specs/2026-10-06-shared-assistant-design.md §5–§7): continuous
// recording in a Joserah Memory. Whoever records a fact ingests it in the same push; a zero-token gate
// (tools/ingest.js check) proves it; log.md and index.md never conflict; a real conflict never leaves a
// clone mid-rebase, and --redo re-derives the member's knowledge edits from their untouched note.
// Local repos only — a bare repo in a temp dir stands in for the remote.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool } = require('./helpers');
const { memoryChecks, refreshMemory } = require('../tools/lib/memory');

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const node = (cwd, script, args = []) => spawnSync(process.execPath, [path.join(cwd, 'tools', script), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const cfgOf = (dir) => JSON.parse(read(dir, '.memory/config.json'));

function memory(t, extra = ['--recording', 'continuous']) {
  const dir = path.join(tmpdir(t), 'acme-memory');
  const r = runTool('scaffold.js', ['--kind', 'memory', '--company', 'Acme', '--members', 'Ada,bora',
    '--sweeper', 'ada', '--language', 'English', '--target', dir, ...extra], { env: GIT_ENV });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  return dir;
}
// A continuous memory on a bare remote, and two members' clones of it.
function team(t, prepare) {
  const src = memory(t);
  if (prepare) { prepare(src); git(src, 'commit', '-q', '-am', 'ada: prepared'); }
  const base = path.dirname(src);
  const bare = path.join(base, 'acme-memory.git');
  git(base, 'clone', '-q', '--bare', src, bare);
  const clone = (who) => {
    const d = path.join(base, who);
    git(base, 'clone', '-q', bare, d);
    write(d, '.memory/me', who + '\n');
    return d;
  };
  return { bare, ada: clone('ada'), bora: clone('bora') };
}

const SWITCH = '- [decision] Veliefendi switch -> Netgear M4350\n  date: 2026-10-01 · by: ada · source: members/ada/notes/2026-10-06-switch.md\n';
// One ingest, as the assistant does it: the note, the touched page, the log entry.
function ingest(dir, who, { slug = 'switch', page = 'wiki/entities/veliefendi.md', claim = SWITCH, pageText } = {}) {
  const note = `members/${who}/notes/2026-10-06-${slug}.md`;
  write(dir, note, `# ${slug}\n\n${claim}`);
  const p = path.join(dir, 'knowledge', page);
  const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : `# ${path.basename(page, '.md')}\n\n`;
  write(dir, `knowledge/${page}`, pageText !== undefined ? pageText : old + claim);
  const r = node(dir, 'ingest.js', ['log', '--op', 'ingest', '--title', `${slug} recorded`, '--source', note, '--touched', page]);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  return note;
}

// ---- setup and init -----------------------------------------------------------

test('recording: scaffold --recording continuous sets the mode, the union merges, the log and the index block', (t) => {
  const dir = memory(t);
  assert.strictEqual(cfgOf(dir).recording, 'continuous');
  const attrs = read(dir, '.gitattributes');
  assert.match(attrs, /^knowledge\/log\.md merge=union$/m);
  assert.match(attrs, /^knowledge\/index\.md merge=union$/m);
  assert.match(read(dir, 'knowledge/log.md'), /^## \[\d{4}-\d{2}-\d{2}\] migrate \| continuous recording on$/m);
  assert.match(read(dir, 'knowledge/index.md'), /<!-- index:start[^\n]*-->\n[\s\S]*<!-- index:end -->/);
  assert.strictEqual(git(dir, 'status', '--porcelain').trim(), '', 'all of it in the first commit');
});

test('recording: a memory without the flag stays in sweep mode; ingest.js init switches it, idempotently', (t) => {
  const dir = memory(t, []);
  assert.strictEqual(cfgOf(dir).recording, undefined);
  write(dir, '.memory/me', 'ada\n');
  const r = node(dir, 'ingest.js', ['init']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.strictEqual(cfgOf(dir).recording, 'continuous');
  assert.match(r.stdout, /continuous recording on/);
  const again = node(dir, 'ingest.js', ['init']);
  assert.strictEqual(again.status, 0);
  assert.match(again.stdout, /already continuous/);
  assert.strictEqual(read(dir, 'knowledge/log.md').split('] migrate |').length - 1, 1, 'one migrate entry');
});

test('recording: only the sweeper switches a memory to continuous recording', (t) => {
  const dir = memory(t, []);
  write(dir, '.memory/me', 'bora\n');
  const r = node(dir, 'ingest.js', ['init']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /only the sweeper \(ada\)/);
});

// ---- log and index --------------------------------------------------------------

test('recording: ingest.js log writes one entry with by, source and touched', (t) => {
  const dir = memory(t);
  write(dir, '.memory/me', 'ada\n');
  ingest(dir, 'ada');
  const log = read(dir, 'knowledge/log.md');
  assert.match(log, /\n## \[\d{4}-\d{2}-\d{2}\] ingest \| switch recorded\nby: ada · source: members\/ada\/notes\/2026-10-06-switch\.md\ntouched: wiki\/entities\/veliefendi\.md\n/);
});

test('recording: ingest.js index lists every record page once, skips index, log and sources', (t) => {
  const dir = memory(t);
  write(dir, 'knowledge/wiki/entities/veliefendi.md', '---\ntitle: Veliefendi studio\n---\n# ignored\n');
  write(dir, 'knowledge/people/onur.md', '# Onur [Umur]\n');
  write(dir, 'knowledge/sources/manual.md', '# A manual\n');
  const r = node(dir, 'ingest.js', ['index']);
  assert.strictEqual(r.status, 0, r.stderr);
  const idx = read(dir, 'knowledge/index.md');
  assert.ok(idx.includes('- [Onur \\[Umur\\]](people/onur.md)'), idx);
  assert.ok(idx.includes('- [Veliefendi studio](wiki/entities/veliefendi.md)'), idx);
  assert.doesNotMatch(idx, /manual|log\.md|\(index\.md\)/);
  assert.match(idx, /^# Knowledge/m, 'the hand-written head stays');
  assert.match(node(dir, 'ingest.js', ['index']).stdout, /index: unchanged/);
  assert.strictEqual(node(dir, 'verify-links.js').status, 0);
});

// ---- the gate ---------------------------------------------------------------------

test('recording: check passes a proper ingest and counts what it carried', (t) => {
  const dir = memory(t);
  write(dir, '.memory/me', 'ada\n');
  ingest(dir, 'ada');
  node(dir, 'ingest.js', ['index']);
  git(dir, 'add', '-A');
  const r = node(dir, 'ingest.js', ['check']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ingest check: ok — 1 entry, 1 page, 1 claim line carried/);
});

test('recording: check refuses a dropped claim, a silent edit, a stale index, a foreign by and a missing source', (t) => {
  const dir = memory(t);
  write(dir, '.memory/me', 'bora\n');
  // the page lost the note's claim line
  ingest(dir, 'bora', { pageText: '# veliefendi\n\nA switch was chosen.\n' });
  // a page changed with no log entry naming it
  write(dir, 'knowledge/wiki/topics/network.md', '# network\n\nedited quietly\n');
  // an entry in someone else's name, with a source that is not there
  fs.appendFileSync(path.join(dir, 'knowledge/log.md'), '\n## [2026-10-06] ingest | not mine\nby: ada · source: members/ada/notes/gone.md\ntouched: wiki/entities/veliefendi.md\n');
  git(dir, 'add', '-A');
  const r = node(dir, 'ingest.js', ['check']);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /claim line not in knowledge\/: Veliefendi switch/);
  assert.match(r.stdout, /knowledge\/wiki\/topics\/network\.md changed but no log entry names it/);
  assert.match(r.stdout, /knowledge\/index\.md is not current/);
  assert.match(r.stdout, /"not mine": by: ada, but you are bora/);
  assert.match(r.stdout, /"not mine": source members\/ada\/notes\/gone\.md does not exist/);
});

// ---- sync ---------------------------------------------------------------------------

test('recording: sync --push stages knowledge, regenerates the index and refuses when the gate fails', (t) => {
  const { ada } = team(t);
  ingest(ada, 'ada');
  let r = node(ada, 'sync.js', ['--push']);
  assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /knowledge\/wiki\/entities\/veliefendi\.md \(added\)/);
  assert.match(r.stdout, /knowledge\/index\.md \(modified\)/);
  r = node(ada, 'sync.js', ['--push', '--yes']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /pushed to shared memory ada/);
  write(ada, 'knowledge/wiki/entities/veliefendi.md', '# veliefendi\n\nquietly rewritten\n');
  r = node(ada, 'sync.js', ['--push']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /changed but no log entry names it/);
  assert.doesNotMatch(r.stdout, /Push notice/);
});

test('recording: two members ingesting at once both push — log and index merge without a stop', (t) => {
  const { ada, bora } = team(t);
  ingest(ada, 'ada');
  assert.strictEqual(node(ada, 'sync.js', ['--push', '--yes']).status, 0);
  ingest(bora, 'bora', { slug: 'uplink', page: 'wiki/topics/network.md',
    claim: '- [measurement] Uplink -> 90 Mbps\n  condition: Veliefendi, Starlink · date: 2026-10-06 · by: bora · source: members/bora/notes/2026-10-06-uplink.md\n' });
  const r = node(bora, 'sync.js', ['--push', '--yes']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const log = read(bora, 'knowledge/log.md');
  assert.match(log, /switch recorded[\s\S]*uplink recorded/);
  const idx = read(bora, 'knowledge/index.md');
  for (const p of ['wiki/entities/veliefendi.md', 'wiki/topics/network.md']) assert.strictEqual(idx.split(`(${p})`).length - 1, 1, p);
  assert.strictEqual(node(bora, 'ingest.js', ['index']).stdout.trim(), 'index: unchanged');
  assert.strictEqual(git(bora, 'status', '--porcelain').trim(), '');
});

test('recording: the union lines are what keeps those two pushes apart — without them the second stops', (t) => {
  const { ada, bora } = team(t, (src) => fs.writeFileSync(path.join(src, '.gitattributes'), read(src, '.gitattributes').replace(/^knowledge.*merge=union$/gm, '')));
  ingest(ada, 'ada');
  assert.strictEqual(node(ada, 'sync.js', ['--push', '--yes']).status, 0);
  ingest(bora, 'bora', { slug: 'uplink', page: 'wiki/topics/network.md', claim: '- [decision] Uplink -> Starlink\n  date: 2026-10-06 · by: bora\n' });
  const r = node(bora, 'sync.js', ['--push', '--yes']);
  assert.strictEqual(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /knowledge\/log\.md/);
});

test('recording: a real conflict aborts the rebase (exit 4), and --redo re-derives from the untouched note', (t) => {
  const { ada, bora } = team(t);
  ingest(ada, 'ada');
  assert.strictEqual(node(ada, 'sync.js', ['--push', '--yes']).status, 0);
  // bora, not yet pulled, records the same page's first lines differently
  const note = ingest(bora, 'bora', { slug: 'switch-b', pageText: '# veliefendi\n\n- [decision] Veliefendi switch -> Cisco\n  date: 2026-10-06 · by: bora · source: members/bora/notes/2026-10-06-switch-b.md\n',
    claim: '- [decision] Veliefendi switch -> Cisco\n  date: 2026-10-06 · by: bora · source: members/bora/notes/2026-10-06-switch-b.md\n' });
  let r = node(bora, 'sync.js', ['--push', '--yes']);
  assert.strictEqual(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /conflict with the remote on: knowledge\/wiki\/entities\/veliefendi\.md/);
  assert.match(r.stderr, /node tools\/sync\.js --redo/);
  for (const d of ['rebase-merge', 'rebase-apply']) assert.ok(!fs.existsSync(path.join(bora, '.git', d)), 'no rebase left open');
  r = node(bora, 'sync.js', ['--redo']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /kept on branch redo-/);
  assert.match(r.stdout, /re-apply: switch-b recorded — source members\/bora\/notes\/2026-10-06-switch-b\.md — touched wiki\/entities\/veliefendi\.md/);
  assert.match(read(bora, 'knowledge/wiki/entities/veliefendi.md'), /Netgear M4350/, 'the remote page, not a hand merge');
  assert.ok(fs.existsSync(path.join(bora, note)), 'the note survives');
  // the assistant re-applies onto the fresh page: both claims stand, the push goes through
  const page = read(bora, 'knowledge/wiki/entities/veliefendi.md');
  write(bora, 'knowledge/wiki/entities/veliefendi.md', page + '- [decision] Veliefendi switch -> Cisco\n  date: 2026-10-06 · by: bora · source: members/bora/notes/2026-10-06-switch-b.md\n');
  assert.strictEqual(node(bora, 'ingest.js', ['log', '--op', 'ingest', '--title', 'switch-b recorded', '--source', note, '--touched', 'wiki/entities/veliefendi.md']).status, 0);
  r = node(bora, 'sync.js', ['--push', '--yes']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('recording: --redo refuses uncommitted changes and says when there is nothing to redo', (t) => {
  const { ada } = team(t);
  let r = node(ada, 'sync.js', ['--redo']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /nothing to redo/);
  write(ada, 'knowledge/wiki/topics/x.md', '# x\n');
  git(ada, 'add', '-A');
  r = node(ada, 'sync.js', ['--redo']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /uncommitted changes/);
});

// ---- sweep-due, doctor, refresh, AGENTS.md ---------------------------------------------

test('recording: sweep-due names inbox notes waiting for ingest instead of a sweep', (t) => {
  const dir = memory(t);
  write(dir, 'inbox/2026-10-06-bora-x.md', '# x\n');
  const r = node(dir, 'sweep-due.js');
  assert.match(r.stdout.trim(), /^inbox: 1 note waiting for ingest — ada or any member ingests it\.$/);
});

test('recording: doctor accepts a member editing knowledge/ with a log entry, and flags one without', (t) => {
  const { ada, bora } = team(t);
  ingest(bora, 'bora', { slug: 'b', page: 'wiki/topics/b.md', claim: '- [decision] B -> yes\n  date: 2026-10-06 · by: bora\n' });
  assert.strictEqual(node(bora, 'sync.js', ['--push', '--yes']).status, 0);
  const stray = (dir) => memoryChecks(dir).find((c) => c.name === 'members write only their own folder and inbox/');
  assert.strictEqual(stray(bora), undefined);
  write(bora, 'knowledge/wiki/topics/b.md', '# b\n\nquiet\n');
  git(bora, 'add', '-A');
  git(bora, 'commit', '-q', '-m', 'bora: quiet edit');
  const s = stray(bora);
  assert.ok(s && s.warn, 'flagged');
  assert.match(s.detail, /bora: knowledge\/wiki\/topics\/b\.md/);
  assert.ok(ada);
});

test('recording: --refresh-memory carries RECORDING.md, and AGENTS.md points at it', (t) => {
  const dir = memory(t);
  fs.rmSync(path.join(dir, 'RECORDING.md'));
  assert.ok(refreshMemory(dir).includes('RECORDING.md'));
  const rec = read(dir, 'RECORDING.md');
  assert.match(rec, /node tools\/ingest\.js log --op ingest/);
  assert.match(rec, /node tools\/sync\.js --redo/);
  assert.doesNotMatch(rec, /{{[A-Z_]+}}/);
  assert.ok(read(dir, 'AGENTS.md').replace(/\s+/g, ' ').includes('When `.memory/config.json` says `"recording": "continuous"`, read `RECORDING.md` next'));
});
