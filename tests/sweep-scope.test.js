'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpdir, runTool } = require('./helpers');

const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', windowsHide: true });
const E = '.joserah/knowledge/wiki/entities';
const EPOCH = '1970-01-02T00:00:00Z';

function ws(t, { repo = false } = {}) {
  const dir = path.join(tmpdir(t), 'ws');
  fs.mkdirSync(path.join(dir, '.joserah', 'desk'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.joserah', 'config.json'), '{"workspaceName":"w"}\n');
  if (repo) {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'a@b.c');
    git(dir, 'config', 'user.name', 'A B');
  }
  return dir;
}
function put(dir, rel, text) {
  const f = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}
const ledgerFile = (dir) => path.join(dir, '.joserah', 'desk', 'sweep-ledger.json');
function list(dir, ...a) {
  const r = runTool('sweep-scope.js', [dir, 'list', ...a]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return r.stdout.split('\n').filter(Boolean);
}
function stamp(dir, ...a) {
  const r = runTool('sweep-scope.js', [dir, 'stamp', ...a]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
}
function commit(dir, msg, when) {
  git(dir, 'add', '-A');
  const env = when ? { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when } : process.env;
  const r = spawnSync('git', ['-C', dir, 'commit', '-qm', msg], { env, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return git(dir, 'rev-parse', 'HEAD').stdout.trim();
}
// A workspace whose ledger is seeded from the epoch and stamped: everything is "seen".
function seeded(t, repo, files) {
  const dir = ws(t, { repo });
  for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
  list(dir, '--seed-since', EPOCH);
  stamp(dir);
  return dir;
}

// The same cases with and without git: the ledger never depends on it.
for (const repo of [false, true]) {
  const label = repo ? 'with git' : 'without git';

  test(`ledger, ${label}: unchanged is not listed; changed and new are; list right after stamp prints nothing`, (t) => {
    const dir = seeded(t, repo, { [`${E}/otto.md`]: 'otto\n', [`${E}/mia.md`]: 'mia\n' });
    assert.deepStrictEqual(list(dir), []);
    put(dir, `${E}/otto.md`, 'otto, a dog\n');
    put(dir, `${E}/rex.md`, 'rex\n');
    assert.deepStrictEqual(list(dir), [`${E}/otto.md`, `${E}/rex.md`]);
    stamp(dir, '--wrote', `${E}/otto.md`, `${E}/rex.md`);
    assert.deepStrictEqual(list(dir), []);
  });

  test(`ledger, ${label}: a file the sweep wrote and stamped is not listed again`, (t) => {
    const dir = seeded(t, repo, { [`${E}/otto.md`]: 'otto\n' });
    put(dir, `${E}/otto.md`, 'otto\nmore\n');
    assert.deepStrictEqual(list(dir), [`${E}/otto.md`]);
    // the sweep tidies the listed page and writes a new record, then names both
    put(dir, `${E}/otto.md`, 'otto\nmore\ntidied\n');
    put(dir, `${E}/chill-house.md`, 'chill house\n');
    stamp(dir, '--wrote', `${E}/otto.md`, `${E}/chill-house.md`);
    assert.deepStrictEqual(list(dir), []);
  });

  test(`ledger, ${label}: a file changed after list and before stamp is listed the next time`, (t) => {
    const dir = seeded(t, repo, { [`${E}/a.md`]: 'a\n', [`${E}/b.md`]: 'b\n' });
    put(dir, `${E}/a.md`, 'a2\n');
    assert.deepStrictEqual(list(dir), [`${E}/a.md`]);
    put(dir, `${E}/b.md`, 'b2\n');        // another session, mid-sweep
    put(dir, `${E}/c.md`, 'c\n');         // and a new page
    stamp(dir);
    assert.deepStrictEqual(list(dir), [`${E}/b.md`, `${E}/c.md`]);
  });

  test(`ledger, ${label}: a deleted page is not listed, and returns unlisted when its words are unchanged`, (t) => {
    const dir = seeded(t, repo, { [`${E}/a.md`]: 'a\n', [`${E}/b.md`]: 'b\n' });
    fs.rmSync(path.join(dir, ...`${E}/b.md`.split('/')));
    assert.deepStrictEqual(list(dir), []);
    put(dir, `${E}/b.md`, 'b\n');         // same words as the ledger holds: nothing to read
    assert.deepStrictEqual(list(dir), []); // still the old ledger entry: same content, nothing to read
  });

  test(`never listed, ${label}: crew logs, artifacts, job files, source material, other files`, (t) => {
    const dir = ws(t, { repo });
    put(dir, `${E}/otto.md`, 'otto\n');
    put(dir, '.joserah/desk/crew/2026-11-26/builder/x.md', 'log\n');
    put(dir, '.joserah/desk/artifacts/2026-11-26/p/page.md', 'a\n');
    put(dir, '.joserah/desk/jobs/job.json', '{}\n');
    put(dir, '.joserah/desk/jobs/job.md', 'j\n');
    put(dir, '.joserah/knowledge/raw/src.md', 'source\n');
    put(dir, '.joserah/knowledge/wiki/pic.png', 'png\n');
    put(dir, '.joserah/learned.md', 'rules\n');
    put(dir, 'notes.md', 'root\n');
    put(dir, '.joserah/knowledge/people/emre.md', 'emre\n');
    put(dir, '.joserah/personal/profile.md', 'p\n');
    put(dir, '.joserah/desk/daily/2026/2026-11-26.md', 'd\n');
    put(dir, '.joserah/desk/inbox/captures.md', 'c\n');
    put(dir, '.joserah/desk/tasks/now.md', 't\n');
    assert.deepStrictEqual(list(dir, '--seed-since', EPOCH), [
      '.joserah/desk/daily/2026/2026-11-26.md',
      '.joserah/desk/inbox/captures.md',
      '.joserah/desk/tasks/now.md',
      `${E}/otto.md`,
      '.joserah/knowledge/people/emre.md',
      '.joserah/personal/profile.md',
    ].sort());
  });

  test(`second run, ${label}: nothing listed, and the ledger is not rewritten`, (t) => {
    const dir = seeded(t, repo, { [`${E}/otto.md`]: 'otto\n' });
    const before = fs.readFileSync(ledgerFile(dir), 'utf8');
    const m = fs.statSync(ledgerFile(dir)).mtimeMs;
    assert.deepStrictEqual(list(dir), []);
    assert.deepStrictEqual(list(dir), []);
    assert.strictEqual(fs.readFileSync(ledgerFile(dir), 'utf8'), before);
    assert.strictEqual(fs.statSync(ledgerFile(dir)).mtimeMs, m);
  });
}

test('seed from a date, no git: file times, newer than the date', (t) => {
  const dir = ws(t);
  put(dir, `${E}/old.md`, 'old\n');
  put(dir, `${E}/new.md`, 'new\n');
  const old = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(path.join(dir, ...`${E}/old.md`.split('/')), old, old);
  assert.deepStrictEqual(list(dir, '--seed-since', '2026-06-01T00:00:00Z'), [`${E}/new.md`]);
});

test('seed from a date, with git: committed after the date, plus uncommitted now (backup-scope.js\'s rule)', (t) => {
  const dir = ws(t, { repo: true });
  put(dir, `${E}/old.md`, 'old\n');
  commit(dir, 'old', '2026-01-01T00:00:00Z');
  put(dir, `${E}/committed.md`, 'c\n');
  commit(dir, 'later', '2026-11-20T00:00:00Z');
  put(dir, `${E}/dirty.md`, 'd\n');
  put(dir, '.joserah/desk/crew/2026-11-26/x.md', 'log\n');
  assert.deepStrictEqual(list(dir, '--seed-since', '2026-11-01T00:00:00Z'), [`${E}/committed.md`, `${E}/dirty.md`]);
});

test('seed from a commit: exactly the in-scope files that differ from it', (t) => {
  const dir = ws(t, { repo: true });
  for (const n of ['a', 'b', 'c', 'gone']) put(dir, `${E}/${n}.md`, `${n}\n`);
  put(dir, '.joserah/desk/crew/x.md', 'log\n');
  const c1 = commit(dir, 'sweep');
  put(dir, `${E}/b.md`, 'b2\n');
  commit(dir, 'b changed');
  put(dir, `${E}/e.md`, 'e\n');
  commit(dir, 'e added');
  put(dir, `${E}/c.md`, 'c2\n');                 // uncommitted change
  put(dir, `${E}/d.md`, 'd\n');                  // untracked
  put(dir, '.joserah/desk/crew/x.md', 'log2\n'); // out of scope
  put(dir, '.joserah/desk/artifacts/y.md', 'y\n');
  fs.rmSync(path.join(dir, ...`${E}/gone.md`.split('/')));
  assert.deepStrictEqual(list(dir, '--seed-commit', c1), [`${E}/b.md`, `${E}/c.md`, `${E}/d.md`, `${E}/e.md`]);
  // seeded: the files that did not differ are "seen"; stamping settles the rest
  stamp(dir);
  assert.deepStrictEqual(list(dir), []);
  put(dir, `${E}/a.md`, 'a2\n');
  assert.deepStrictEqual(list(dir), [`${E}/a.md`]);
});

test('with a ledger the seed flags are ignored', (t) => {
  const dir = seeded(t, true, { [`${E}/a.md`]: 'a\n' });
  commit(dir, 'x');
  put(dir, `${E}/b.md`, 'b\n');
  assert.deepStrictEqual(list(dir, '--seed-since', EPOCH), [`${E}/b.md`]);
});

test('no ledger and no seed is refused (exit 2); a bad commit is refused; stamp without a list is refused', (t) => {
  const dir = ws(t, { repo: true });
  put(dir, `${E}/a.md`, 'a\n');
  assert.strictEqual(runTool('sweep-scope.js', [dir, 'list']).status, 2);
  assert.strictEqual(runTool('sweep-scope.js', [dir, 'list', '--seed-commit', 'nonesuch']).status, 2);
  assert.strictEqual(runTool('sweep-scope.js', [dir, 'list', '--seed-since', 'not-a-date']).status, 2);
  assert.strictEqual(runTool('sweep-scope.js', [dir, 'stamp']).status, 2);
  const plain = ws(t);
  assert.strictEqual(runTool('sweep-scope.js', [plain, 'list', '--seed-commit', 'HEAD']).status, 2);
  assert.strictEqual(runTool('sweep-scope.js', [path.join(plain, 'nowhere'), 'list']).status, 2);
});

test('the ledger lives under .joserah/desk and names every file once', (t) => {
  const dir = seeded(t, false, { [`${E}/a.md`]: 'a\n', [`${E}/b.md`]: 'b\n' });
  const led = JSON.parse(fs.readFileSync(ledgerFile(dir), 'utf8'));
  assert.deepStrictEqual(Object.keys(led.files).sort(), [`${E}/a.md`, `${E}/b.md`]);
  assert.ok(!('pending' in led), 'a stamped ledger holds no pending list');
});

test('seed from the last sweep: its own commit (made within ten minutes after the stamp) is the mark; otherwise the date rule', (t) => {
  const dir = ws(t, { repo: true });
  put(dir, `${E}/a.md`, 'a\n');
  commit(dir, 'before', '2026-06-01T09:00:00Z');
  put(dir, `${E}/b.md`, 'b, written by the sweep\n');
  put(dir, `${E}/a.md`, 'a, tidied by the sweep\n');
  commit(dir, 'workspace backup: sweep', '2026-06-01T10:00:09Z');      // 9 s after the stamp
  put(dir, `${E}/c.md`, 'c\n');
  commit(dir, 'later', '2026-06-05T00:00:00Z');
  put(dir, `${E}/d.md`, 'd\n');                                          // uncommitted
  // the stamp 10:00:00.971Z: the sweep's own commit is the seed, so only c and d are new
  assert.deepStrictEqual(list(dir, '--seed-last-sweep', '2026-06-01T10:00:00.971Z'), [`${E}/c.md`, `${E}/d.md`]);
});

test('seed from the last sweep: no commit within ten minutes means the date rule (everything committed after the stamp)', (t) => {
  const dir = ws(t, { repo: true });
  put(dir, `${E}/a.md`, 'a\n');
  commit(dir, 'before', '2026-06-01T09:00:00Z');
  put(dir, `${E}/b.md`, 'b\n');
  commit(dir, 'an hour later', '2026-06-01T11:00:00Z');
  put(dir, `${E}/d.md`, 'd\n');
  assert.deepStrictEqual(list(dir, '--seed-last-sweep', '2026-06-01T10:00:00Z'), [`${E}/b.md`, `${E}/d.md`]);
});

test('seed from the last sweep, no git: file times', (t) => {
  const dir = ws(t);
  put(dir, `${E}/old.md`, 'old\n');
  put(dir, `${E}/new.md`, 'new\n');
  const old = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(path.join(dir, ...`${E}/old.md`.split('/')), old, old);
  assert.deepStrictEqual(list(dir, '--seed-last-sweep', '2026-06-01T00:00:00Z'), [`${E}/new.md`]);
  assert.strictEqual(runTool('sweep-scope.js', [ws(t), 'list', '--seed-last-sweep', 'nonsense']).status, 2);
});

test('a seeded ledger that was never stamped lists the same files again, and what changed since; stamp then settles it', (t) => {
  const dir = ws(t, { repo: true });
  put(dir, `${E}/a.md`, 'a\n'); put(dir, `${E}/b.md`, 'b\n');
  const c1 = commit(dir, 'sweep');
  put(dir, `${E}/a.md`, 'a2\n');
  assert.deepStrictEqual(list(dir, '--seed-commit', c1), [`${E}/a.md`]);
  assert.deepStrictEqual(list(dir), [`${E}/a.md`], 'a bare list in the middle of a sweep is not "everything"');
  put(dir, `${E}/b.md`, 'b2\n');          // another session, meanwhile
  put(dir, `${E}/n.md`, 'n\n');
  assert.deepStrictEqual(list(dir), [`${E}/a.md`, `${E}/b.md`, `${E}/n.md`]);
  put(dir, `${E}/b.md`, 'b3' + String.fromCharCode(10));          // after the last list, before the stamp
  stamp(dir);
  assert.deepStrictEqual(list(dir), [`${E}/b.md`, `${E}/n.md`], 'stamped at what the seeded list saw: what came after is listed again, never lost');
});

test('stamp --wrote after the ledger is already settled adds what a late pass wrote, and nothing else', (t) => {
  const dir = seeded(t, false, { [`${E}/a.md`]: 'a\n', [`${E}/b.md`]: 'b\n' });
  put(dir, `${E}/a.md`, 'a, a later pass\n');      // written by the sweep after its stamp
  put(dir, `${E}/new.md`, 'new record\n');
  put(dir, `${E}/b.md`, 'b, by someone else\n');   // not named: stays listed
  stamp(dir, '--wrote', `${E}/a.md`, `${E}/new.md`);
  assert.deepStrictEqual(list(dir), [`${E}/b.md`]);
  assert.strictEqual(runTool('sweep-scope.js', [ws(t), 'stamp']).status, 2, 'no ledger at all is still refused');
});
