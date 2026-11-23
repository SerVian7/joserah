'use strict';
// Joserah Connect listener. Receiving only writes files; nothing here starts, wakes or resumes anything.
const http = require('http');
const net = require('net');
const path = require('path');
const config = require('./config');
const store = require('./store');
const cx = require('./crypto');
const device = require('./device');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// 'message' { root, dest, peer, message }: a verified message from a paired peer was just stored in the inbox `dest`.
// In-process only (the MCP layer turns it into a channel notification); nothing here starts or wakes anything.
const events = new EventEmitter();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PAIR_PER_IP = 5;
const MAX_PENDING = 10;
const MAX_TEXT = 64 * 1024;       // message text, UTF-8 bytes
const MAX_JSON = 4096;            // pairing bodies
const MAX_SEALED = 512 * 1024;    // a sealed message (64 KB of text, escaped and base64)
const HEX = (n) => new RegExp('^[0-9a-f]{' + n + '}$');
const isB64 = (s, bytes) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && cx.unb64(s).length === bytes;

// ---- route table ----------------------------------------------------------
const routes = [];
const sealedTypes = new Map();

function route(method, pattern, handler) {
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  routes.push({ method, re, names, handler });
}

// A handler for sealed requests of one `type` (POST /m). Runs only after the seal opened and the replay
// checks passed. { pairing:true } also lets a machine we asked to pair (not yet a peer) send this type.
const sealed = (type, fn, opts = {}) => sealedTypes.set(type, { fn, pairing: !!opts.pairing });

function send(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj === undefined ? {} : obj));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { chunks.length = 0; return reject(Object.assign(new Error('too large'), { status: 413 })); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const remoteOf = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

// Who is `from` (a key id)? { name, rec, keys } for a peer; { out, keys } for a machine we asked to pair
// (its sealed accept/refuse); null when unknown. For files.js: sender(root, req.headers['x-connect-from']).
function sender(root, from) {
  if (typeof from !== 'string' || !HEX(16).test(from)) return null;
  const peer = store.peerByKeyid(root, from);
  if (peer) return { name: peer.name, rec: peer, keys: cx.linkKeys(root, peer) };
  const out = store.readList(root, 'outgoing').find((e) => e.keyid === from);
  if (!out) return null;
  const me = cx.identity(root);
  const salt = cx.pairSalt(me.pub, cx.unb64(out.pubB), cx.unb64(out.nA), cx.unb64(out.nB));
  return { out, keys: cx.deriveKeys(me, cx.unb64(out.pubB), salt) };
}

// Used by files.js (and anyone else) to add handlers; fn receives { route, sealed, sender, send, readBody }:
//   route(method, '/path/:param', handler)  handler(ctx), ctx = { root, req, res, params, state, remote, config,
//     send(status, obj), json(max) }. Every route does its own authentication (sender + cx.frameReader
//     + store.checkReplay for a stream like POST /f). Throw {status, message} to answer an error.
//   sealed(type, fn, {pairing})             fn(ctx) with ctx as above plus { name, rec, keys, msg } (msg = the
//     opened, replay-checked plaintext object). Return an object (sent as 200) or answer/stream on ctx.res.
function registerRoutes(fn) { fn({ route, sealed, sender, send, readBody }); }

async function dispatch(root, state, req, res) {
  const reply = (status, obj) => send(res, status, obj);
  const pathname = new URL(req.url, 'http://x').pathname;
  let hit = null; let params = {};
  for (const r of routes) {
    const m = r.method === req.method && r.re.exec(pathname);
    if (m) { hit = r; params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])); break; }
  }
  if (!hit) return reply(404, { error: 'not found' });
  const ctx = {
    root, req, res, params, state, remote: remoteOf(req), config: config.loadConfig(root), send: reply,
    json: async (max = MAX_JSON) => {
      try { const o = JSON.parse((await readBody(req, max)).toString('utf8')); if (o && typeof o === 'object') return o; } catch (e) { if (e.status) throw e; }
      throw Object.assign(new Error('bad json'), { status: 400 });
    },
  };
  try { await hit.handler(ctx); } catch (e) {
    if (res.headersSent) return res.destroy();
    if (e && e.status) { res.setHeader('connection', 'close'); return reply(e.status, { error: e.message }); }
    reply(500, { error: 'server error' });
  }
}

