'use strict';
// Joserah Connect HTTP client: plain http (the payloads are sealed, see crypto.js), address fallback.
const http = require('http');
const os = require('os');
const store = require('./store');
const cx = require('./crypto');

const MAX_BUFFERED = 1024 * 1024; // buffered replies are small json; files use stream:true
const CONNECT_MS = 3000;

// request({address, port, method, path, json, body, headers, timeout, connectTimeout, stream})
//   body: string | Buffer | readable stream (piped). json: object, sent as application/json.
//   Resolves { status, headers, json, stream }: json is the parsed reply or null; stream is the
//   unread response when stream:true. Rejects with a plain Error; err.connect is true when no
//   connection was made (refused, unreachable, connect timeout), so it is safe to try another address.
function request({ address, port, method = 'GET', path = '/', json, body, headers = {}, timeout = 15000, connectTimeout = CONNECT_MS, stream = false }) {
  return new Promise((resolve, reject) => {
    const h = { connection: 'close', ...headers };
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); h['content-type'] = 'application/json'; }
    if (typeof payload === 'string') payload = Buffer.from(payload);
    if (Buffer.isBuffer(payload)) h['content-length'] = payload.length;

    let connected = false;
    const req = http.request({ hostname: address, port, method, path, headers: h, agent: false }, (res) => {
      if (stream) return resolve({ status: res.statusCode, headers: res.headers, stream: res });
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size <= MAX_BUFFERED) chunks.push(c); });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json: parsed });
      });
      res.on('error', reject);
    });
    req.on('socket', (s) => {
      if (!s.connecting) { connected = true; return; }
      const t = setTimeout(() => req.destroy(new Error('connect timed out')), connectTimeout);
      s.once('connect', () => { connected = true; clearTimeout(t); });
      s.once('close', () => clearTimeout(t));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timed out')));
    req.on('error', (e) => reject(Object.assign(new Error('request failed: ' + (e.code || e.message)), { connect: !connected })));
    if (payload && typeof payload.pipe === 'function') payload.pipe(req);
    else req.end(payload);
  });
}

// Try each address in order; move on only when no connection could be made.
// build(address) -> extra request options. Resolves { ...reply, address } of the first that answered.
async function tryAddresses(addresses, port, build) {
  let last = new Error('no address to try');
  for (const address of addresses) {
    try { return { ...(await request({ ...build(address), address, port })), address }; }
    catch (e) { last = e; if (!e.connect) throw e; }
  }
  throw last;
}

// POST a sealed message to explicit addresses (a pair request that is not a peer yet).
const postSealed = (root, { addresses, port }, keys, obj) =>
  tryAddresses(addresses, port, () => ({ method: 'POST', path: '/m', json: cx.sealRequest(root, keys, obj) }));

// Send to a stored peer, trying its addresses (last one that worked first) and recording the one that did.
//   sendToPeer(root, name, obj)                      sealed message POST /m
//   sendToPeer(root, name, null, { path, body })     any other call, e.g. POST /f: body may be a function
//     returning a fresh stream per attempt; x-connect-from carries our keyid; stream:true keeps the reply unread.
async function sendToPeer(root, name, obj, opts = {}) {
  const rec = store.readPeers(root)[name];
  if (!rec) throw new Error('no such peer');
  const keys = cx.linkKeys(root, rec);
  const sealed = obj ? cx.sealRequest(root, keys, obj) : null;
  const r = await tryAddresses(rec.addresses, rec.port, () => ({
    method: opts.method || 'POST',
    path: opts.path || '/m',
    ...(sealed ? { json: sealed } : { body: typeof opts.body === 'function' ? opts.body() : opts.body }),
    headers: { ...(sealed ? {} : { 'x-connect-from': cx.identity(root).keyid }), ...(opts.headers || {}) },
    stream: !!opts.stream,
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
  }));
  store.noteAddress(root, name, r.address);
  return r;
}

// This machine's non-internal interface addresses (no IPv6 link-local), sent to a peer so it can reach us.
function ownAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (!a.internal && !/^fe80:/i.test(a.address)) out.push(a.address);
  }
  return out.slice(0, 8);
}

module.exports = { request, tryAddresses, postSealed, sendToPeer, ownAddresses };
