'use strict';
// Joserah Connect: keep a listener up. Only one process can hold the port; the others wait for it with a
// growing pause and take over when the holder goes away. The holder is recorded in listener.json.
const path = require('path');
const store = require('./store');

const recordFile = (root) => path.join(store.connectDir(root), 'listener.json');

// keepListening(root, { port, bind, retryMs = 5000, maxRetryMs = 60000, onListening(servers, { afterRetry }),
//   onError(err, { first }), startListener }) -> { stop(): Promise, listening: boolean, ready: Promise }
// `ready` resolves once the first attempt has ended, whichever way. EADDRINUSE: pause retryMs, then double up to
// maxRetryMs (+-10% jitter). Any other error is reported and retried at maxRetryMs. Runs until stop().
function keepListening(root, opts = {}) {
  const { port, bind, onListening, onError } = opts;
  const retryMs = opts.retryMs || 5000;
  const maxRetryMs = opts.maxRetryMs || 60000;
  const start = opts.startListener || ((r, o) => require('./listener').startListener(r, o));
  let stopped = false; let servers = null; let timer = null; let pause = retryMs; let tries = 0; let inflight = null;
  let firstDone;
  const ready = new Promise((r) => { firstDone = r; });

  const attempt = async () => {
    timer = null;
    if (stopped) return;
    const first = tries++ === 0;
    try {
      const s = await start(root, { port, bind });
      if (stopped) { await s.close(); return; }
      servers = s;
      try { store.updateJson(recordFile(root), {}, () => ({ pid: process.pid, port: s.port, since: new Date().toISOString() })); } catch { /* the record is a courtesy */ }
      if (onListening) onListening(s, { afterRetry: !first });
    } catch (e) {
      if (stopped) return;
      if (onError) { try { onError(e, { first }); } catch { /* the caller's problem */ } }
      const wait = e && e.code === 'EADDRINUSE' ? pause : maxRetryMs;
      pause = Math.min(pause * 2, maxRetryMs);
      timer = setTimeout(() => { inflight = attempt(); }, Math.round(wait * (0.9 + Math.random() * 0.2)));
    } finally { firstDone(); }
  };
  inflight = attempt();

  return {
    ready,
    get listening() { return !!servers; },
    async stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      await inflight;
      const s = servers; servers = null;
      if (!s) return;
      await s.close();
      try { store.updateJson(recordFile(root), {}, (d) => (d.pid === process.pid ? {} : store.KEEP)); } catch { /* as above */ }
    },
  };
}

module.exports = { keepListening, recordFile };
