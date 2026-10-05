import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadServerConfig, resolveListen, ConfigError } from './src/config.ts';
import { stateDir } from './src/paths.ts';
import { createApp } from './src/app.ts';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

const workspace = path.resolve(arg('--workspace') ?? process.cwd());
let cfg;
try { cfg = loadServerConfig(workspace); } catch (e) { if (e instanceof ConfigError) { console.error(`joserah: ${e.message}`); process.exit(1); } throw e; }
if (arg('--port')) cfg = { ...cfg, port: Number(arg('--port')) };
const listen = resolveListen(cfg);
const baseUrl = `${listen.secure ? 'https' : 'http'}://${listen.hostname === '0.0.0.0' ? '127.0.0.1' : listen.hostname}:${listen.port}`;
const app = createApp({ workspace, stateDir: stateDir(workspace), config: () => cfg, baseUrl, health: { signedIn: null, lastJobOk: null } });
serve({ fetch: app.fetch, port: listen.port, hostname: listen.hostname }, () => console.log(`Joserah server: ${baseUrl}/`));