// ---- core routes ----------------------------------------------------------
registerRoutes(({ route: add, sealed: onSealed }) => {
  // Public: which key listens here. A second Connect on this machine asks it before it decides to wait or to move.
  add('GET', '/id', (ctx) => ctx.send(200, { keyid: cx.identity(ctx.root).keyid }));

  // Pair step 1 (cleartext, no secret): rate limited per source IP, capped in total, half-open until the reveal.
  add('POST', '/pair', async (ctx) => {
    const { root, state, remote } = ctx;
    const now = state.now();
    const hits = (state.pairHits.get(remote) || []).filter((t) => now - t < WINDOW_MS);
    state.pairHits.set(remote, hits);
    if (hits.length >= MAX_PAIR_PER_IP) return ctx.send(429, { error: 'too many pairing requests, try again later' });
    hits.push(now);
    const b = await ctx.json();
    if (!store.validPeerName(b.username) || !HEX(16).test(b.id) || !HEX(64).test(b.commit)) return ctx.send(400, { error: 'bad request' });
    if (!ctx.config.name) return ctx.send(503, { error: 'this machine is not set up yet' });
    if (store.readPeers(root)[b.username]) return ctx.send(409, { error: 'already connected under that name' });
    const nB = crypto.randomBytes(32);
    let refused = null;
    store.updateList(root, 'pending', (list) => {
      if (list.length >= MAX_PENDING) { refused = [429, 'too many pending requests']; return store.KEEP; }
      if (list.some((e) => e.id === b.id)) { refused = [409, 'duplicate request']; return store.KEEP; }
      list.push({ id: b.id, username: b.username, ...(store.validSegment(b.person) ? { person: b.person } : {}), ...(store.validSegment(b.device) ? { device: b.device } : {}),
        commit: b.commit, nB: cx.b64(nB), address: remote, created: new Date(now).toISOString(), open: true });
    });
    if (refused) return ctx.send(refused[0], { error: refused[1] });
    const me = device.self(root);
    ctx.send(200, { name: ctx.config.name, person: me.person, device: me.device, pub: cx.identity(root).pubB64, nonce: cx.b64(nB) });
  });

  // Pair step 2: the reveal must match the commit; then the request is pending for the owner, with its code.
  add('POST', '/pair/reveal', async (ctx) => {
    const { root, remote } = ctx;
    const b = await ctx.json();
    let answer = [404, { error: 'no such request' }];
    store.updateList(root, 'pending', (list) => {
      const e = list.find((x) => x.id === b.id && x.open);
      if (!e) return store.KEEP;
      const drop = (status, error) => { answer = [status, { error }]; return list.filter((x) => x !== e); };
      if (!isB64(b.pub, 32) || !isB64(b.nonce, 32)) return drop(400, 'bad request');
      const pubA = cx.unb64(b.pub); const nA = cx.unb64(b.nonce);
      const want = Buffer.from(cx.commit(pubA, nA)); const have = Buffer.from(e.commit);
      if (want.length !== have.length || !crypto.timingSafeEqual(want, have)) return drop(400, 'reveal does not match the commitment');
      const port = Number(b.port);
      if (!(port > 0 && port < 65536) || !Array.isArray(b.addresses)) return drop(400, 'bad request');
      const me = cx.identity(root);
      const nB = cx.unb64(e.nB);
      const addresses = [...new Set([remote, ...b.addresses.filter((a) => net.isIP(a))])].slice(0, 8);
      Object.assign(e, {
        open: false, pub: b.pub, keyid: cx.keyid(pubA), nA: b.nonce, addresses, port,
        code: cx.sasCode(pubA, me.pub, nA, nB), created: new Date(ctx.state.now()).toISOString(),
      });
      delete e.commit; delete e.address;
      answer = [202, { pending: e.id }];
    });
    ctx.send(answer[0], answer[1]);
  });

  // Sealed answers to our own pair request (the sender is not a peer yet).
  onSealed('accept', (ctx) => {
    const { root, out, msg } = ctx;
    if (!store.validPeerName(msg.name)) throw Object.assign(new Error('bad name'), { status: 400 });
    const pubB = cx.unb64(out.pubB);
    const me = cx.identity(root);
    if (store.readPeers(root)[msg.name] || store.peerByKeyid(root, out.keyid)) throw Object.assign(new Error('already connected'), { status: 409 });
    const salt = cx.pairSalt(me.pub, pubB, cx.unb64(out.nA), cx.unb64(out.nB)).toString('hex');
    const port = Number(msg.port) > 0 && Number(msg.port) < 65536 ? Number(msg.port) : out.port;
    const addresses = [...new Set([out.target, ...(Array.isArray(msg.addresses) ? msg.addresses.filter((a) => net.isIP(a)) : [])])].slice(0, 8);
    const person = [msg.person, out.person].find(store.validSegment); const dev = [msg.device, out.device].find(store.validSegment);
    store.setPeer(root, msg.name, { pub: out.pubB, keyid: out.keyid, salt, addresses, port, ...(person ? { person } : {}), ...(dev ? { device: dev } : {}) });
    store.removeEntry(root, 'outgoing', out.id);
    return { ok: true };
  }, { pairing: true });
  onSealed('refuse', (ctx) => {
    if (!store.validPeerName(ctx.msg.name)) throw Object.assign(new Error('bad name'), { status: 400 });
    store.removeEntry(ctx.root, 'outgoing', ctx.out.id);
    store.appendMessage(ctx.root, ctx.msg.name, { dir: 'in', kind: 'notice', text: 'pairing request was refused' });
    return { ok: true };
  }, { pairing: true });

  // A peer asks who this device is: person, device and the sessions registered here.
  onSealed('who', (ctx) => device.self(ctx.root));

  onSealed('disconnect', (ctx) => { store.removePeer(ctx.root, ctx.name); return { ok: true }; });

  onSealed('message', (ctx) => {
    const m = ctx.msg;
    if (typeof m.text !== 'string' || !m.text || !HEX(16).test(m.id)) throw Object.assign(new Error('bad message'), { status: 400 });
    if (Buffer.byteLength(m.text) > MAX_TEXT) throw Object.assign(new Error('message over 64 KB'), { status: 413 });
    // `to` names a session registered here: that workspace's own inbox; no `to` (a v1 sender) or an unknown one: the device's shared inbox
    const to = store.validSegment(m.to) ? m.to : undefined;
    const dest = device.inboxRoot(ctx.root, to);
    if (store.readMessages(dest, ctx.name).some((x) => x.id === m.id)) return { ok: true }; // already logged: at-least-once delivery
    const line = store.appendMessage(dest, ctx.name, { id: m.id, dir: 'in', text: m.text, to, reply_to: typeof m.reply_to === 'string' && m.reply_to.length <= 64 ? m.reply_to : undefined });
    try { events.emit('message', { root: ctx.root, dest, peer: ctx.name, message: line }); } catch { /* a listener of the event must never fail a delivery */ }
    return { ok: true };
  });

  // POST /m: every authenticated call; the work is handleSealed, which a fetch (outbox.js) runs too.
  add('POST', '/m', async (ctx) => {
    let env;
    try { env = JSON.parse((await readBody(ctx.req, MAX_SEALED)).toString('utf8')); } catch (e) { if (e.status) throw e; return ctx.send(400, { error: 'bad request' }); }
    const r = await handleSealed(ctx.root, ctx.state, env, ctx.remote, ctx);
    if (!ctx.res.headersSent) ctx.send(r.status, r.body || { ok: true });
  });
});

