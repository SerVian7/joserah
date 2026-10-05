import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import type { AppDeps } from '../src/deps.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { newAuthFile, writeAuth, RateLimiter, type AuthFile } from '../src/auth.ts';
import { createApp, type App } from '../src/app.ts';
import type { ServerConfig } from '../src/config.ts';
import { EventBus } from '../src/events.ts';
import { Store } from '../src/store.ts';
import { ClaudeCliEngine } from '../src/engines/claude-cli.ts';
import { JobRunner, type Checkpointer } from '../src/jobs.ts';
import { cliTracker } from '../src/tracker-bridge.ts';
import { GitCheckpointer } from '../src/checkpoint.ts';
import { AnswerTrigger } from '../src/answer-trigger.ts';

export const SERVER_ROOT = path.resolve(import.meta.dirname, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
export const ORIGIN = 'http://127.0.0.1:4747';
export const ADDR = { incoming: { socket: { remoteAddress: '10.0.0.9' } } } as const;
process.env.JOSERAH_VAULT_DIALOG = 'off';
const HERMETIC = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-srv-config-'));
process.on('exit', () => fs.rmSync(HERMETIC, { recursive: true, force: true }));

export function tmpdir(t: TestContext): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-srv-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  return d;
}

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A scaffolded workspace (owner O, workspace w, English). With git: an initial commit. */
export function tmpWorkspace(t: TestContext, opts: { git?: boolean } = {}): string {
  const dir = path.join(tmpdir(t), 'ws');
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'scaffold.js'), '--target', dir, '--owner', 'O', '--workspace', 'w', '--language', 'en', '--role', 'r'],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC } });
  if (r.status !== 0) throw new Error(`scaffold: ${r.stderr}`);
  if (opts.git) { git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'init'); }
  return dir;
}

export function baseDeps(t: TestContext, over: Partial<AppDeps> = {}): AppDeps {
  const workspace = over.workspace ?? tmpWorkspace(t);
  const stateDir = over.stateDir ?? path.join(tmpdir(t), 'state');
  const bus = over.bus ?? new EventBus();
  const store = over.store ?? new Store(workspace, bus);
  const engine = over.engine ?? fakeEngine();
  const deps = { workspace, stateDir, config: () => DEFAULT_CONFIG, baseUrl: ORIGIN, health: { signedIn: null, lastJobOk: null },
    auth: { state: { kind: 'setup' } }, limiter: new RateLimiter(), secureCookies: false, bus, store, engine, engineHealth: null, ...over } as AppDeps;
  // Route tests get a runner on the fake engine; it reads the config through the deps, so a test may swap it.
  if (!over.jobs) deps.jobs = new JobRunner({ workspace, store, bus, engine, config: () => deps.config(), tracker: cliTracker(workspace, 'en'), jobUrl: (id) => `${ORIGIN}/jobs/${id}`, lang: 'en' });
  // The answer trigger is built but not started: no test gets a job it did not ask for.
  if (!over.answers) deps.answers = new AnswerTrigger({ workspace, bus, jobs: deps.jobs, config: () => deps.config() });
  return deps;
}

/** Writes auth.json into the state directory and switches the holder to ready. */
export function readyAuth(deps: AppDeps, password = 'pw-0123456789'): AuthFile {
  const f = newAuthFile(password);
  writeAuth(deps.stateDir, f);
  deps.auth.state = { kind: 'ready', file: f };
  return f;
}

/** Signs in through POST /login; returns the `Cookie` header value. */
export async function login(app: App, password = 'pw-0123456789'): Promise<string> {
  const r = await app.request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: new URLSearchParams({ password }).toString() }, ADDR);
  if (r.status !== 303) throw new Error(`login failed: ${r.status}`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

/** A Daily Tracker page made by tools/tracker.js (init, then one `row` per entry); returns the page directory. */
export function trackerPage(ws: string, day: string, rows: Array<{ title: string; state: string; small?: string }> = []): string {
  const dir = path.join(ws, '.joserah', 'desk', 'artifacts', day, 'daily-tracker');
  const tool = path.join(REPO_ROOT, 'tools', 'tracker.js');
  const run = (args: string[]) => { const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
  run(['init', dir, '--title', 'Daily Tracker', '--lang', 'en']);
  for (const r of rows) run(['row', dir, '--title', r.title, '--state', r.state, ...(r.small ? ['--small', r.small] : [])]);
  return dir;
}

/** An app with auth ready and a signed-in session cookie. */
export async function signedIn(t: TestContext, over: Partial<AppDeps> = {}): Promise<{ app: App; deps: AppDeps; cookie: string }> {
  const deps = baseDeps(t, over);
  readyAuth(deps);
  const app = createApp(deps);
  return { app, deps, cookie: await login(app) };
}

/** The fake claude CLI (fixtures/fake-claude.mjs) behind the real engine: tests never call the real CLI. */
export const FAKE_CLAUDE = path.join(SERVER_ROOT, 'test', 'fixtures', 'fake-claude.mjs');
export function fakeEngine(extraEnv: Record<string, string> = {}): ClaudeCliEngine {
  return new ClaudeCliEngine({ command: process.execPath, prefixArgs: [FAKE_CLAUDE], extraEnv });
}

/** A job runner on a fresh workspace with the fake engine; `deps.jobs` is that runner. */
export function runnerFor(t: TestContext, o: { env?: Record<string, string>; config?: Partial<ServerConfig>; git?: boolean; checkpoint?: Checkpointer; checkpointer?: boolean } = {}) {
  const ws = tmpWorkspace(t, { git: o.git });
  const cfg: ServerConfig = { ...DEFAULT_CONFIG, ...(o.config ?? {}) };
  const deps = baseDeps(t, { workspace: ws, config: () => cfg });
  const runner = new JobRunner({ workspace: ws, store: deps.store, bus: deps.bus, engine: fakeEngine(o.env), config: () => cfg,
    tracker: cliTracker(ws, 'en'), checkpoint: o.checkpointer ? new GitCheckpointer(ws, deps.store) : o.checkpoint, jobUrl: (id) => `${ORIGIN}/jobs/${id}`, lang: 'en' });
  deps.jobs = runner;
  return { runner, deps, ws };
}
