import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './store.ts';
import type { EventBus } from './events.ts';
import { rotateLogs, type JobRunner, type JobRecord } from './jobs.ts';
import type { TrackerBridge } from './tracker-bridge.ts';
import type { ServerConfig } from './config.ts';
import { wikiLib, type WikiFinding } from './cjs.ts';
import { rebuildIndex, appendLog } from './wiki-books.ts';
import { localDay, hhmm, now } from './paths.ts';

const K = '.joserah/knowledge';
const LATEST = '.joserah/desk/lint/latest.json';
const HASHES = '.joserah/desk/lint/hashes.json';
const CONFLICTS = `${K}/.lint/conflicts.json`;

const TEXT = {
  tr: {
    conflict: (a: string, b: string) => `Wiki çelişkisi: ${a} ile ${b}`,
    conflictNext: 'Sonraki: hangisinin doğru olduğuna karar verin; diğeri superseded: ile üstü çizilir.',
    unreadable: 'Wiki denetim çıktısı okunamadı',
    unreadableSmall: 'Model denetimi sunucunun okuyamadığı bir çelişki dosyası yazdı; hiçbir sayfa denetlenmiş sayılmadı. Sonraki: .joserah/knowledge/.lint/conflicts.json dosyasına bakın, sonra denetimi yeniden çalıştırın.',
  },
  en: {
    conflict: (a: string, b: string) => `Wiki conflict: ${a} vs ${b}`,
    conflictNext: 'Next: decide which holds; the other gets struck with superseded:.',
    unreadable: 'Wiki check output unreadable',
    unreadableSmall: 'The model check wrote a conflicts file the server could not read; nothing was marked as checked. Next: look at .joserah/knowledge/.lint/conflicts.json, then run the check again.',
  },
};

