import { spawn, spawnSync, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { Engine, EngineEvent, EngineHealth, EngineItem, EngineJob, EngineRun } from '../engine.ts';

const run = promisify(execFile);
type J = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});

/** The CLI's argument list for a job. The brief never appears here: it goes on stdin. */
export function claudeArgs(job: EngineJob): string[] {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--model', job.model, '--max-budget-usd', job.budgetUsd.toFixed(2), '--permission-prompts', 'none'];
  if (job.resumeSessionId) a.push('--resume', job.resumeSessionId);
  const allow: string[] = [];
  if (job.restricted) {
    const writes = job.writeArea.length > 0;
    a.push('--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', writes ? 'Read,Grep,Glob,Edit,Write' : 'Read,Grep,Glob');
    for (const area of job.writeArea) allow.push(`Edit(${area}/**)`, `Write(${area}/**)`);
  } else {
    a.push('--permission-mode', 'acceptEdits');
  }
  allow.push(...(job.allowTools ?? []));
  if (allow.length) a.push('--allowedTools', ...allow); // takes several values: always last
  return a;
}

/** One stream-json line to zero or more events. Never throws: a bad line is `bad-line`, an unknown type is `other`. */
export function parseLine(line: string): EngineEvent[] {
  const t = line.trim();
  if (!t) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch { return [{ kind: 'bad-line', text: t.slice(0, 500) }]; }
  const j = obj(parsed); const type = str(j.type); const sub = str(j.subtype);
  if (type === 'system' && sub === 'init') return [{ kind: 'init', sessionId: str(j.session_id), model: str(j.model), cliVersion: str(j.claude_code_version), tools: arr(j.tools).map(str) }];
  if (type === 'system' && sub === 'permission_denied') return [{ kind: 'denied', tool: str(j.tool_name) }];
  if (type === 'assistant') return arr(obj(j.message).content).flatMap((b): EngineEvent[] => {
    const o = obj(b);
    if (o.type === 'text' && str(o.text)) return [{ kind: 'text', text: str(o.text) }];
    if (o.type === 'tool_use') return [{ kind: 'tool', name: str(o.name) }];
    return [];
  });
  if (type === 'user') return arr(obj(j.message).content).some((b) => obj(b).type === 'tool_result') ? [{ kind: 'turn' }] : [];
  if (type === 'result') return [{
    kind: 'result', ok: sub === 'success' && j.is_error !== true, subtype: sub, text: str(j.result),
    costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null, turns: typeof j.num_turns === 'number' ? j.num_turns : null,
    denials: arr(j.permission_denials).map((d) => str(obj(d).tool_name)).filter(Boolean), sessionId: str(j.session_id) || null,
  }];
  return [{ kind: 'other', type: type || 'unknown' }];
}

const KEEP = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'TZ',
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH', 'DISABLE_AUTOUPDATER', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

/** The job's environment: an allowlist — no server variable, nothing secret-named but the engine's own sign-in. */
export function jobEnv(src: NodeJS.ProcessEnv = process.env, jobId?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of KEEP) if (src[k] !== undefined) out[k] = src[k];
  if (jobId) out.JOSERAH_JOB_ID = jobId;
  if (process.platform !== 'win32' && !out.LANG) out.LANG = 'C.UTF-8';
  return out;
}

/** Ends a process and everything it started, by PID — never by image name. */
export function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); return Promise.resolve(); }
  try { process.kill(-pid, 'SIGTERM'); } catch { return Promise.resolve(); }
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      try { process.kill(-pid, 0); } catch { resolve(); return; }
      if (Date.now() - start > 3000) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } resolve(); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
}

class Queue<T> {
  #items: T[] = []; #waiters: Array<(r: IteratorResult<T>) => void> = []; #closed = false;
  push(v: T): void { const w = this.#waiters.shift(); if (w) w({ value: v, done: false }); else this.#items.push(v); }
  close(): void { this.#closed = true; for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true } as IteratorResult<T>); }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => (this.#items.length ? Promise.resolve({ value: this.#items.shift()!, done: false }) : this.#closed ? Promise.resolve({ value: undefined, done: true } as IteratorResult<T>) : new Promise((r) => this.#waiters.push(r))) };
  }
}

export class ClaudeCliEngine implements Engine {
  readonly name = 'claude-cli';
  #cmd: string; #prefix: string[]; #extra: Record<string, string>;
  constructor(o: { command?: string; prefixArgs?: string[]; extraEnv?: Record<string, string> } = {}) {
    this.#cmd = o.command ?? 'claude'; this.#prefix = o.prefixArgs ?? []; this.#extra = o.extraEnv ?? {};
  }

  start(job: EngineJob): EngineRun {
    const q = new Queue<EngineItem>();
    const child = spawn(this.#cmd, [...this.#prefix, ...claudeArgs(job)], {
      cwd: job.cwd, env: { ...jobEnv(process.env, job.id), ...this.#extra }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: true, shell: false,
    });
    let spawnError: string | null = null;
    const done = new Promise<{ code: number | null; signal: string | null; spawnError: string | null }>((resolve) => {
      child.on('error', (e) => { spawnError = `${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}`.trim(); q.close(); resolve({ code: null, signal: null, spawnError }); });
      child.on('close', (code, signal) => { q.close(); resolve({ code, signal, spawnError }); });
    });
    child.stdin?.on('error', () => { /* the CLI may exit before reading all of stdin */ });
    child.stdin?.end(Buffer.from(job.brief, 'utf8'));
    if (child.stdout) createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (raw) => { for (const event of parseLine(raw)) q.push({ raw, event }); });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => q.push({ raw: '', event: { kind: 'stderr', text: text.slice(0, 2000) } }));
    return { pid: child.pid, events: q, done, cancel: () => (child.pid ? killTree(child.pid) : Promise.resolve()) };
  }

  async health(): Promise<EngineHealth> {
    const opts = { env: { ...jobEnv(process.env), ...this.#extra }, timeout: 15000, windowsHide: true };
    let version: string | null = null;
    try { version = /(\d+\.\d+\.\d+)/.exec((await run(this.#cmd, [...this.#prefix, '--version'], opts)).stdout)?.[1] ?? null; }
    catch { return { installed: false, version: null, signedIn: false, detail: 'Claude Code is not installed or not on PATH' }; }
    try {
      const j = JSON.parse((await run(this.#cmd, [...this.#prefix, 'auth', 'status', '--json'], opts)).stdout) as { loggedIn?: boolean };
      return { installed: true, version, signedIn: j.loggedIn === true, detail: j.loggedIn === true ? 'signed in' : 'not signed in' };
    } catch (e) { return { installed: true, version, signedIn: false, detail: `sign-in state unknown: ${(e as Error).message.split('\n')[0]}` }; }
  }
}
