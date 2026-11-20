'use strict';
// Joserah Connect startup: what runs before the first tool call. No setup command is needed any more:
// the workspace is resolved (owner: device folder under the home; guest: the workspace itself), older v1 files are
// moved, the device config is made when missing, and this session is registered so one listener can route to it.
const store = require('./store');
const config = require('./config');
const device = require('./device');
const http = require('./http');

// JOSERAH_CONNECT_PORT (tests, smoke) or 4790. 0 asks the OS for a free port; the real one is then saved.
function defaultPort() {
  const e = process.env.JOSERAH_CONNECT_PORT;
  const n = e === undefined || e === '' ? 4790 : Number(e);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 4790;
}

// -> { info, warnings: [plain sentences, never a key or a path to one] }. Throws only on a real I/O failure.
function prepare(root) {
  const warnings = [];
  let info = device.resolve(root);
  if (info.mode === 'owner') {
    try {
      const m = device.migrate(root);
      if (m.conflict) warnings.push('this workspace has an older Connect identity that differs from the device\'s; it was left alone');
      if (m.invalid) warnings.push('this workspace has an older Connect key file that could not be read; it was left alone');
    } catch (e) { warnings.push('could not move the older Connect files: ' + (e && e.code ? e.code : 'error')); }
    info = device.resolve(root); // the moved config may carry the device name
  }
  const file = require('path').join(store.connectDir(info.deviceRoot), 'config.json');
  store.updateJson(file, {}, (c) => (c.name ? store.KEEP : { ...c, name: info.device, port: c.port !== undefined ? c.port : defaultPort() }));
  device.registerSession(info);
  return { info, warnings };
}

// Ask what listens on 127.0.0.1:port. -> the key id it answered with, 'other' (something that is not Connect, or
// that did not answer properly), or null (no connection could be made).
async function probe(port) {
  try {
    const r = await http.request({ address: '127.0.0.1', port, path: '/id', timeout: 2000, connectTimeout: 1500 });
    return r.status === 200 && r.json && typeof r.json.keyid === 'string' ? r.json.keyid : 'other';
  } catch (e) { return e && e.connect ? null : 'other'; }
}

// startListener with a port choice for keepListening. When the port is taken: our own person-device (same key id) or
// nothing that answers -> the original error, so keepListening waits and retries; anything else -> the next free port
// upward, saved in the device config (startListener does that), and onMoved(from, to) is told.
function chooser(deviceRoot, keyid, onMoved) {
  const listener = require('./listener');
  return async function start(root, opts) {
    try { return await listener.startListener(root, opts); } catch (e) {
      if (!e || e.code !== 'EADDRINUSE') throw e;
      const port = opts.port !== undefined ? opts.port : config.loadConfig(root).port;
      const holder = await probe(port);
      if (holder === null || holder === keyid) throw e;
      for (let p = port + 1; p <= Math.min(port + 200, 65535); p++) {
        try { const s = await listener.startListener(root, { ...opts, port: p }); onMoved(port, s.port); return s; }
        catch (e2) { if (!e2 || e2.code !== 'EADDRINUSE') throw e2; }
      }
      throw e;
    }
  };
}

module.exports = { prepare, chooser, probe, defaultPort };
