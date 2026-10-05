import type { Context } from 'hono';
import type { App, Env } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { jsonError } from '../app.ts';
import { Refused } from '../jobs.ts';

export type StreamLine = { kind: 'text' | 'tool'; text: string };
export function streamLines(entries: unknown[]): StreamLine[] {
  const out: StreamLine[] = [];
  for (const e of entries) {
    const o = (e ?? {}) as { type?: string; message?: { content?: Array<{ type?: string; text?: string; name?: string }> } };
    if (o.type !== 'assistant') continue;
    for (const b of o.message?.content ?? []) {
      if (b.type === 'text' && b.text) out.push({ kind: 'text', text: b.text });
      if (b.type === 'tool_use' && b.name) out.push({ kind: 'tool', text: b.name });
    }
  }
  return out;
}

const STATUS: Record<string, 400 | 403 | 404 | 409 | 429 | 503> = { 'not-found': 404, restricted: 403, 'not-waiting': 409, 'already-approved': 409, 'daily-budget': 429, stopping: 503 };
function refusal(c: Context<Env>, e: unknown) {
  if (!(e instanceof Refused)) throw e;
  return jsonError(c, STATUS[e.code] ?? 400, e.code, { message: e.message });
}

export function register(app: App, deps: AppDeps): void {
  const engineReady = (c: Context<Env>) => {
    const h = deps.engineHealth;
    return h && (!h.installed || !h.signedIn) ? jsonError(c, 503, 'engine', { reason: h.detail }) : null;
  };
  app.post('/api/jobs', async (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    let b: { text?: unknown; type?: unknown };
    try { b = await c.req.json(); } catch { return jsonError(c, 400, 'bad-text'); }
    try { return c.json({ id: deps.jobs.submit({ text: String(b?.text ?? ''), type: typeof b?.type === 'string' ? b.type : undefined }).id }, 201); } catch (e) { return refusal(c, e); }
  });
  app.get('/api/jobs', (c) => c.json({ jobs: deps.jobs.list(c.req.query('day')) }));
  app.get('/api/jobs/:id', (c) => {
    const j = deps.jobs.get(c.req.param('id'));
    if (!j) return jsonError(c, 404, 'not-found');
    return c.json({ job: j, stream: streamLines(deps.jobs.logTail(j.id, 400)) });
  });
  app.post('/api/jobs/:id/cancel', async (c) => {
    const j = await deps.jobs.cancel(c.req.param('id'));
    return j ? c.json({ id: j.id }) : jsonError(c, 404, 'not-found');
  });
  app.post('/api/jobs/:id/reply', async (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    let b: { text?: unknown };
    try { b = await c.req.json(); } catch { return jsonError(c, 400, 'bad-text'); }
    try { return c.json({ id: deps.jobs.reply(c.req.param('id'), String(b?.text ?? '')).id }, 201); } catch (e) { return refusal(c, e); }
  });
  app.post('/api/jobs/:id/retry', (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    const p = deps.jobs.get(c.req.param('id'));
    if (!p) return jsonError(c, 404, 'not-found');
    try { return c.json({ id: deps.jobs.submit({ type: p.type, text: p.text, parentId: p.id, pointers: p.pointers }).id }, 201); } catch (e) { return refusal(c, e); }
  });
  app.post('/api/jobs/:id/approve', (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    try { return c.json({ id: deps.jobs.approve(c.req.param('id')).id }, 201); } catch (e) { return refusal(c, e); }
  });
}
