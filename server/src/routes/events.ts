import { streamSSE } from 'hono/streaming';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import type { BusEvent } from '../events.ts';

/**
 * GET /events — the bus as Server-Sent Events. `Last-Event-ID` (or `?last=`) resumes from the ring buffer; an id the
 * buffer no longer holds, or one from a previous server run, gets `{type:"reset"}` so the page reloads. A fresh
 * connection starts with `{type:"hello"}` carrying the current id. A comment ping every 25 s keeps proxies open.
 */
export function register(app: App, deps: AppDeps): void {
  app.get('/events', (c) => {
    const lastRaw = c.req.header('last-event-id') ?? c.req.query('last');
    const last = lastRaw === undefined || lastRaw === '' ? NaN : Number(lastRaw);
    return streamSSE(c, async (stream) => {
      const queue: Array<{ id: number; event: BusEvent }> = [];
      let wake: (() => void) | null = null;
      const off = deps.bus.subscribe((id, event) => { queue.push({ id, event }); wake?.(); });
      stream.onAbort(() => { off(); wake?.(); });
      try {
        if (Number.isFinite(last)) {
          const missed = deps.bus.since(last);
          if (missed === null) queue.unshift({ id: deps.bus.lastId(), event: { type: 'reset' } });
          else queue.unshift(...missed.filter((m) => !queue.some((q) => q.id === m.id)));
        } else {
          await stream.writeSSE({ id: String(deps.bus.lastId()), data: '{"type":"hello"}' });
        }
        let ping = Date.now();
        while (!stream.aborted) {
          while (queue.length && !stream.aborted) { const m = queue.shift()!; await stream.writeSSE({ id: String(m.id), data: JSON.stringify(m.event) }); }
          if (stream.aborted) break;
          await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 25000); wake = () => { clearTimeout(timer); resolve(); }; });
          wake = null;
          if (Date.now() - ping >= 25000) { await stream.write(': ping\n\n'); ping = Date.now(); }
        }
      } finally { off(); }
    });
  });
}
