#!/usr/bin/env node
/**
 * Joserah Connect CLI.
 *   setup --name <username> [--port 4790] [--bind <addr>[,<addr>]]   (no password; nothing is read from stdin)
 *   status
 * Without --bind the listener takes every interface. Status never prints a key.
 */
'use strict';
const fs = require('fs');
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

const connectFile = (root, f) => path.join(root, '.joserah', 'connect', f);
function readJson(root, f, fallback) {
  try { return JSON.parse(fs.readFileSync(connectFile(root, f), 'utf8')); } catch { return fallback; }
}

function setup(root, o) {
  const name = o.name;
  if (!name || !/^[a-z0-9._-]{1,40}$/.test(name)) die('--name <username> is required: lowercase letters, digits, . _ -, up to 40.');
  const port = o.port === undefined ? 4790 : Number(o.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) die('--port must be a number from 1 to 65535.');
  const cfg = { name, port };
  if (o.bind !== undefined) {
    const bind = String(o.bind).split(',').map((a) => a.trim()).filter(Boolean);
    const bad = bind.find((a) => !net.isIP(a));
    if (!bind.length || bad !== undefined) die(`--bind takes IP addresses separated by commas (not hostnames): ${bad || '(empty)'}`);
    cfg.bind = bind;
  }
  let config;
  try { config = require('./connect/config'); } catch { die('Connect is incomplete in this install (config.js missing).'); }
  config.saveConfig(root, cfg);
  console.log(`Connect set up: name ${name}, port ${port}, ${cfg.bind ? 'listening on ' + cfg.bind.join(', ') : 'listening on all interfaces'}. Restart the Claude session so the listener starts.`);
}

function status(root) {
  const cfg = readJson(root, 'config.json', null);
  if (!cfg || !cfg.name) die('Connect is not set up. Run: setup --name <name>');
  const peers = Object.entries(readJson(root, 'peers.json', {})).map(([n, p]) => `${n} (${(p && p.keyid) || 'no key id'})`);
  const pend = readJson(root, 'pending.json', []);
  const cutoff = Date.now() - 10 * 60000;
  const waiting = (Array.isArray(pend) ? pend : []).filter((p) => new Date(p.created).getTime() >= cutoff).length;
  const bind = Array.isArray(cfg.bind) && cfg.bind.length ? cfg.bind.join(', ') : 'all interfaces';
  console.log(`name: ${cfg.name}\nport: ${cfg.port || 4790}\nbind: ${bind}\npeers: ${peers.join(', ') || '(none)'}\npending: ${waiting}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const root = findWorkspace(process.env.CLAUDE_PROJECT_DIR || process.cwd());
if (!root) die('Not inside a Joserah workspace.');
if (cmd === 'setup') setup(root, parse(rest));
else if (cmd === 'status') status(root);
else die('Usage: connect.js setup --name <username> [--port 4790] [--bind <addr>[,<addr>]] | status');
