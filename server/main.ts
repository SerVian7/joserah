import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadServerConfig, resolveListen, ConfigError } from './src/config.ts';
import { stateDir } from './src/paths.ts';
import { createApp } from './src/app.ts';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
function fail(message: string): never { console.error(`joserah: ${message}`); process.exit(1); }

const workspace = path.resolve(arg('--workspace') ?? process.cwd());
let cfg;
try { cfg = loadServerConfig(workspace); } catch (e) { if (e instanceof ConfigError) fail(e.message); throw e; }
if (arg('--port') !== undefined) {
  const port = Number(arg('--port'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port must be a whole number from 1 to 65535');
  cfg = { ...cfg, port };
}
let listen;
try { listen = resolveListen(cfg); } catch (e) { if (e instanceof ConfigError) fail(e.message); throw e; }
const state = path.resolve(stateDir(workspace));
const inside = path.relative(workspace, state);
const outside = inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside);
if (!outside) fail('the state directory (JOSERAH_STATE_DIR) must be outside the workspace');
const host = listen.hostname === '0.0.0.0' ? '127.0.0.1' : listen.hostname.includes(':') ? `[${listen.hostname}]` : listen.hostname;
const baseUrl = `${listen.secure ? 'https' : 'http'}://${host}:${listen.port}`;
const app = createApp({ workspace, stateDir: state, config: () => cfg, baseUrl, health: { signedIn: null, lastJobOk: null } });
serve({ fetch: app.fetch, port: listen.port, hostname: listen.hostname }, () => console.log(`Joserah server: ${baseUrl}/`));
