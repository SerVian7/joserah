---
name: joserah-hono-sse-routes
description: Use when adding or changing a route, middleware or the event stream of the Joserah server, or when a route test behaves differently from the browser.
---

# Hono routes and server-sent events in the Joserah server

- The app is `new Hono<Env>()` with `Env = { Bindings: HttpBindings; Variables: {...} }` (`import type { HttpBindings } from '@hono/node-server'`); the client address is `c.env.incoming.socket.remoteAddress`, never a header.
- Each route module exports `register(app: App, deps: AppDeps): void`; `createApp(deps)` in `server/src/app.ts` fixes the order: security headers → auth guard → Origin check → routes → not-found.
- Test routes with `app.request(path, init, env)` — no socket. Pass `env = { incoming: { socket: { remoteAddress: '10.0.0.9' } } }` when the code reads the address.
- Every state-changing method (POST, PUT, PATCH, DELETE) needs an `Origin` equal to the server's own origin; tests send `Origin: http://127.0.0.1:4747`.
- An unknown `/api/...` path answers `404` JSON `{"error":"not-found"}`, never the HTML page; `/api/devices/*` answers `501`.
- SSE: `import { streamSSE } from 'hono/streaming'`; each event `stream.writeSSE({ id: String(n), data: JSON.stringify(e) })`; the browser's `EventSource` resends the last id as the `Last-Event-ID` header — replay from the bus ring buffer after it; an id older than the buffer gets `{type:"reset"}`. A comment line every 25 s keeps proxies from closing the stream. `stream.onAbort` unsubscribes.
- Reading an SSE response in a test: take `res.body.getReader()`, read until the expected `data:` line, then `reader.cancel()`.