// A sealed envelope { from, iv, ct }, from POST /m or from an outbox fetch: sender lookup, seal open, replay check,
// type dispatch. Resolves { status, body, oid }; a handler's {status} error is thrown (with .oid). `ctx` is the base
// handler context (a fetch passes { fetched: true }); `remote` the source address, or null for a fetch.
// Unknown sender, a seal that does not open, a stale ts or a repeated iv: 401.
// An envelope with an `oid` (a queued item) runs its handler once: a repeat answers 200 { duplicate:true } (delivered.json).
async function handleSealed(root, state, env, remote, ctx = {}) {
  const s = sender(root, env && env.from);
  const msg = s && cx.open(s.keys.recv, env, cx.requestAad(env.from));
  if (!msg || typeof msg.type !== 'string' || !store.checkReplay(root, env.from, env.iv, msg.ts, state.now())) return { status: 401, body: { error: 'not accepted' } };
  const h = sealedTypes.get(msg.type);
  if (!h) return { status: 400, body: { error: 'unknown type' } };
  if (!s.rec && !h.pairing) return { status: 401, body: { error: 'not accepted' } };
  if (s.rec && remote) store.addAddress(root, s.name, remote);
  const oid = typeof msg.oid === 'string' && HEX(16).test(msg.oid) ? msg.oid : null;
  if (oid && !claim(root, env.from, oid, state.now())) return { status: 200, body: { ok: true, duplicate: true }, oid };
  try {
    const result = await h.fn({ root, state, remote, config: config.loadConfig(root), ...ctx, ...s, msg });
    return { status: 200, body: result, oid };
  } catch (e) {
    // a failure worth retrying (or one nobody answered) frees the oid; any other answer is final
    if (oid && (!e || !e.status || e.status === 429 || e.status >= 500)) release(root, env.from, oid);
    if (e && typeof e === 'object') e.oid = oid;
    throw e;
  }
}

