import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HttpBindings } from '@hono/node-server';
import type { AppDeps } from './deps.ts';

export type Env = { Bindings: HttpBindings; Variables: { signedIn: boolean } };
export type App = Hono<Env>;

export function jsonError(c: Context, status: ContentfulStatusCode, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, ...extra }, status);
}

export function createApp(deps: AppDeps): App {
  const app: App = new Hono<Env>();
  app.get('/healthz', (c) => c.json({ alive: true, signedIn: deps.health.signedIn, lastJobOk: deps.health.lastJobOk }));
  app.all('/api/devices', (c) => jsonError(c, 501, 'reserved'));
  app.all('/api/devices/*', (c) => jsonError(c, 501, 'reserved'));
  app.notFound((c) => (c.req.path.startsWith('/api/') ? jsonError(c, 404, 'not-found') : c.html('<!doctype html><title>404</title><p>Not found.</p>', 404)));
  return app;
}
