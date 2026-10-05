import fs from 'node:fs';
import path from 'node:path';
import { workspaceLib } from './cjs.ts';

export const JOB_TYPES = ['answers', 'digest', 'bookkeeping', 'task', 'code', 'research', 'ingest', 'query', 'lint', 'plan', 'review'] as const;
export type JobType = typeof JOB_TYPES[number];
export const RESTRICTED_TYPES: readonly JobType[] = ['ingest', 'query', 'lint'];
export const CLAIM_TYPES_JOB: readonly JobType[] = ['ingest', 'query', 'lint', 'research', 'plan', 'review'];
export const DEFAULT_MODELS: Record<JobType, string> = {
  answers: 'haiku', digest: 'haiku', bookkeeping: 'haiku',
  task: 'sonnet', code: 'sonnet', research: 'sonnet', ingest: 'sonnet', query: 'sonnet', lint: 'sonnet',
  plan: 'opus', review: 'opus',
};
export type Exposure = 'local' | 'tailnet' | 'internet';
export interface ServerConfig {
  port: number; exposure: Exposure; bind: string | null; https: { cert: string; key: string } | null; proxy: boolean; publicOrigin: string | null;
  maxConcurrentJobs: 1 | 2; jobTimeoutMin: number; jobMaxTurns: number; jobBudgetUsd: number; dailyBudgetUsd: number;
  answerStartsJob: boolean; answerBatchSec: number; nightlyLlmLint: boolean; nightlyAt: string; rawLogDays: number;
  models: Record<string, string>;
}
export const DEFAULT_CONFIG: ServerConfig = {
  port: 4747, exposure: 'local', bind: null, https: null, proxy: false, publicOrigin: null,
  maxConcurrentJobs: 1, jobTimeoutMin: 30, jobMaxTurns: 60, jobBudgetUsd: 2, dailyBudgetUsd: 10,
  answerStartsJob: false, answerBatchSec: 60, nightlyLlmLint: false, nightlyAt: '03:30', rawLogDays: 30,
  models: { ...DEFAULT_MODELS },
};
export class ConfigError extends Error {}

function num(v: unknown, key: string, min: number, max: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new ConfigError(`server.json: ${key} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}`);
  }
  return v;
}
function bool(v: unknown, key: string): void {
  if (typeof v !== 'boolean') throw new ConfigError(`server.json: ${key} must be true or false`);
}
function nullableString(v: unknown, key: string): void {
  if (v !== null && (typeof v !== 'string' || !v.trim())) throw new ConfigError(`server.json: ${key} must be null or a non-empty string`);
}
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function loadServerConfig(workspace: string): ServerConfig {
  const p = path.join(workspace, '.joserah', 'server.json');
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(p)) {
    try { raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new ConfigError(`server.json is not valid JSON: ${(e as Error).message}`); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('server.json must hold an object');
  }
  if (raw.models !== undefined && !isObject(raw.models)) throw new ConfigError('server.json: models must be an object of job type to model name');
  const c: ServerConfig = { ...DEFAULT_CONFIG, ...raw, models: { ...DEFAULT_MODELS, ...((raw.models as Record<string, string>) ?? {}) } } as ServerConfig;
  num(c.port, 'port', 1, 65535, true);
  if (!['local', 'tailnet', 'internet'].includes(c.exposure)) throw new ConfigError('server.json: exposure must be local, tailnet or internet');
  nullableString(c.bind, 'bind');
  if (c.https !== null && !(isObject(c.https) && typeof c.https.cert === 'string' && c.https.cert.trim() && typeof c.https.key === 'string' && c.https.key.trim())) {
    throw new ConfigError('server.json: https must be null or {"cert": "<file>", "key": "<file>"}');
  }
  bool(c.proxy, 'proxy');
  nullableString(c.publicOrigin, 'publicOrigin');
  if (c.publicOrigin !== null && !URL.canParse(c.publicOrigin)) throw new ConfigError('server.json: publicOrigin must be a URL such as https://host');
  if (c.maxConcurrentJobs !== 1 && c.maxConcurrentJobs !== 2) throw new ConfigError('server.json: maxConcurrentJobs must be 1 or 2');
  num(c.jobTimeoutMin, 'jobTimeoutMin', 1, 240); num(c.jobMaxTurns, 'jobMaxTurns', 1, 500, true);
  num(c.jobBudgetUsd, 'jobBudgetUsd', 0.01, 100); num(c.dailyBudgetUsd, 'dailyBudgetUsd', 0.01, 1000);
  num(c.answerBatchSec, 'answerBatchSec', 5, 3600); num(c.rawLogDays, 'rawLogDays', 1, 365, true);
  bool(c.answerStartsJob, 'answerStartsJob'); bool(c.nightlyLlmLint, 'nightlyLlmLint');
  if (typeof c.nightlyAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.nightlyAt)) throw new ConfigError('server.json: nightlyAt must be HH:MM');
  for (const [type, model] of Object.entries(c.models)) {
    if (typeof model !== 'string' || !model.trim()) throw new ConfigError(`server.json: models.${type} must be a model name`);
    if ((CLAIM_TYPES_JOB as readonly string[]).includes(type) && /haiku/i.test(model)) throw new ConfigError(`server.json: models.${type} may not be a Haiku model — ${type} jobs touch claims`);
  }
  return c;
}

export function modelFor(cfg: ServerConfig, type: string): string { return cfg.models[type] ?? 'opus'; }

export function resolveListen(cfg: ServerConfig, env: NodeJS.ProcessEnv = process.env) {
  let hostname = '127.0.0.1';
  if (cfg.exposure === 'tailnet') { if (!cfg.bind) throw new ConfigError('server.json: exposure "tailnet" needs "bind" (the tailnet address)'); hostname = cfg.bind; }
  if (cfg.exposure === 'internet') {
    if (!cfg.https && !cfg.proxy) throw new ConfigError('server.json: exposure "internet" refuses to start without HTTPS — give "https": {"cert","key"} or declare "proxy": true');
    hostname = cfg.proxy ? '127.0.0.1' : (cfg.bind ?? '0.0.0.0');
  }
  if (env.JOSERAH_IN_DOCKER === '1') hostname = '0.0.0.0';
  return { hostname, port: cfg.port, https: cfg.https, secure: !!cfg.https || cfg.proxy };
}

export function workspaceLang(workspace: string): 'tr' | 'en' {
  const l = String(workspaceLib.readConfig(workspace)?.dialogueLanguage ?? '');
  return /^(tr|turk)/i.test(l) ? 'tr' : 'en';
}
