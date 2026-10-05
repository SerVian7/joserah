import type { ServerConfig } from './config.ts';
import type { AuthState, RateLimiter } from './auth.ts';
import type { EventBus } from './events.ts';
import type { Store } from './store.ts';
import type { Engine, EngineHealth } from './engine.ts';
import type { JobRunner } from './jobs.ts';
import type { AnswerTrigger } from './answer-trigger.ts';
export interface HealthView { signedIn: boolean | null; lastJobOk: boolean | null }
export interface AuthHolder { state: AuthState }
export interface AppDeps {
  workspace: string;
  stateDir: string;
  config: () => ServerConfig;
  baseUrl: string;
  health: HealthView;
  auth: AuthHolder;
  limiter: RateLimiter;
  secureCookies: boolean;
  store: Store;
  bus: EventBus;
  engine: Engine;
  jobs: JobRunner;
  answers: AnswerTrigger;
  engineHealth: EngineHealth | null;
}