/** Milliseconds until the next local `HH:MM`: today when still ahead, else tomorrow. */
export function msUntil(at: string, from: Date): number {
  const [h, m] = at.split(':').map(Number);
  const next = new Date(from); next.setHours(h, m, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - from.getTime();
}

export interface LintOptions { workspace: string; stateDir: string; store: Store; bus: EventBus; jobs: JobRunner; tracker: TrackerBridge; config: () => ServerConfig; lang: 'tr' | 'en'; debounceMs?: number }

export class LintScheduler {
  #o: LintOptions;
  #pending = new Map<string, Record<string, string>>();
  #timer: NodeJS.Timeout | null = null;
  #night: NodeJS.Timeout | null = null;
  #off: (() => void) | null = null;
  constructor(o: LintOptions) {
    this.#o = o;
    o.jobs.onEnd((job) => this.#onEnd(job));
  }

  latest(): { at: string; findings: WikiFinding[] } | null { return this.#o.store.readJson(LATEST); }

  runDeterministic(): WikiFinding[] {
    if (!fs.existsSync(path.join(this.#o.workspace, '.joserah', 'config.json'))) return []; // an empty Docker volume before the wizard: write nothing
    const findings = wikiLib.lint(this.#o.workspace, { now: now() });
    const prev = this.latest();
    if (JSON.stringify(prev?.findings) !== JSON.stringify(findings)) this.#o.store.writeJson(LATEST, { at: now().toISOString(), findings });
    rebuildIndex(this.#o.store, this.#o.workspace);
    return findings;
  }

  /** Pages whose content differs from what the last finished model pass covered. */
  changedSet(): string[] {
    const seen = this.#o.store.readJson<Record<string, string>>(HASHES) ?? {};
    return wikiLib.scan(this.#o.workspace).filter((p) => seen[p.rel] !== p.sha1).map((p) => p.rel);
  }

  /** The model pass: only over the changed set, one at a time (a second call while one is queued or running returns that job — B11). */
  runLlm(): JobRecord | null {
    for (const id of [...this.#pending.keys()]) {
      const live = this.#o.jobs.get(id);
      if (live && (live.state === 'queued' || live.state === 'running')) return live;
      this.#pending.delete(id);
    }
    const pages = wikiLib.scan(this.#o.workspace);
    const seen = this.#o.store.readJson<Record<string, string>>(HASHES) ?? {};
    const set = pages.filter((p) => seen[p.rel] !== p.sha1).map((p) => p.rel);
    if (!set.length) return null;
    this.#o.store.remove(CONFLICTS); // a file left by an earlier run is never read as this run's answer
    const job = this.#o.jobs.submit({ type: 'lint', text: `Check these ${set.length} wiki pages against each other and the rest of the wiki; quote any two sentences that contradict each other.`,
      pointers: set.map((r) => `${K}/${r}`) });
    this.#pending.set(job.id, Object.fromEntries(pages.map((p) => [p.rel, p.sha1])));
    return job;
  }

  #onEnd(job: JobRecord): void {
    if (job.type !== 'lint') return;
    const covered = this.#pending.get(job.id); this.#pending.delete(job.id);
    if (job.state !== 'done') return;
    const T = TEXT[this.#o.lang];
    // Invalid output fails closed (B3): a conflicts file the server cannot read is an owner row, never "no conflicts".
    const raw = this.#o.store.read(CONFLICTS);
    let parsed: unknown = [];
    try { parsed = raw === null ? [] : JSON.parse(raw); } catch { parsed = null; }
    if (!Array.isArray(parsed)) {
      this.#o.tracker.row({ title: `${T.unreadable} · ${hhmm()}`, state: 'you', small: T.unreadableSmall });
      return;
    }
    const list = parsed as Array<{ a?: { path?: string; quote?: string }; b?: { path?: string; quote?: string }; note?: string } | null>;
    for (const c of list) {
      const a = c?.a ?? {}; const b = c?.b ?? {};
      this.#o.tracker.row({ title: `${T.conflict(String(a.path ?? '?').slice(0, 120), String(b.path ?? '?').slice(0, 120))} · ${hhmm()}`, state: 'you',
        small: `"${String(a.quote ?? '').slice(0, 160)}" ↔ "${String(b.quote ?? '').slice(0, 160)}" — ${String(c?.note ?? '').slice(0, 160)}. ${T.conflictNext}` });
    }
    if (covered) this.#o.store.writeJson(HASHES, { ...(this.#o.store.readJson<Record<string, string>>(HASHES) ?? {}), ...covered });
    appendLog(this.#o.store, 'lint', `${list.length} conflict${list.length === 1 ? '' : 's'}`);
    if (list.length) this.#o.store.remove(CONFLICTS);
  }

  /** Once per local day (the lock is a file in the state directory, so a restart cannot run it twice). Returns whether it ran. */
  nightly(at: Date = now()): boolean {
    const lock = path.join(this.#o.stateDir, 'nightly.json');
    const day = localDay(at);
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).day === day) return false; } catch { /* first night */ }
    fs.mkdirSync(this.#o.stateDir, { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ day }));
    this.runDeterministic();
    rotateLogs(this.#o.store, this.#o.config().rawLogDays, at);
    if (this.#o.config().nightlyLlmLint) this.runLlm();
    return true;
  }

  start(): void {
    if (this.#off) return;
    const guarded = (name: string, fn: () => unknown) => { try { fn(); } catch (e) { console.error(`joserah: ${name} failed: ${(e as Error).message}`); } };
    this.#off = this.#o.bus.subscribe((_id, e) => {
      if (e.type !== 'changed' || !e.path.startsWith(`${K}/`) || e.path.startsWith(`${K}/.lint/`) || e.path === `${K}/wiki/index.md` || e.path === `${K}/wiki/log.md` || e.path === `${K}/sources.json`) return;
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { this.#timer = null; guarded('wiki lint', () => this.runDeterministic()); }, this.#o.debounceMs ?? 2000);
    });
    const t = now();
    if (hhmm(t) >= this.#o.config().nightlyAt) guarded('nightly lint', () => this.nightly(t)); // catch-up: past today's time — runs now unless the lock says it already ran today
    const arm = () => {
      this.#night = setTimeout(() => { guarded('nightly lint', () => this.nightly()); arm(); }, msUntil(this.#o.config().nightlyAt, now()));
      this.#night.unref();
    };
    arm();
  }

  stop(): void { this.#off?.(); this.#off = null; if (this.#timer) clearTimeout(this.#timer); this.#timer = null; if (this.#night) clearTimeout(this.#night); this.#night = null; }
}
