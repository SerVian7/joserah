import type { ServerConfig } from './config.ts';
import type { AuthState, RateLimiter } from './auth.ts';
import type { EventBus } from './events.ts';
import type { Store } from './store.ts';
import type { Engine, EngineHealth } from './engine.ts';
import type { JobRunner } from './jobs.ts';
import type { AnswerTrigger } from './answer-trigger.ts';
import type { TrackerBridge } from './tracker-bridge.ts';
import type { LintScheduler } from './lint-scheduler.ts';
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
  lint: LintScheduler;
  /** Owner rows raised by routes (a held upload); when absent the route builds the CLI bridge on first use. */
  tracker?: TrackerBridge;
  engineHealth: EngineHealth | null;
}
