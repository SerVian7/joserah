import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assess, matches, GitCheckpointer } from '../src/checkpoint.ts';
import { runnerFor, git, tmpdir, tmpWorkspace } from './helpers.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const rowOf = (ws: string, title: string) => { const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8')); return (Array.isArray(j) ? j : j.rows).find((r: { title: string }) => r.title === title); };

test('assess: deletions and writes outside the area are flagged; server writes are not', () => {
  assert.ok(matches('imports/**', 'imports/a/b.pdf'));
  assert.ok(!matches('imports/**', 'importsx/a'));
  assert.ok(matches('AGENTS.md', 'AGENTS.md'));
  assert.deepEqual(assess('ingest', [{ status: 'A', path: '.joserah/knowledge/wiki/topics/x.md' }]), []);
  assert.deepEqual(assess('ingest', [{ status: 'M', path: 'notes/x.md' }]), ['wrote outside its area: notes/x.md']);
  assert.deepEqual(assess('task', [{ status: 'M', path: 'notes/x.md' }]), []);
  assert.deepEqual(assess('task', [{ status: 'M', path: 'AGENTS.md' }]), ['wrote outside its area: AGENTS.md']);
  assert.deepEqual(assess('task', [{ status: 'D', path: 'notes/x.md' }]), ['deleted notes/x.md']);
  assert.deepEqual(assess('task', [{ status: 'M', path: '.joserah/desk/jobs/2026-10-06/j.md' }, { status: 'M', path: '.joserah/desk/artifacts/2026-10-06/daily-tracker/rows.json' }]), []);
});

test('the checkpoint commits the owner\'s pending work before the job', (t) => {
  const { ws, runner } = runnerFor(t, { git: true });
  void runner;
  fs.writeFileSync(path.join(ws, 'pending.md'), 'unsaved work');
  const cp = new GitCheckpointer(ws);
  const r = cp.before({ id: 'j-1' } as never);
  assert.ok(r.ok);
  assert.match(git(ws, 'log', '-1', '--format=%an|%s'), /^Joserah Server\|checkpoint: before job j-1/);
  assert.equal(git(ws, 'status', '--porcelain'), '');
});

test('a deletion raises an owner row', async (t) => {
  const { ws, runner } = runnerFor(t, { git: true, env: { FAKE_CLAUDE_DELETE: 'notes-to-delete.md' }, checkpointer: true });
  fs.writeFileSync(path.join(ws, 'notes-to-delete.md'), 'x'); git(ws, 'add', '-A'); git(ws, 'commit', '-q', '-m', 'n');
  const job = runner.submit({ type: 'task', text: 'tidy' });
  await runner.idle();
  const j = runner.get(job.id)!;
  assert.equal(j.state, 'done');
  assert.ok(j.changed!.some((c) => c.status === 'D' && c.path === 'notes-to-delete.md'));
  assert.deepEqual(j.flags, ['deleted notes-to-delete.md']);
  const row = rowOf(ws, job.rowTitle);
  assert.equal(row.state, 'you');
  assert.match(row.small, /deleted notes-to-delete\.md/);
});

test('an ingest job writing outside the knowledge folder is flagged', async (t) => {
  const { runner } = runnerFor(t, { git: true, env: { FAKE_CLAUDE_WRITE: 'notes/escape.md:hi;.joserah/knowledge/wiki/topics/ok.md:fine' }, checkpointer: true });
  const job = runner.submit({ type: 'ingest', text: 'ingest x' });
  await runner.idle();
  const j = runner.get(job.id)!;
  assert.deepEqual(j.changed!.map((c) => c.path).filter((p) => !p.startsWith('.joserah/desk/')).sort(), ['.joserah/knowledge/wiki/topics/ok.md', 'notes/escape.md']);
  assert.deepEqual(j.flags, ['wrote outside its area: notes/escape.md']);
});

test('changes inside imports/ are seen although imports/ is not in git', async (t) => {
  const { ws, runner } = runnerFor(t, { git: true, env: { FAKE_CLAUDE_DELETE: 'imports/2026-10-01-upload/a.txt' }, checkpointer: true });
  fs.mkdirSync(path.join(ws, 'imports/2026-10-01-upload'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'imports/2026-10-01-upload/a.txt'), 'raw');
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.ok(runner.get(job.id)!.flags!.includes('deleted imports/2026-10-01-upload/a.txt'));
});

test('a workspace that is not a git repository refuses jobs with the reason', async (t) => {
  const { ws, runner } = runnerFor(t, { git: false, checkpointer: true });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  const j = runner.get(job.id)!;
  assert.equal(j.state, 'refused');
  assert.match(j.error!, /not a git repository/);
  assert.equal(rowOf(ws, job.rowTitle).state, 'you');
});

test('a workspace inside another repository is never checkpointed into that repository', (t) => {
  const outer = tmpdir(t);
  git(outer, 'init', '-q');
  fs.writeFileSync(path.join(outer, 'outer.md'), 'outer');
  git(outer, 'add', '-A'); git(outer, 'commit', '-q', '-m', 'outer');
  const ws = path.join(outer, 'ws');
  fs.cpSync(tmpWorkspace(t), ws, { recursive: true });
  const r = new GitCheckpointer(ws).before({ id: 'j-2' } as never);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /not a git repository/);
  assert.equal(git(outer, 'rev-list', '--count', 'HEAD').trim(), '1');
});

test('a clean workspace adds no empty commit, the job records stay out of git, and changes are listed once', async (t) => {
  const { ws, runner } = runnerFor(t, { git: true, env: { FAKE_CLAUDE_WRITE: 'notes/a.md:one' }, checkpointer: true });
  const cp = new GitCheckpointer(ws);
  const first = cp.before({ id: 'j-3' } as never); // commits the ignore lines for the job records
  assert.ok(first.ok);
  const head = git(ws, 'rev-parse', 'HEAD').trim();
  const again = cp.before({ id: 'j-4' } as never);
  assert.ok(again.ok);
  assert.equal((again as { commit: string }).commit, head);
  assert.equal(git(ws, 'rev-parse', 'HEAD').trim(), head);
  const job = runner.submit({ type: 'task', text: 'write a' });
  await runner.idle();
  const j = runner.get(job.id)!;
  assert.equal(j.state, 'done');
  const paths = j.changed!.map((c) => c.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('notes/a.md'));
  assert.ok(!paths.some((p) => p.startsWith('.joserah/desk/jobs/')));
  assert.equal(git(ws, 'ls-files', '.joserah/desk/jobs').trim(), '');
  assert.deepEqual(j.flags, []);
});
