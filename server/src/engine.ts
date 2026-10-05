import type { JobType } from './config.ts';

export interface EngineJob { id: string; type: JobType; target: 'server'; brief: string; model: string; cwd: string; budgetUsd: number; resumeSessionId?: string; restricted: boolean; writeArea: string[]; allowTools?: string[] }
export type EngineEvent =
  | { kind: 'init'; sessionId: string; model: string; cliVersion: string; tools: string[] }
  | { kind: 'text'; text: string } | { kind: 'tool'; name: string } | { kind: 'turn' } | { kind: 'denied'; tool: string }
  | { kind: 'result'; ok: boolean; subtype: string; text: string; costUsd: number | null; turns: number | null; denials: string[]; sessionId: string | null }
  | { kind: 'other'; type: string } | { kind: 'bad-line'; text: string } | { kind: 'stderr'; text: string };
export interface EngineItem { raw: string; event: EngineEvent }
export interface EngineRun { readonly pid: number | undefined; events: AsyncIterable<EngineItem>; cancel(): Promise<void>; done: Promise<{ code: number | null; signal: string | null; spawnError: string | null }> }
export interface EngineHealth { installed: boolean; version: string | null; signedIn: boolean; detail: string }
export interface Engine { readonly name: string; start(job: EngineJob): EngineRun; health(): Promise<EngineHealth> }
