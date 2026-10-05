import path from 'node:path';
import type { EventBus } from './events.ts';
import type { JobRunner, JobRecord } from './jobs.ts';
import type { ServerConfig } from './config.ts';
import { answersLib, type AnswerDoc } from './cjs.ts';
import { toolPath } from './paths.ts';
import { Refused } from './jobs.ts';

// An answer that only acknowledges needs no judgement (B11): it is marked read and starts no model.
export const ACK_RE = /^(ok(ay)?|tamam(d[ıi]r)?|peki|olur|evet|yes|thanks|thank you|te[sş]ekk[uü]r(ler| ederim)?|sa[gğ] ?ol(un)?|anlad[ıi]m|got it|done|👍|✓)[.!\s]*$/iu;
export function isAck(d: AnswerDoc): boolean { return !d.key && !!d.note && ACK_RE.test(d.note.trim()); }

const keyOf = (dir: string, d: AnswerDoc & { id: string }) => JSON.stringify([dir, d.id, d.key ?? '', d.label ?? '', d.note ?? '']);

export interface AnswerTriggerOptions { workspace: string; bus: EventBus; jobs: JobRunner; config: () => ServerConfig; batchMs?: number }

export class AnswerTrigger {
  #o: AnswerTriggerOptions;
  #timer: NodeJS.Timeout | null = null;
  #off: (() => void) | null = null;
  #handed = new Set<string>(); // an answer's page, id and content already given to a job: never handed twice, so a job that leaves answers unread cannot loop; a changed answer on the same id is new
  constructor(o: AnswerTriggerOptions) {
    this.#o = o;
    o.jobs.onEnd((j) => { if (j.type === 'answers') this.#schedule(); });
  }

  start(): void { this.#off = this.#o.bus.subscribe((_id, e) => { if (e.type === 'answers') this.#schedule(); }); }
  stop(): void { this.#off?.(); this.#off = null; if (this.#timer) clearTimeout(this.#timer); this.#timer = null; }

  #schedule(): void {
    if (!this.#o.config().answerStartsJob || this.#timer) return;
    this.#timer = setTimeout(() => { this.#timer = null; try { this.fire(); } catch (e) { console.error(`joserah: answer trigger: ${(e as Error).message}`); } }, this.#o.batchMs ?? this.#o.config().answerBatchSec * 1000);
    this.#timer.unref();
  }

  fire(): JobRecord | null {
    if (!this.#o.config().answerStartsJob) return null;
    if (this.#o.jobs.list().some((j) => j.type === 'answers' && (j.state === 'queued' || j.state === 'running'))) return null;
    const pages: string[] = [];
    const keys: string[] = [];
    for (const p of answersLib.newCounts(this.#o.workspace, 2)) {
      const real = answersLib.list(p.dir, { onlyNew: true }).filter((d) => {
        if (isAck(d)) { try { answersLib.markRead(p.dir, d.id); } catch (e) { console.error(`joserah: answer trigger: ${(e as Error).message}`); } return false; }
        return !this.#handed.has(keyOf(p.dir, d));
      });
      if (real.length) { pages.push(p.dir); keys.push(...real.map((d) => keyOf(p.dir, d))); }
    }
    const n = keys.length;
    if (!n) return null;
    const tool = toolPath('answers.js');
    try {
      for (const k of keys) this.#handed.add(k);
      return this.#o.jobs.submit({ type: 'answers', text: `Process the ${n} new answer${n === 1 ? '' : 's'} the owner left on ${pages.length === 1 ? 'a page' : `${pages.length} pages`}.`,
        pointers: [`tool: node "${tool}" list|reply|mark <page dir> …`, ...pages.map((d) => path.relative(this.#o.workspace, d).split(path.sep).join('/'))] });
    } catch (e) { for (const k of keys) this.#handed.delete(k); if (e instanceof Refused) return null; throw e; }
  }
}
