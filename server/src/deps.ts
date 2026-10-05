import type { ServerConfig } from './config.ts';
import type { AuthState, RateLimiter } from './auth.ts';
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
}
