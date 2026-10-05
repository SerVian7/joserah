import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadServerConfig, resolveListen, ConfigError } from './src/config.ts';
import { stateDir, localDay, now } from './src/paths.ts';
import { createApp } from './src/app.ts';
import { loadAuth, AuthFileError, setupToken, RateLimiter, type AuthState } from './src/auth.ts';
import type { AppDeps } from './src/deps.ts';
import { EventBus } from './src/events.ts';
import { Store } from './src/store.ts';
import { ClaudeCliEngine } from './src/engines/claude-cli.ts';
import { JobRunner, ensureJobIgnores, rotateLogs } from './src/jobs.ts';
import { cliTracker } from './src/tracker-bridge.ts';
import { GitCheckpointer } from './src/checkpoint.ts';
import { workspaceLang } from './src/config.ts';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
function fail(message: string): never { console.error(`joserah: ${message}`); process.exit(1); }

const workspace = path.resolve(arg('--workspace') ?? process.cwd());
let cfg;
try { cfg = loadServerConfig(workspace); } catch (e) { if (e instanceof ConfigError) fail(e.message); throw e; }
if (arg('--port') !== undefined) {
  const port = Number(arg('--port'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port must be a whole number from 1 to 65535');
  cfg = { ...cfg, port };
}
let listen;
try { listen = resolveListen(cfg); } catch (e) { if (e instanceof ConfigError) fail(e.message); throw e; }
const state = path.resolve(stateDir(workspace));
const inside = path.relative(workspace, state);
const outside = inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside);
if (!outside) fail('the state directory (JOSERAH_STATE_DIR) must be outside the workspace');

// A missing auth file means setup; an empty, unreadable or broken one stops the server (never a silent reset).
let authState: AuthState;
try { authState = loadAuth(state); } catch (e) { if (e instanceof AuthFileError) fail(e.message); throw e; }

// HTTPS from server.json: cert and key files, relative to the workspace.
let tls: { cert: Buffer; key: Buffer } | null = null;
if (listen.https) {
  const read = (f: string) => { try { return fs.readFileSync(path.resolve(workspace, f)); } catch (e) { return fail(`cannot read the HTTPS file ${f}: ${(e as Error).message}`); } };
  tls = { cert: read(listen.https.cert), key: read(listen.https.key) };
}

// Behind a proxy the browser's Origin is the proxy's address, never ours: without it declared, every POST (sign-in too) is refused.
if (cfg.proxy && !cfg.publicOrigin) fail('server.json: "proxy": true needs "publicOrigin" — the address the browser opens, such as https://host');

const host = listen.hostname === '0.0.0.0' ? '127.0.0.1' : listen.hostname.includes(':') ? `[${listen.hostname}]` : listen.hostname;
// The scheme this process speaks: https only with our own certificate. `listen.secure` (proxy too) is for the cookie flag.
const baseUrl = `${tls ? 'https' : 'http'}://${host}:${listen.port}`;
// The bus and the only file writer. The store polls today's and yesterday's pages and the knowledge folder for edits
// made elsewhere (a terminal session, a tool a job ran), so an open page hears them; it starts once the server listens.
const bus = new EventBus();
const store = new Store(workspace, bus, { pollDirs: () => {
  const d = now(); const y = new Date(d.getTime() - 86400000);
  return [`.joserah/desk/artifacts/${localDay(d)}`, `.joserah/desk/artifacts/${localDay(y)}`, '.joserah/knowledge'];
} });
const engine = new ClaudeCliEngine({ command: process.env.JOSERAH_CLAUDE_BIN || 'claude' });
const lang = workspaceLang(workspace);
const jobs = new JobRunner({ workspace, store, bus, engine, config: () => cfg, tracker: cliTracker(workspace, lang), checkpoint: new GitCheckpointer(workspace, store), jobUrl: (id) => `${baseUrl}/jobs/${id}`, lang });
const deps: AppDeps = { workspace, stateDir: state, config: () => cfg, baseUrl, health: { signedIn: null, lastJobOk: null }, auth: { state: authState }, limiter: new RateLimiter(), secureCookies: listen.secure,
  store, bus, engine, jobs, engineHealth: null };
jobs.onEnd((j) => { deps.health.lastJobOk = j.state === 'done'; });
const app = createApp(deps);
const ready = () => {
  console.log(`Joserah server: ${baseUrl}/`);
  // First: a job that was running when the server stopped becomes interrupted (owner row); queued jobs run.
  jobs.recover();
  store.start();   // the first poll records what exists; later polls publish edits made outside the server
  const chore = (name: string, fn: () => unknown) => { try { fn(); } catch (e) { console.error(`joserah: ${name} failed: ${(e as Error).message}`); } };
  chore('job-log ignore lines', () => { if (ensureJobIgnores(workspace)) console.log('Added the job-log lines to the workspace .gitignore.'); });
  chore('raw log rotation', () => rotateLogs(store, cfg.rawLogDays));
  setInterval(() => chore('raw log rotation', () => rotateLogs(store, cfg.rawLogDays)), 24 * 3600000).unref(); // and once a day while it runs
  const refresh = async () => { const h = await engine.health(); deps.health.signedIn = h.signedIn; deps.engineHealth = h; };
  void refresh(); setInterval(() => void refresh(), 5 * 60000).unref();
  if (deps.auth.state.kind === 'setup') console.log(`First start — open ${baseUrl}/setup?token=${setupToken(state)} to set the password.`);
};
// Ctrl+C or `docker restart` (SIGTERM): stop running jobs as interrupted, keep the queue for the next start.
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; void jobs.shutdown().finally(() => process.exit(0)); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
if (tls) serve({ fetch: app.fetch, port: listen.port, hostname: listen.hostname, createServer: https.createServer, serverOptions: tls }, ready);
else serve({ fetch: app.fetch, port: listen.port, hostname: listen.hostname }, ready);
