import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HttpBindings } from '@hono/node-server';
import type { AppDeps } from './deps.ts';
import { headers, guard, originCheck } from './security.ts';
import { register as authRoutes } from './routes/auth.ts';
import { register as pagesRoutes } from './routes/pages.ts';
import { register as dbRoutes } from './routes/db.ts';
import { register as eventsRoutes } from './routes/events.ts';
import { register as jobsRoutes } from './routes/jobs.ts';
import { register as homeRoutes } from './routes/home.ts';
import { register as wikiRoutes } from './routes/wiki.ts';
import { register as ingestRoutes } from './routes/ingest.ts';
import { register as lintRoutes } from './routes/lint.ts';

export type Env = { Bindings: HttpBindings; Variables: { signedIn: boolean } };
export type App = Hono<Env>;

export function jsonError(c: Context, status: ContentfulStatusCode, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, ...extra }, status);
}

/** Order matters: headers wrap everything; health and the reserved device prefix answer before the guard; then session, then Origin. */
export function createApp(deps: AppDeps): App {
  const app: App = new Hono<Env>();
  app.use('*', headers());
  app.get('/healthz', (c) => c.json({ alive: true, signedIn: deps.health.signedIn, lastJobOk: deps.health.lastJobOk }));
  app.all('/api/devices', (c) => jsonError(c, 501, 'reserved'));   // reserved for the device runner (decision 11): answers before the guard, does nothing
  app.all('/api/devices/*', (c) => jsonError(c, 501, 'reserved'));
  app.use('*', guard(deps));
  app.use('*', originCheck(deps));
  authRoutes(app, deps);
  pagesRoutes(app, deps);
  dbRoutes(app, deps);
  eventsRoutes(app, deps);
  jobsRoutes(app, deps);
  homeRoutes(app, deps);
  wikiRoutes(app, deps);
  ingestRoutes(app, deps);
  lintRoutes(app, deps);
  // Later tasks register their routes here, after authRoutes and before notFound.
  app.notFound((c) => (c.req.path.startsWith('/api/') ? jsonError(c, 404, 'not-found') : c.html('<!doctype html><title>404</title><p>Not found.</p>', 404)));
  return app;
}
