export type JobEventView =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'state'; state: string }
  | { kind: 'result'; ok: boolean; text: string; costUsd: number | null };
export type BusEvent =
  | { type: 'changed'; path: string }
  | { type: 'answers'; page: string }
  | { type: 'job'; id: string; event: JobEventView }
  | { type: 'jobs' }
  | { type: 'reset' };

/** Numbers every event and keeps the last `size` so a dropped browser can resume with `since(lastSeenId)`. */
export class EventBus {
  #ring: Array<{ id: number; event: BusEvent }> = [];
  #next: number;
  #subs = new Set<(id: number, e: BusEvent) => void>();
  #size: number;
  /**
   * Ids start at the clock (`start`), not at 1: after a server restart every id a browser still holds is below the new
   * ring, so `since()` answers null and the page resets instead of resuming into a different run's events.
   */
  constructor(size = 1000, start: number = Date.now()) { this.#size = Math.max(1, Math.floor(size)); this.#next = Math.max(1, Math.floor(start)); }
  publish(event: BusEvent): number {
    const id = this.#next++;
    this.#ring.push({ id, event });
    if (this.#ring.length > this.#size) this.#ring.shift();
    for (const fn of [...this.#subs]) { try { fn(id, event); } catch { /* a broken subscriber never stops the others */ } }
    return id;
  }
  /**
   * Events after `id`; `[]` when nothing is newer; `null` when `id` is older than the buffer or newer than any id
   * issued (a page that saw a previous server run) — either way the page must reset.
   */
  since(id: number): Array<{ id: number; event: BusEvent }> | null {
    if (!Number.isFinite(id) || id < 0 || id > this.#next - 1) return null;
    if (id === this.#next - 1) return [];
    const first = this.#ring[0]?.id ?? this.#next;
    if (id + 1 < first) return null;
    return this.#ring.filter((x) => x.id > id);
  }
  subscribe(fn: (id: number, e: BusEvent) => void): () => void { this.#subs.add(fn); return () => { this.#subs.delete(fn); }; }
  lastId(): number { return this.#next - 1; }
}
