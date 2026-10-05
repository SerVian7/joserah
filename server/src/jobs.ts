import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Engine, EngineEvent, EngineJob, EngineRun } from './engine.ts';
import type { Store } from './store.ts';
import type { EventBus, JobEventView } from './events.ts';
import { JOB_TYPES, RESTRICTED_TYPES, modelFor, type JobType, type ServerConfig } from './config.ts';
import { localDay, hhmm, now } from './paths.ts';
import { redactions } from './cjs.ts';
import { composeBrief } from './briefs.ts';
import { roleFor, JOB_TEXT, type TrackerBridge } from './tracker-bridge.ts';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'needs-approval' | 'refused';
export interface ChangedFile { status: 'A' | 'M' | 'D' | 'R'; path: string }
export interface JobRecord {
  id: string; day: string; type: JobType; target: 'server'; text: string; state: JobState;
  createdAt: string; startedAt?: string; endedAt?: string; model: string; budgetUsd: number; rowTitle: string;
  parentId?: string; resumeSessionId?: string; allowTools?: string[]; fallbackOf?: string; pointers?: string[];
  sessionId?: string; cliVersion?: string; turns: number; costUsd?: number | null; resultText?: string; error?: string;
  denials?: string[]; checkpoint?: string; changed?: ChangedFile[]; flags?: string[]; overlap?: boolean;
}
export interface SubmitInput { type?: string; text: string; parentId?: string; resumeSessionId?: string; allowTools?: string[]; pointers?: string[]; fallbackOf?: string; budgetUsd?: number; model?: string }
export class Refused extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface Checkpointer {
  before(job: JobRecord): { ok: true; commit: string } | { ok: false; reason: string };
  after(job: JobRecord): { changed: ChangedFile[]; flags: string[] };
}
export const noCheckpoint: Checkpointer = { before: () => ({ ok: true, commit: '' }), after: () => ({ changed: [], flags: [] }) };
export interface RunnerOptions { workspace: string; store: Store; bus: EventBus; engine: Engine; config: () => ServerConfig; tracker: TrackerBridge; checkpoint?: Checkpointer; jobUrl: (id: string) => string; lang: 'tr' | 'en' }

type Stop = 'cancel' | 'timeout' | 'turn-limit' | 'shutdown';
const END: readonly JobState[] = ['done', 'failed', 'cancelled', 'interrupted', 'needs-approval', 'refused'];
const redact = (s: string) => redactions.redact(s).text;
const firstLine = (s: string) => s.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? '';
export const jobsDir = (day: string) => `.joserah/desk/jobs/${day}`;
export function writeAreaFor(type: JobType): string[] { return type === 'ingest' ? ['.joserah/knowledge'] : type === 'lint' ? ['.joserah/knowledge/.lint'] : []; }

const IGNORES = ['.joserah/desk/jobs/**/*.jsonl', '.joserah/desk/jobs/**/*.job.json'];
export function ensureJobIgnores(workspace: string): boolean {
  // Only a real workspace: on an empty Docker volume the scaffold must write .gitignore first (its secret rules).
  if (!fs.existsSync(path.join(workspace, '.joserah', 'config.json'))) return false;
  const p = path.join(workspace, '.gitignore');
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORES.filter((l) => !have.has(l));
  if (!missing.length) return false;
  fs.writeFileSync(p, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# Joserah server: raw job logs and live job records stay out of the backup\n${missing.join('\n')}\n`);
  return true;
}

export function rotateLogs(store: Store, days: number, today: Date = now()): string[] {
  const base = store.abs('.joserah/desk/jobs');
  const limit = localDay(new Date(today.getTime() - days * 86400000));
  const gone: string[] = [];
  let dayDirs: string[] = [];
  try { dayDirs = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < limit); } catch { return gone; }
  for (const d of dayDirs) for (const f of fs.readdirSync(path.join(base, d)).filter((n) => n.endsWith('.jsonl'))) {
    store.remove(`.joserah/desk/jobs/${d}/${f}`); gone.push(`.joserah/desk/jobs/${d}/${f}`);
  }
  return gone;
}