// delivered.json: { keyid: { oid: ms } }, kept 14 days.
const DELIVERED_KEEP_MS = 14 * 24 * 3600 * 1000;
const deliveredFile = (root) => path.join(store.connectDir(root), 'delivered.json');
function claim(root, from, oid, now) {
  let fresh = false;
  store.updateJson(deliveredFile(root), {}, (d) => {
    for (const k of Object.keys(d)) {
      for (const i of Object.keys(d[k])) if (now - d[k][i] > DELIVERED_KEEP_MS) delete d[k][i];
      if (!Object.keys(d[k]).length) delete d[k];
    }
    const mine = d[from] || (d[from] = {});
    if (mine[oid]) return;
    mine[oid] = now;
    fresh = true;
  });
  return fresh;
}
function release(root, from, oid) {
  store.updateJson(deliveredFile(root), {}, (d) => { if (d[from]) delete d[from][oid]; });
}

// ---- server ---------------------------------------------------------------
// startListener(root, { port, bind, now }) -> Promise<Array<http.Server>> with .port and .close().
// No bind: every interface (:: dual stack, else 0.0.0.0). bind: ["addr", ...] = one server each; every entry
// must pass checkBind. A port in use rejects with the EADDRINUSE error. The real port goes back into config.json.
// `now` is a clock function, for tests.
async function startListener(root, opts = {}) {
  const cfg = config.loadConfig(root);
  const bind = opts.bind !== undefined ? opts.bind : cfg.bind;
  const list = bind == null ? null : [].concat(bind);
  for (const a of list || []) if (!config.checkBind(a).ok) throw new Error('refusing to listen on ' + JSON.stringify(a) + ': ' + config.checkBind(a).reason);
  const state = { pairHits: new Map(), now: opts.now || Date.now };
  const make = () => http.createServer((req, res) => {
    dispatch(root, state, req, res).catch(() => { try { res.destroy(); } catch { /* gone */ } });
  });
  const listen = (host, port) => new Promise((resolve, reject) => {
    const s = make();
    s.once('error', reject);
    s.listen({ port, host, ipv6Only: false }, () => resolve(s));
  });
  const servers = [];
  try {
    let port = opts.port !== undefined ? opts.port : cfg.port;
    if (!list || !list.length) {
      try { servers.push(await listen('::', port)); }
      catch (e) { if (e.code === 'EADDRINUSE') throw e; servers.push(await listen('0.0.0.0', port)); }
    } else {
      for (const a of list) { servers.push(await listen(a, port)); port = servers[0].address().port; }
    }
  } catch (e) { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); throw e; }
  servers.port = servers[0].address().port;
  servers.close = () => Promise.all(servers.map((s) => new Promise((r) => { s.close(r); if (s.closeAllConnections) s.closeAllConnections(); })));
  if (cfg.port !== servers.port) store.updateJson(path.join(store.connectDir(root), 'config.json'), {}, (c) => ({ ...cfg, ...c, port: servers.port }));
  return servers;
}

module.exports = { events, startListener, registerRoutes, handleSealed, sender, readBody, send };
