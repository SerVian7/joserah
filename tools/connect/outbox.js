'use strict';
// Joserah Connect delivery without an open inbound port: "one reachable side is enough".
// The sender queues what it could not deliver (outbox.json); the receiver collects it over its OWN outbound
// connection with a sealed `fetch`, runs every item through the same path as POST /m (listener.handleSealed),
// then acks. Delivery is at-least-once; handleSealed drops a repeated oid. Received content is only written to
// the store; nothing here opens or runs it, starts a process or wakes a session.
//
// Wire (both are ordinary sealed POST /m requests from a stored peer):
//   { type:'fetch' }                -> 200 { items:[env,...], more?:true }, env = a FRESH sealed body { from, iv, ct }
//                                      whose plaintext is the queued object plus its `oid` (new iv and ts each time);
//                                      at most 50 items or ~400 KB per answer.
//   { type:'fetch-ack', oids:[..] } -> 200 { ok:true }: those items leave the outbox.
const path = require('path');
const store = require('./store');
const cx = require('./crypto');
const http = require('./http');
const listener = require('./listener');

const KEEP_MS = 7 * 24 * 3600 * 1000;
const MAX_PER_PEER = 500;
const MAX_ITEMS = 50;
const MAX_BYTES = 400 * 1024;
const MAX_ROUNDS = 20;
const KICK_MS = 10 * 1000;

const file = (root) => path.join(store.connectDir(root), 'outbox.json');
const fresh = (list, now = Date.now()) => list.filter((x) => now - Date.parse(x.created) < KEEP_MS);

// Queue obj for `peer`; returns its oid. Old items, empty peers and peers that are gone are dropped on the way.
function queue(root, peer, obj, now = Date.now()) {
  const oid = store.newId();
  store.updateJson(file(root), {}, (all) => {
    const peers = store.readPeers(root);
    for (const k of Object.keys(all)) { all[k] = fresh(all[k], now); if (!all[k].length || !peers[k]) delete all[k]; }
    all[peer] = [...(all[peer] || []), { oid, obj, created: new Date(now).toISOString() }].slice(-MAX_PER_PEER);
  });
  return oid;
}

// Direct sealed send; when no connection could be made to any address the object is queued instead:
// resolves { queued:true, oid }. Any real answer (even an error status) is returned as http.sendToPeer returns it.
async function deliver(root, peer, obj, opts = {}) {
  try { return await http.sendToPeer(root, peer, obj, opts); }
  catch (e) {
    if (!e || !e.connect) throw e;
    return { queued: true, oid: queue(root, peer, obj) };
  }
}

// ---- answering side: what a peer's fetch gets ----
listener.registerRoutes(({ sealed }) => {
  sealed('fetch', (ctx) => {
    const list = fresh(store.readJson(file(ctx.root), {})[ctx.name] || []);
    const items = []; let bytes = 0;
    for (const it of list) {
      if (items.length >= MAX_ITEMS) break;
      const env = cx.sealRequest(ctx.root, ctx.keys, { ...it.obj, oid: it.oid });
      const n = JSON.stringify(env).length;
      if (items.length && bytes + n > MAX_BYTES) break;
      items.push(env); bytes += n;
    }
    return { items, ...(items.length < list.length ? { more: true } : {}) };
  });
  sealed('fetch-ack', (ctx) => {
    const gone = new Set((Array.isArray(ctx.msg.oids) ? ctx.msg.oids : []).filter((o) => typeof o === 'string').slice(0, 200));
    store.updateJson(file(ctx.root), {}, (all) => {
      if (!all[ctx.name]) return store.KEEP;
      all[ctx.name] = all[ctx.name].filter((x) => !gone.has(x.oid));
      if (!all[ctx.name].length) delete all[ctx.name];
    });
    return { ok: true };
  });
});

