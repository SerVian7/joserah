'use strict';
// Joserah Connect settings: this machine's name, the port, and an optional list of addresses to listen on.
const net = require('net');
const path = require('path');
const store = require('./store');

const DEFAULTS = { name: '', port: 4790, smallFileMax: 10485760 };
const file = (root) => path.join(store.connectDir(root), 'config.json');

const loadConfig = (root) => ({ ...DEFAULTS, ...store.readJson(file(root), {}) });
const saveConfig = (root, cfg) => store.writeJson(file(root), cfg);

// An entry of the optional `bind` list: a literal IP address. Hostnames and garbage are refused.
function checkBind(addr) {
  if (typeof addr !== 'string' || !addr) return { ok: false, reason: 'no address given' };
  if (!net.isIP(addr)) return { ok: false, reason: 'not an IP address (hostnames are not allowed)' };
  return { ok: true };
}

module.exports = { DEFAULTS, loadConfig, saveConfig, checkBind };
