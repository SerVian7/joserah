import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Checkpointer, ChangedFile, JobRecord } from './jobs.ts';
import { writeAreaFor, ensureJobIgnores } from './jobs.ts';
import { RESTRICTED_TYPES, type JobType } from './config.ts';
import { rel } from './paths.ts';
import type { Store } from './store.ts';

/** Paths a general job may not write without the owner looking: an owner row is raised for each. */
export const PROTECTED = ['imports/**', 'keys/**', '.joserah/config.json', '.joserah/server.json', '.claude/**', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', '.gitignore'];
/** The server's own writes while a job runs (records, Tracker rows): never the job's work. */
export const SERVER_WRITES = ['.joserah/desk/jobs/**', '.joserah/desk/artifacts/**'];
const JOB_RECORDS = '.joserah/desk/jobs/**';
const MANIFEST_LIMIT = 20000;
/** Folders git does not see (ignored): watched by size and mtime, contents never read. */
// keys/ first: it is small and protected, so a large imports/ cannot push it past MANIFEST_LIMIT.
const UNTRACKED_WATCH = ['keys', 'imports'];
const LOCK_WAIT_MS = 500;

/** `dir/**` is the folder and everything under it; anything else is an exact path. */
export function matches(glob: string, p: string): boolean {
  if (glob.endsWith('/**')) { const d = glob.slice(0, -3); return p === d || p.startsWith(`${d}/`); }
  return p === glob;
}

/** One flag per deletion and per write outside the type's area (restricted types) or into a protected path (others). */
export function assess(type: JobType, changed: ChangedFile[]): string[] {
  const flags: string[] = [];
  const area = writeAreaFor(type);
  for (const c of changed) {
    if (SERVER_WRITES.some((g) => matches(g, c.path))) continue;
    if (c.status === 'D') { flags.push(`deleted ${c.path}`); continue; }
    const outside = RESTRICTED_TYPES.includes(type) ? !area.some((a) => matches(`${a}/**`, c.path)) : PROTECTED.some((g) => matches(g, c.path));
    if (outside) flags.push(`wrote outside its area: ${c.path}`);
  }
  return flags;
}

const ID = ['-c', 'user.name=Joserah Server', '-c', 'user.email=server@joserah.invalid'];
const first = (s: string | null | undefined) => (s ?? '').trim().split(/\r?\n/)[0] ?? '';
const real = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * Before a job: commit the workspace as it stands (the owner's pending work included), a point to return to.
 * After it: the files the job changed — git for tracked and untracked files, a size-and-mtime manifest for
 * `imports/`, which is outside git — and the flags `assess` raises on them.
 */
export class GitCheckpointer implements Checkpointer {
  #ws: string;
  #imports = new Map<string, Map<string, string>>();
  // The server's own uploads since the oldest running job began; each job remembers where in the log it started.
  #own: string[] = [];
  #marks = new Map<string, number>();
  constructor(workspace: string, store?: Store) {
    this.#ws = workspace;
    store?.onImport((p) => { if (this.#marks.size) this.#own.push(p); });
  }

  // Hooks run (never --no-verify); a hook that hangs must not hold the server forever.
  #git(...args: string[]) { return spawnSync('git', [...ID, ...args], { cwd: this.#ws, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 120000 }); }

  /** add/commit: a stale or racing `.git/index.lock` gets one more try after a short wait. */
  #gitRetry(...args: string[]) {
    let r = this.#git(...args);
    if (r.status !== 0 && /index.lock/.test(r.stderr ?? '')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS); r = this.#git(...args); }
    return r;
  }

  #manifest(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string) => {
      let es: fs.Dirent[]; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        if (out.size >= MANIFEST_LIMIT) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) { try { const s = fs.statSync(p); out.set(rel(this.#ws, p), `${s.size}:${Math.round(s.mtimeMs)}`); } catch { /* gone meanwhile */ } }
      }
    };
    for (const d of UNTRACKED_WATCH) walk(path.join(this.#ws, d));
    return out;
  }

  before(job: JobRecord): { ok: true; commit: string } | { ok: false; reason: string } {
    // The workspace must be a repository's top: inside someone else's repository the commit would land there.
    const top = this.#git('rev-parse', '--show-toplevel');
    const notRepo = { ok: false as const, reason: 'the workspace is not a git repository — the setup wizard can create one' };
    if (top.error) return { ok: false, reason: `git could not run: ${top.error.message}` };
    if (top.status !== 0) return /not a git repository/i.test(top.stderr ?? '') ? notRepo : { ok: false, reason: `checkpoint failed: ${first(top.stderr) || `git exit ${top.status}`}` };
    if (!same(real(top.stdout.trim()), real(this.#ws))) return notRepo;
    // The live job records keep the raw task text: they must be ignored before anything is committed.
    try { ensureJobIgnores(this.#ws); } catch (e) { return { ok: false, reason: `checkpoint failed: ${(e as Error).message}` }; }
    const add = this.#gitRetry('add', '-A');
    if (add.status !== 0) return { ok: false, reason: `checkpoint failed: ${first(add.stderr) || add.error?.message || 'git add'}` };
    const hasHead = this.#git('rev-parse', '--verify', '-q', 'HEAD').status === 0;
    const staged = this.#git('diff', '--cached', '--quiet').status !== 0;
    if (!hasHead || staged) { // nothing pending: HEAD is already the point to return to, no empty commit
      const c = this.#gitRetry('commit', '--allow-empty', '-q', '-m', `checkpoint: before job ${job.id}`, '-m', 'Joserah Server');
      if (c.status !== 0) return { ok: false, reason: `checkpoint commit failed: ${first(c.stderr) || first(c.stdout) || c.error?.message || `exit ${c.status}`}` };
    }
    const head = this.#git('rev-parse', 'HEAD');
    if (head.status !== 0) return { ok: false, reason: `checkpoint failed: ${first(head.stderr)}` };
    this.#imports.set(job.id, this.#manifest());
    this.#marks.set(job.id, this.#own.length);
    return { ok: true, commit: head.stdout.trim() };
  }

  after(job: JobRecord): { changed: ChangedFile[]; flags: string[] } {
    const changed: ChangedFile[] = [];
    // Taken first, so a throw below never leaves this job's state behind.
    const before = this.#imports.get(job.id); this.#imports.delete(job.id);
    const mark = this.#marks.get(job.id); this.#marks.delete(job.id);
    const own = new Set(mark === undefined ? [] : this.#own.slice(mark));
    if (!this.#marks.size) this.#own = [];
    if (job.checkpoint) {
      const d = this.#git('diff', '--name-status', '--no-renames', '-z', job.checkpoint);
      if (d.status !== 0) throw new Error(`git diff: ${first(d.stderr) || d.error?.message}`);
      const parts = d.stdout.split('\0').filter(Boolean);
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const s = parts[i][0];
        changed.push({ status: s === 'A' || s === 'D' ? s : 'M', path: parts[i + 1] }); // T (type change), U: modified
      }
      const o = this.#git('ls-files', '--others', '--exclude-standard', '-z');
      if (o.status !== 0) throw new Error(`git ls-files: ${first(o.stderr) || o.error?.message}`);
      for (const p of o.stdout.split('\0').filter(Boolean)) changed.push({ status: 'A', path: p });
    }
    if (before) {
      const now = this.#manifest();
      for (const [p, sig] of now) if (!before.has(p)) changed.push({ status: 'A', path: p }); else if (before.get(p) !== sig) changed.push({ status: 'M', path: p });
      // A full manifest may have been cut at the limit: a path missing then is unknown, not deleted.
      if (now.size < MANIFEST_LIMIT) for (const p of before.keys()) if (!now.has(p)) changed.push({ status: 'D', path: p });
    }
    // The job records are the server's own bookkeeping, never the job's work; one entry per path.
    const seen = new Set<string>();
    const out = changed.filter((c) => !matches(JOB_RECORDS, c.path) && !own.has(c.path) && !seen.has(c.path) && !!seen.add(c.path));
    return { changed: out, flags: assess(job.type, out) };
  }
}
