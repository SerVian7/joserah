import type { ServerConfig } from './config.ts';
export interface HealthView { signedIn: boolean | null; lastJobOk: boolean | null }
export interface AppDeps {
  workspace: string;
  stateDir: string;
  config: () => ServerConfig;
  baseUrl: string;
  health: HealthView;
}