// ---- fetching side ----
// `send(obj)` posts a sealed object to the machine we collect from. Items are acked once their handler gave a final
// answer (2xx, or a 4xx other than 401/429); a 401 (tampered, replayed), a 429 or a failure is not acked.
async function pull(root, send, opts) {
  const st = opts.state || { pairHits: new Map(), now: Date.now };
  let got = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const r = await send({ type: 'fetch' });
    if (r.status === 400) return { got, skipped: true }; // an older version: it does not know `fetch`
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.items)) return { got, error: 'answered ' + r.status };
    const oids = [];
    for (const env of r.json.items.slice(0, MAX_ITEMS)) {
      let res;
      try { res = await listener.handleSealed(root, st, env, null, { fetched: true }); }
      catch (e) { res = { status: (e && e.status) || 500, oid: e && e.oid }; }
      if (res.status < 400 && !(res.body && res.body.duplicate)) got++;
      if (res.oid && res.status !== 401 && res.status !== 429 && res.status < 500) oids.push(res.oid);
    }
    if (oids.length) await send({ type: 'fetch-ack', oids }).catch(() => {});
    if (!r.json.more || !oids.length) break; // nothing acked: the same items would come back
  }
  return { got };
}

// Collect from a stored peer. Throws when it cannot be reached.
const fetchFrom = (root, peer, opts = {}) => pull(root, (obj) => http.sendToPeer(root, peer, obj), opts);

// Collect from the target of one of our open `outgoing` pair requests: the approver already knows us as a peer and
// answers; its queued accept then completes the pairing here. Keys come from the entry, as listener.sender() derives them.
function fetchOut(root, out, opts = {}) {
  const s = listener.sender(root, out.keyid);
  if (!s) return Promise.resolve({ got: 0 });
  return pull(root, (obj) => http.postSealed(root, { addresses: [out.target], port: out.port }, s.keys, obj), opts);
}

// Every peer and every open outgoing target, all at the same time (one unreachable peer must not hold a live one back).
// A target that is already being fetched (an earlier call, still waiting for a dead address) is not asked twice: its
// running fetch is shared. Never throws. { ok, got, attempted, reached }: ok is false only when something was tried and
// nothing could be reached.
const inflight = new Map();
function launch(root, opts) {
  const targets = [
    ...Object.keys(store.readPeers(root)).map((name) => ['peer:' + name, () => fetchFrom(root, name, opts)]),
    ...store.readList(root, 'outgoing').filter((o) => o.keyid).map((o) => ['out:' + o.id, () => fetchOut(root, o, opts)]),
  ];
  const fresh = [];
  const runs = targets.map(([key, run]) => {
    const id = root + '|' + key;
    if (inflight.has(id)) return inflight.get(id);
    const p = Promise.resolve().then(run).finally(() => inflight.delete(id));
    inflight.set(id, p);
    fresh.push(p.catch(() => {}));
    return p;
  });
  const result = Promise.allSettled(runs).then((all) => {
    const done = all.filter((r) => r.status === 'fulfilled');
    return { ok: !runs.length || done.length > 0, got: done.reduce((n, r) => n + r.value.got, 0), attempted: runs.length, reached: done.length };
  });
  return { result, fresh: Promise.allSettled(fresh) }; // fresh: only what this call started
}
const fetchAll = (root, opts = {}) => launch(root, opts).result;

// Poll every intervalMs; on a failed round double the wait up to maxMs, after a success go back to intervalMs.
// opts.run and opts.onTick(result, nextDelay) are for tests. Returns { stop() }.
function startPolling(root, { intervalMs = 60000, maxMs = 600000, run = fetchAll, onTick } = {}) {
  let stopped = false; let timer = null; let delay = intervalMs;
  const arm = (ms) => { timer = setTimeout(tick, ms); if (timer.unref) timer.unref(); };
  async function tick() {
    if (stopped) return;
    let res;
    try { res = await run(root); } catch { res = { ok: false }; }
    delay = res && res.ok === false ? Math.min(delay * 2, maxMs) : intervalMs;
    if (onTick) onTick(res, delay);
    if (!stopped) arm(delay);
  }
  arm(0);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

// To be called on every tool call: a fetchAll, at most once per ~10 s per root unless { force: true } (the read tools).
// Resolves null when skipped. The promise has `.fresh`: it settles when what this call started has (a fetch another call
// started and a dead address still holds is not waited for twice). (A number as the 2nd argument is the clock, for tests.)
const lastKick = new Map();
function kick(root, opts = {}) {
  const o = typeof opts === 'number' ? { now: opts } : opts;
  const now = o.now || Date.now();
  if (!o.force && now - (lastKick.get(root) || 0) < KICK_MS) return Promise.resolve(null);
  lastKick.set(root, now);
  const r = launch(root, {});
  return Object.assign(r.result.catch(() => null), { fresh: r.fresh });
}

module.exports = { queue, deliver, fetchFrom, fetchOut, fetchAll, startPolling, kick };