export class JobRunner {
  #o: RunnerOptions;
  #jobs = new Map<string, JobRecord>();
  #queue: string[] = [];
  #active = new Set<string>();
  #live = new Map<string, { run: EngineRun; stop?: Stop }>();
  #stopping = false;
  #idleWaiters: Array<() => void> = [];
  #ends: Array<(job: JobRecord) => void> = [];
  constructor(o: RunnerOptions) { this.#o = o; }

  onEnd(fn: (job: JobRecord) => void): void { this.#ends.push(fn); }
  get(id: string): JobRecord | undefined { return this.#jobs.get(id); }
  list(day?: string): JobRecord[] { return [...this.#jobs.values()].filter((j) => !day || j.day === day).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  /** The CLI's own cost estimate summed over today's jobs. */
  todayCostUsd(): number {
    const day = localDay();
    return Math.round([...this.#jobs.values()].filter((j) => j.day === day).reduce((s, j) => s + (typeof j.costUsd === 'number' ? j.costUsd : 0), 0) * 1e6) / 1e6;
  }
  running(): JobRecord[] { return [...this.#jobs.values()].filter((j) => j.state === 'running'); }
  logTail(id: string, n = 200): unknown[] {
    const j = this.#jobs.get(id); if (!j) return [];
    const text = this.#o.store.read(`${jobsDir(j.day)}/${j.id}.jsonl`) ?? '';
    return text.trim().split('\n').slice(-n).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  }

  submit(input: SubmitInput): JobRecord {
    const type = (input.type ?? 'task') as JobType;
    if (this.#stopping) throw new Refused('stopping', 'the server is stopping; start the job again once it is back');
    if (!(JOB_TYPES as readonly string[]).includes(type)) throw new Refused('bad-type', `unknown job type: ${input.type}`);
    const text = String(input.text ?? '').trim();
    if (!text || text.length > 8000) throw new Refused('bad-text', 'a job needs a text of 1 to 8000 characters');
    if (!fs.existsSync(path.join(this.#o.workspace, '.joserah', 'config.json'))) throw new Refused('no-workspace', 'there is no workspace here yet — finish the setup wizard first');
    const cfg = this.#o.config();
    const spent = this.todayCostUsd();
    if (spent >= cfg.dailyBudgetUsd) throw new Refused('daily-budget', `today's estimated spend $${spent.toFixed(2)} has reached the daily cap $${cfg.dailyBudgetUsd.toFixed(2)}; jobs start again tomorrow or after the cap is raised in server.json`);
    const t = now();
    const id = `j-${localDay(t).replaceAll('-', '')}-${hhmm(t).replace(':', '')}-${crypto.randomBytes(3).toString('hex')}`;
    const job: JobRecord = { id, day: localDay(t), type, target: 'server', text, state: 'queued', createdAt: t.toISOString(),
      model: input.model ?? modelFor(cfg, type), budgetUsd: input.budgetUsd ?? cfg.jobBudgetUsd, rowTitle: this.#titleFor(text, t), turns: 0,
      parentId: input.parentId, resumeSessionId: input.resumeSessionId, allowTools: input.allowTools, fallbackOf: input.fallbackOf, pointers: input.pointers };
    this.#jobs.set(id, job);
    this.#save(job);
    this.#o.tracker.row({ title: job.rowTitle, state: 'wait', small: JOB_TEXT[this.#o.lang].queued, url: this.#o.jobUrl(id), label: JOB_TEXT[this.#o.lang].page });
    this.#queue.push(id);
    this.#o.bus.publish({ type: 'jobs' });
    queueMicrotask(() => this.#pump());
    return job;
  }

  reply(id: string, text: string): JobRecord {
    const p = this.#jobs.get(id);
    if (!p) throw new Refused('not-found', `no job ${id}`);
    if (!p.sessionId) return this.submit({ type: p.type, text, parentId: id, pointers: [`${jobsDir(p.day)}/${p.id}.md`] });
    return this.submit({ type: p.type, text, parentId: id, resumeSessionId: p.sessionId });
  }

  approve(id: string): JobRecord {
    const p = this.#jobs.get(id);
    if (!p) throw new Refused('not-found', `no job ${id}`);
    if (RESTRICTED_TYPES.includes(p.type)) throw new Refused('restricted', `${p.type} jobs keep their fixed tools`);
    if (p.state !== 'needs-approval' || !p.denials?.length) throw new Refused('not-waiting', 'this job is not waiting for an approval');
    if ([...this.#jobs.values()].some((j) => j.parentId === id && j.allowTools?.length)) throw new Refused('already-approved', 'this approval was already given');
    return this.submit({ type: p.type, text: `The owner allowed: ${p.denials.join(', ')}. Continue the job.`, parentId: id, resumeSessionId: p.sessionId, allowTools: p.denials });
  }

  async cancel(id: string): Promise<JobRecord | undefined> {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    if (job.state === 'queued') {
      this.#queue = this.#queue.filter((q) => q !== id);
      job.state = 'cancelled'; job.endedAt = now().toISOString();
      this.#save(job); this.#digest(job); this.#closeRow(job); this.#o.bus.publish({ type: 'jobs' });
      return job;
    }
    const live = this.#live.get(id);
    if (live) { live.stop = 'cancel'; await live.run.cancel(); }
    return job;
  }

  recover(): void {
    const base = this.#o.store.abs('.joserah/desk/jobs');
    let days: string[] = [];
    try { days = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-7); } catch { /* no jobs yet */ }
    const queued: JobRecord[] = [];
    for (const d of days) for (const f of fs.readdirSync(path.join(base, d)).filter((n) => n.endsWith('.job.json'))) {
      const job = this.#o.store.readJson<JobRecord>(`${jobsDir(d)}/${f}`);
      if (!job?.id) continue;
      this.#jobs.set(job.id, job);
      if (job.state === 'running') {
        job.state = 'interrupted'; job.error = 'the server restarted while the job ran'; job.endedAt = now().toISOString();
        this.#save(job); this.#digest(job); this.#closeRow(job);
        this.#o.tracker.crew({ role: roleFor(job.type), job: job.rowTitle, state: 'idle' });
      } else if (job.state === 'queued') queued.push(job);
    }
    this.#queue.push(...queued.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((j) => j.id));
    this.#pump();
  }

  /**
   * The server is stopping (Ctrl+C, `docker restart`): no new job starts, each running one is stopped by its process
   * tree and ends `interrupted` with an owner row; queued jobs stay queued on disk for the next start's recover().
   */
  async shutdown(): Promise<void> {
    this.#stopping = true;
    this.#queue = [];
    await Promise.all([...this.#live.values()].map((live) => { if (!live.stop) live.stop = 'shutdown'; return live.run.cancel(); }));
    if (this.#active.size) await this.idle();
  }

  idle(): Promise<void> { return this.#isIdle() ? Promise.resolve() : new Promise((r) => this.#idleWaiters.push(r)); }
  #isIdle(): boolean { return this.#queue.length === 0 && this.#active.size === 0; }
  #checkIdle(): void { if (this.#isIdle()) for (const w of this.#idleWaiters.splice(0)) w(); }

  #titleFor(text: string, t: Date): string {
    const short = redact(text).replace(/\s+/g, ' ').slice(0, 70);
    const base = `${short}${text.length > 70 ? '…' : ''} · ${hhmm(t)}`;
    const taken = new Set([...this.#jobs.values()].filter((j) => j.day === localDay(t)).map((j) => j.rowTitle.toLowerCase()));
    let title = base; for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${base} (${n})`;
    return title;
  }

  #save(job: JobRecord): void { this.#o.store.writeJson(`${jobsDir(job.day)}/${job.id}.job.json`, job); }
  #emit(job: JobRecord, event: JobEventView): void { this.#o.bus.publish({ type: 'job', id: job.id, event }); }

  #pump(): void {
    const max = this.#o.config().maxConcurrentJobs;
    while (!this.#stopping && this.#active.size < max && this.#queue.length) {
      const id = this.#queue.shift()!;
      const job = this.#jobs.get(id);
      if (!job || job.state !== 'queued') continue;
      this.#active.add(id);
      if (this.#active.size > 1) for (const a of this.#active) { const j = this.#jobs.get(a); if (j) j.overlap = true; }
      void this.#run(job).catch((e: Error) => {
        job.state = 'failed'; job.error = `server error: ${e.message}`;
        try { this.#finish(job); } catch (e2) { process.stderr.write(`jobs: ${job.id}: ${(e2 as Error).message}
`); }
      })
        .finally(() => { this.#active.delete(id); this.#pump(); this.#checkIdle(); });
    }
    this.#checkIdle();
  }

  async #run(job: JobRecord): Promise<void> {
    const cp = (this.#o.checkpoint ?? noCheckpoint).before(job);
    if (!cp.ok) { job.state = 'refused'; job.error = cp.reason; return this.#finish(job); }
    job.checkpoint = cp.commit || undefined;
    job.state = 'running'; job.startedAt = now().toISOString();
    this.#save(job);
    const T = JOB_TEXT[this.#o.lang];
    this.#o.tracker.row({ title: job.rowTitle, state: 'run', small: T.running, url: this.#o.jobUrl(job.id), label: T.page });
    this.#o.tracker.crew({ role: roleFor(job.type), job: job.rowTitle, state: 'work', row: job.rowTitle });
    this.#emit(job, { kind: 'state', state: 'running' });
    const cfg = this.#o.config();
    const ej: EngineJob = { id: job.id, type: job.type, target: 'server', model: job.model, cwd: this.#o.workspace, budgetUsd: job.budgetUsd,
      brief: job.resumeSessionId ? job.text : composeBrief({ task: job.text, type: job.type, pointers: job.pointers }),
      resumeSessionId: job.resumeSessionId, restricted: RESTRICTED_TYPES.includes(job.type), writeArea: writeAreaFor(job.type), allowTools: job.allowTools };
    const run = this.#o.engine.start(ej);
    const live: { run: EngineRun; stop?: Stop } = { run };
    this.#live.set(job.id, live);
    const timer = setTimeout(() => { if (!live.stop) { live.stop = 'timeout'; void run.cancel(); } }, cfg.jobTimeoutMin * 60000);
    const log = `${jobsDir(job.day)}/${job.id}.jsonl`;
    let result: Extract<EngineEvent, { kind: 'result' }> | null = null;
    const denied = new Set<string>();
    let stderr = '';
    let exit: Awaited<EngineRun['done']>;
    try {
      for await (const { raw, event } of run.events) {
        if (event.kind === 'init' && !job.sessionId) { job.sessionId = event.sessionId; job.cliVersion = event.cliVersion; this.#save(job); }
        if (raw) this.#o.store.append(log, redact(raw) + '\n');
        if (event.kind === 'stderr') { stderr += event.text; this.#o.store.append(log, JSON.stringify({ type: 'stderr', text: redact(event.text) }) + '\n'); }
        else if (event.kind === 'text') this.#emit(job, { kind: 'text', text: redact(event.text) });
        else if (event.kind === 'tool') this.#emit(job, { kind: 'tool', name: event.name });
        else if (event.kind === 'turn') { job.turns += 1; if (job.turns > cfg.jobMaxTurns && !live.stop) { live.stop = 'turn-limit'; void run.cancel(); } }
        else if (event.kind === 'denied') denied.add(event.tool);
        else if (event.kind === 'result') { result = event; for (const d of event.denials) denied.add(d); }
      }
      clearTimeout(timer); // the stream closed with the process: a late timer must not rename a finished job
      exit = await run.done;
    } catch (e) {
      void run.cancel(); // a write failed mid-stream: never leave the CLI running unwatched
      throw e;
    } finally {
      clearTimeout(timer); this.#live.delete(job.id);
    }
    const r = result as Extract<EngineEvent, { kind: 'result' }> | null;
    job.denials = [...denied];
    job.costUsd = r?.costUsd ?? null;
    job.resultText = redact(r?.text ?? '');
    if (live.stop === 'cancel') job.state = 'cancelled';
    else if (live.stop === 'shutdown') { job.state = 'interrupted'; job.error = 'the server stopped while the job ran'; }
    else if (live.stop === 'timeout') { job.state = 'failed'; job.error = `timeout after ${cfg.jobTimeoutMin} min`; }
    else if (live.stop === 'turn-limit') { job.state = 'failed'; job.error = `turn limit ${cfg.jobMaxTurns} reached`; }
    else if (exit.spawnError) { job.state = 'failed'; job.error = `could not start Claude Code: ${exit.spawnError}`; }
    else if (!r) { job.state = 'failed'; job.error = redact(firstLine(stderr)) || `ended without a result (exit ${exit.code})`; }
    else if (r.subtype === 'error_max_budget_usd') { job.state = 'failed'; job.error = `money cap $${job.budgetUsd.toFixed(2)} reached`; }
    else if (denied.size) job.state = 'needs-approval';
    else if (!r.ok) { job.state = 'failed'; job.error = r.subtype || 'error'; }
    else job.state = 'done';
    this.#finish(job);
    // Only a resume that never started a session falls back; a timeout, a cancel or a missing CLI would fail again.
    if (job.state === 'failed' && !live.stop && !exit.spawnError && job.resumeSessionId && !job.sessionId && !job.fallbackOf && job.parentId && !this.#stopping) {
      const p = this.#jobs.get(job.parentId);
      try { this.submit({ type: job.type, text: job.text, fallbackOf: job.id, parentId: job.parentId, pointers: p ? [`${jobsDir(p.day)}/${p.id}.md`] : [] }); }
      catch (e) { if (!(e instanceof Refused)) throw e; job.error = `${job.error ?? ''}; fallback not started: ${e.message}`; this.#save(job); this.#digest(job); }
    }
  }

  #finish(job: JobRecord): void {
    if (job.startedAt) { // a job that never started has nothing to diff
      try { const a = (this.#o.checkpoint ?? noCheckpoint).after(job); job.changed = a.changed; job.flags = [...(job.flags ?? []), ...a.flags]; }
      catch (e) { job.flags = [...(job.flags ?? []), `changed-file check failed: ${(e as Error).message}`]; }
    }
    job.endedAt = now().toISOString();
    for (const fn of this.#ends) { try { fn(job); } catch (e) { job.flags = [...(job.flags ?? []), `bookkeeping failed: ${(e as Error).message}`]; } }
    this.#save(job); this.#digest(job); this.#closeRow(job);
    this.#o.tracker.crew({ role: roleFor(job.type), job: job.rowTitle, state: 'idle' });
    this.#emit(job, { kind: 'result', ok: job.state === 'done', text: job.resultText || job.error || '', costUsd: job.costUsd ?? null });
    this.#o.bus.publish({ type: 'jobs' });
  }

  #closeRow(job: JobRecord): void {
    const T = JOB_TEXT[this.#o.lang];
    const url = this.#o.jobUrl(job.id);
    const cost = typeof job.costUsd === 'number' ? ` · ${T.cost} $${job.costUsd.toFixed(4)}` : '';
    let state: 'ok' | 'you' = 'you'; let small: string;
    if (job.state === 'done' && job.flags?.length) small = `${T.check}: ${job.flags.slice(0, 3).join('; ')}. ${T.checkNext}`;
    else if (job.state === 'done' && !job.resultText) small = T.empty;
    else if (job.state === 'done') { state = 'ok'; small = `${firstLine(job.resultText ?? '')}${cost}`; }
    else if (job.state === 'needs-approval') small = `${T.approval}: ${(job.denials ?? []).join(', ')}. ${T.approvalNext}`;
    else if (job.state === 'interrupted') small = T.interrupted;
    else if (job.state === 'cancelled') small = T.cancelled;
    else small = `${T.stopped}: ${job.error ?? job.state}. ${T.next}`;
    this.#o.tracker.row({ title: job.rowTitle, state, small, url, label: T.page });
  }

  #digest(job: JobRecord): void {
    const lines = [`# Job ${job.id}`, '',
      `- Task: ${redact(job.text).replace(/\s+/g, ' ').slice(0, 300)}`,
      `- Type: ${job.type} · model ${job.model} · target ${job.target}${job.parentId ? ` · follows ${job.parentId}` : ''}`,
      `- State: ${job.state}${job.error ? ` — ${job.error}` : ''}`,
      `- Started: ${job.startedAt ?? '-'} · ended: ${job.endedAt ?? '-'} · tool turns: ${job.turns}`,
      `- Result: ${(job.resultText ?? '').replace(/\s+/g, ' ').slice(0, 1000) || '-'}`,
      `- Changed files: ${job.changed?.length ? job.changed.map((c) => `${c.status} ${c.path}`).join(', ') : 'none'}`,
      ...(job.flags?.length ? [`- Flags: ${job.flags.join('; ')}`] : []),
      `- Cost estimate: ${typeof job.costUsd === 'number' ? `$${job.costUsd.toFixed(4)} (CLI estimate)` : 'unknown'}`,
      `- Claude Code: ${job.cliVersion ?? 'unknown'}`, `- Session: ${job.sessionId ?? '-'}`, ''];
    this.#o.store.write(`${jobsDir(job.day)}/${job.id}.md`, lines.join('\n'));
  }
}
