#!/usr/bin/env node
// joserah serve [--workspace <dir>] [--port <n>]  — run the Joserah server for this workspace.
// joserah setup-link [--workspace <dir>] [--port <n>] — print the one-time setup link (first start only).
// Plain JavaScript on purpose: it must start on any Node and say plainly when Node is too old.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
const [cmd, ...args] = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(`joserah: ${m}`); process.exit(1); };
if (cmd !== 'serve' && cmd !== 'setup-link') { console.error('usage: joserah serve [--workspace <dir>] [--port <n>] | joserah setup-link [--workspace <dir>] [--port <n>]'); process.exit(1); }

function findWs(start) {
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.joserah', 'config.json'))) return d;
    if (path.dirname(d) === d) return null;
  }
}
const ws = opt('--workspace') ? path.resolve(opt('--workspace')) : findWs(process.cwd());
if (!ws) die('no workspace here — run it inside a Joserah workspace or pass --workspace <dir>');

// The same folder server/src/paths.ts stateDir() builds — keep the two in step.
function stateDir() {
  if (process.env.JOSERAH_STATE_DIR) return process.env.JOSERAH_STATE_DIR;
  const abs = path.resolve(ws);
  const key = process.platform === 'win32' ? abs.toLowerCase() : abs;   // Windows paths are case-insensitive
  return path.join(os.homedir(), '.joserah-server', crypto.createHash('sha1').update(key).digest('hex').slice(0, 12));
}

if (cmd === 'setup-link') {
  const state = stateDir();
  if (fs.existsSync(path.join(state, 'auth.json'))) { console.log('already set up — sign in at the server address'); process.exit(0); }
  let tok = ''; try { tok = fs.readFileSync(path.join(state, 'setup-token'), 'utf8').trim(); } catch { /* none yet */ }
  if (!tok) die('start the server once first (joserah serve)');
  let port = opt('--port');
  if (!port) { try { port = JSON.parse(fs.readFileSync(path.join(ws, '.joserah', 'server.json'), 'utf8').replace(/^﻿/, '')).port; } catch { /* default */ } }
  console.log(`http://127.0.0.1:${port || 4747}/setup?token=${tok}`);
  process.exit(0);
}

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 18)) die(`Node ${process.versions.node} is too old — the server needs 22.18 or newer`);
// Run the server in this process (no child): one process to stop, signals reach main.ts's own handlers, nothing is left behind.
process.argv = [process.argv[0], path.join(here, '..', 'main.ts'), '--workspace', ws, ...(opt('--port') ? ['--port', opt('--port')] : [])];
await import(pathToFileURL(path.join(here, '..', 'main.ts')).href);
