import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { EventBus, BusEvent } from './events.ts';
import { rel } from './paths.ts';
import { answersLib, type AnswerDoc } from './cjs.ts';

export class OutsideWorkspace extends Error {
  constructor(relPath: string) { super(`outside the workspace: ${JSON.stringify(relPath)}`); this.name = 'OutsideWorkspace'; }
}
const ANSWERS_RE = /^\.joserah\/desk\/artifacts\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/answers\.json$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.lint-cache']);
const MAX_FILES = 5000;

function eventFor(p: string): BusEvent {
  const m = ANSWERS_RE.exec(p);
  return m ? { type: 'answers', page: `${m[1]}/${m[2]}` } : { type: 'changed', path: p };
}

function renameRetry(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 6 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) { fs.rmSync(from, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1)); // Windows: a reader holds the file
    }
  }
}

/**
 * The only file writer inside the server process: atomic writes, a change event on each of its own writes,
 * and an mtime poll over `pollDirs` for edits made elsewhere (a terminal session, a tool run by a job).
 * The first `pollOnce()` reports every existing file; `start()` runs it before any browser subscribes.
 */
export class Store {
  readonly root: string;
  #bus: EventBus;
  #seen = new Map<string, number>();
  #pollMs: number;
  #pollDirs: () => string[];
  #timer: NodeJS.Timeout | null = null;

  constructor(root: string, bus: EventBus, opts: { pollMs?: number; pollDirs?: () => string[] } = {}) {
    this.root = path.resolve(root);
    this.#bus = bus;
    this.#pollMs = opts.pollMs ?? 2000;
    this.#pollDirs = opts.pollDirs ?? (() => ['.joserah/desk/artifacts', '.joserah/knowledge']);
  }

  /** The absolute path of a workspace-relative, forward-slash path; throws OutsideWorkspace for anything that could leave it. */
  abs(relPath: string): string {
    if (!relPath || relPath.includes('\\') || relPath.includes('\0') || path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) throw new OutsideWorkspace(relPath);
    if (relPath.split('/').some((s) => s === '..')) throw new OutsideWorkspace(relPath);
    const p = path.resolve(this.root, relPath);
    const r = path.relative(this.root, p);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new OutsideWorkspace(relPath);
    return p;
  }

  read(relPath: string): string | null { try { return fs.readFileSync(this.abs(relPath), 'utf8'); } catch (e) { if (e instanceof OutsideWorkspace) throw e; return null; } }
  readJson<T>(relPath: string): T | null { const t = this.read(relPath); if (t === null) return null; try { return JSON.parse(t.replace(/^﻿/, '')) as T; } catch { return null; } }

  write(relPath: string, data: string | Uint8Array): void {
    const p = this.abs(relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try { fs.writeFileSync(tmp, data); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    renameRetry(tmp, p);
    this.#changed(p);
  }
  writeJson(relPath: string, value: unknown): void { this.write(relPath, JSON.stringify(value, null, 2) + '\n'); }
  /**
   * Appends without an event: job logs append one line per stream event and would flood the bus ring.
   * Inside the poll dirs the next `pollOnce()` reports the file once, however many lines were added.
   */
  append(relPath: string, text: string): void {
    const p = this.abs(relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, text);
  }
  remove(relPath: string): void {
    const p = this.abs(relPath);
    if (!fs.existsSync(p)) return;
    fs.rmSync(p, { force: true });
    this.#changed(p);
  }

  /** Copies bytes under `imports/` without ever overwriting; returns the path actually used (` (2)`, ` (3)` before the extension). */
  importVerbatim(bytes: Uint8Array, relPath: string): string {
    if (!relPath.startsWith('imports/')) throw new OutsideWorkspace(relPath);
    this.abs(relPath);
    const ext = path.posix.extname(relPath); const stem = relPath.slice(0, relPath.length - ext.length);
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? relPath : `${stem} (${n})${ext}`;
      const p = this.abs(candidate);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      try { fs.writeFileSync(p, bytes, { flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
      this.#remember(rel(this.root, p), p);
      return rel(this.root, p);
    }
    throw new Error(`no free name for ${relPath}`);
  }

  /**
   * The owner's answer from a page (`page` is "<day>/<folder>"), merged by tools/lib/answers.js under the lock the terminal
   * takes too; owner writes only, so an assistant reply is never replaced. Published once as an `answers` event.
   * Throws when the library does (lock held too long or taken over, an unreadable file): the route answers JSON.
   */
  putAnswer(page: string, id: string, doc: unknown): { ok: true; doc: AnswerDoc } | { ok: false; code: string } {
    if (!/^\d{4}-\d{2}-\d{2}\/[^/\\]+$/.test(page)) return { ok: false, code: 'bad-page' };
    const relFile = `.joserah/desk/artifacts/${page}/answers.json`;
    const file = this.abs(relFile);
    const r = answersLib.put(path.dirname(file), id, doc, 'owner');
    if (r.ok) { this.#remember(relFile, file); this.#bus.publish({ type: 'answers', page }); }
    return r.ok ? { ok: true, doc: r.doc } : r;
  }

  /** Records the Store's own write so the poll does not report it again, then publishes it once. */
  #changed(abs: string): void {
    const key = rel(this.root, abs);
    this.#remember(key, abs);
    this.#bus.publish(eventFor(key));
  }
  #remember(key: string, abs: string): void { try { this.#seen.set(key, fs.statSync(abs).mtimeMs); } catch { this.#seen.delete(key); } }

  #walk(dir: string, out: Map<string, number>): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.size >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) this.#walk(p, out); continue; }
      if (!e.isFile() || e.name.endsWith('.tmp')) continue;
      try { out.set(rel(this.root, p), fs.statSync(p).mtimeMs); } catch { /* vanished between list and stat */ }
    }
  }

  /** Workspace-relative paths under the poll dirs that changed, appeared or vanished since the last look; each is published. */
  pollOnce(): string[] {
    const now = new Map<string, number>();
    const dirs = this.#pollDirs().map((d) => d.replace(/\/+$/, ''));
    for (const d of dirs) this.#walk(path.join(this.root, d), now);
    const under = (p: string) => dirs.some((d) => p.startsWith(d + '/'));
    const changed: string[] = [];
    for (const [p, m] of now) if (this.#seen.get(p) !== m) changed.push(p);
    // A walk cut short at MAX_FILES says nothing about the files it did not reach: never report those as deleted.
    if (now.size < MAX_FILES) for (const p of this.#seen.keys()) if (!now.has(p) && under(p)) changed.push(p);
    const kept = now.size < MAX_FILES ? [...this.#seen].filter(([p]) => !under(p)) : [...this.#seen];
    this.#seen = new Map([...kept, ...now]);
    for (const p of changed) this.#bus.publish(eventFor(p));
    return changed;
  }

  start(): void { if (this.#timer) return; this.pollOnce(); this.#timer = setInterval(() => this.pollOnce(), this.#pollMs); this.#timer.unref(); }
  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}
