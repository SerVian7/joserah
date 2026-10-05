import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import type { AppDeps } from '../src/deps.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { newAuthFile, writeAuth, RateLimiter, type AuthFile } from '../src/auth.ts';
import type { App } from '../src/app.ts';

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
  return { workspace, stateDir, config: () => DEFAULT_CONFIG, baseUrl: ORIGIN, health: { signedIn: null, lastJobOk: null },
    auth: { state: { kind: 'setup' } }, limiter: new RateLimiter(), secureCookies: false, ...over } as AppDeps;
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
