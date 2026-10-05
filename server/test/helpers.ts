import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import type { AppDeps } from '../src/deps.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

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
  return { workspace, stateDir, config: () => DEFAULT_CONFIG, baseUrl: ORIGIN, health: { signedIn: null, lastJobOk: null }, ...over } as AppDeps;
}
