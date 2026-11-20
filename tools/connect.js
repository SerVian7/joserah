#!/usr/bin/env node
/**
 * Joserah Connect CLI. Connect sets itself up when a session starts; `setup` is only an override.
 *   setup [--name <device name>] [--port 4790] [--bind <addr>[,<addr>]]   (no password; nothing is read from stdin)
 *   status
 * Owner workspaces keep the settings in the device folder under the home, guest workspaces in the workspace itself.
 * Without --bind the listener takes every interface. Status never prints a key.
 */
'use strict';
const net = require('net');
const path = require('path');
const { findWorkspace } = require('../hooks/lib/workspace');

function die(msg) { process.stderr.write(msg + '\n'); process.exit(1); }

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i];
  }
  return o;
}

const lib = (f) => { try { return require('./connect/' + f); } catch { return die('Connect is incomplete in this install (' + f + ' missing).'); } };

// Where this workspace's Connect state lives: owner trust = the device folder under the home, guest = the workspace.
function where(root) {
  const device = lib('device');
  const info = device.resolve(root);
  return { device, info, dir: lib('store').connectDir(info.deviceRoot) };
}

function setup(root, o) {
  const store = lib('store'); const config = lib('config');
  let { device, info } = where(root);
  if (info.mode === 'owner') { try { device.migrate(root); info = device.resolve(root); } catch { /* the next start tries again */ } }
  const stored = store.readJson(path.join(store.connectDir(info.deviceRoot), 'config.json'), {}) || {};
  const name = o.name !== undefined ? o.name : stored.name;
  if (!name || !/^[a-z0-9._-]{1,40}$/.test(name)) die('--name <name> is required: lowercase letters, digits, . _ -, up to 40.');
  const port = o.port === undefined ? (stored.port !== undefined ? stored.port : lib('startup').defaultPort()) : Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) die('--port must be a number from 0 to 65535.');
  const cfg = { name, port, ...(stored.smallFileMax !== undefined ? { smallFileMax: stored.smallFileMax } : {}) };
  if (o.bind !== undefined) {
    const bind = String(o.bind).split(',').map((a) => a.trim()).filter(Boolean);
    const bad = bind.find((a) => !net.isIP(a));
    if (!bind.length || bad !== undefined) die(`--bind takes IP addresses separated by commas (not hostnames): ${bad || '(empty)'}`);
    cfg.bind = bind;
  }
  config.saveConfig(info.deviceRoot, cfg);
  device.registerSession(device.resolve(root));
  console.log(`Connect set up: name ${name}, port ${port}, ${cfg.bind ? 'listening on ' + cfg.bind.join(', ') : 'listening on all interfaces'}. Restart the Claude session so the listener starts.`);
}

function status(root) {
  const store = lib('store');
  const { info, dir } = where(root);
  const j = (f, fallback) => store.readJson(path.join(dir, f), fallback);
  const cfg = j('config.json', {}) || {};
  const peers = Object.entries(j('peers.json', {})).map(([n, p]) => `${p && p.person && p.device ? p.person + '/' + p.device : n} (${(p && p.keyid) || 'no key id'})`);
  const cutoff = Date.now() - 10 * 60000;
  const pend = j('pending.json', []);
  const waiting = (Array.isArray(pend) ? pend : []).filter((p) => p && !p.open && new Date(p.created).getTime() >= cutoff).length;
  const outbox = Object.values(j('outbox.json', {}) || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  const rec = j('listener.json', {}) || {};
  let alive = false;
  if (rec.pid) { try { process.kill(rec.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
  const bind = Array.isArray(cfg.bind) && cfg.bind.length ? cfg.bind.join(', ') : 'all interfaces';
  const fw = j('firewall.json', {}) || {};
  console.log([
    `mode: ${info.mode}`,
    `address: ${info.person}/${info.device}/${info.session}`,
    `name: ${cfg.name || '(not set up yet; it is made when the next Claude session starts)'}`,
    `port: ${cfg.port === undefined ? '(not set yet)' : cfg.port}`,
    `bind: ${bind}`,
    `listener: ${alive ? `running (pid ${rec.pid})` : 'not running'}`,
    `peers: ${peers.join(', ') || '(none)'}`,
    `pending: ${waiting}`,
    `outbox: ${outbox}`,
    `firewall: ${fw.state || 'not checked yet'}`,
  ].join('\n'));
}

const [cmd, ...rest] = process.argv.slice(2);
const root = findWorkspace(process.env.CLAUDE_PROJECT_DIR || process.cwd());
if (!root) die('Not inside a Joserah workspace.');
if (cmd === 'setup') setup(root, parse(rest));
else if (cmd === 'status') status(root);
else die('Usage: connect.js setup [--name <device name>] [--port 4790] [--bind <addr>[,<addr>]] | status');
