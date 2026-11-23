'use strict';
// Joserah Connect: what the MCP tools call. Every function takes the device root first (the workspace itself in guest
// mode: v1 layout) and returns { ok:true, ... } or { ok:false, error }; none throws, none returns a key. Where a
// workspace has its own inbox (inbox, reply, unreadSummary, files) it is an optional extra argument, default = root.
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const config = require('./config');
const cx = require('./crypto');
const net = require('./http');
const outbox = require('./outbox');
const device = require('./device');
const addressing = require('./address');
const peerdata = require('./peerdata');

const MAX_TEXT = 64 * 1024;
const fail = (error, status) => ({ ok: false, error, ...(status ? { status } : {}) });
const pairError = { 400: 'the other machine rejected the request', 409: 'that username is already connected there', 429: 'too many pairing requests there, try again in a few minutes', 503: 'the other machine is not set up yet' };
const oops = (e) => fail('could not do that: ' + (e && e.message ? String(e.message).slice(0, 120) : 'error'));
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return oops(e); } };
const safeSync = (fn) => (...a) => { try { return fn(...a); } catch (e) { return oops(e); } };

// "host", "host:4790", "1.2.3.4:4790", "[::1]:4790", "::1" -> { host, port }
function parseTarget(address, port) {
  let host = String(address || '').trim(); let p = port;
  const m = /^\[(.+)\](?::(\d+))?$/.exec(host) || (/^[^:]+:(\d+)$/.test(host) ? [null, host.split(':')[0], host.split(':')[1]] : null);
  if (m) { host = m[1]; p = p || m[2]; }
  return /^[A-Za-z0-9._:-]+$/.test(host) ? { host, port: Number(p) || 4790 } : null;
}

// connect(root, address, username[, port]): ask another machine to pair. `username` is the name that machine
// will know us by. Returns { ok, id, code, keyid } where code is the six digits both owners may compare.
async function connect(root, address, username, port) {
  const t = parseTarget(address, port);
  if (!t) return fail('give the other machine as an IP address or name, optionally with :port');
  const cfg = config.loadConfig(root);
  if (!cfg.name) return fail('this machine has no name yet');
  if (username === undefined || username === null || username === '') username = cfg.name; // what the other side calls us
  if (!store.validPeerName(username)) return fail('the username must be 1-40 characters of a-z 0-9 . _ -');
  const self = device.self(root);
  const me = cx.identity(root);
  const id = store.newId();
  const nA = crypto.randomBytes(32);
  const call = (p, json) => net.request({ address: t.host, port: t.port, method: 'POST', path: p, json });
  let r1;
  try { r1 = await call('/pair', { id, username, person: self.person, device: self.device, commit: cx.commit(me.pub, nA) }); } catch { return fail('could not reach ' + t.host + ':' + t.port); }
  if (r1.status !== 200) return fail(pairError[r1.status] || 'the other machine answered ' + r1.status, r1.status);
  const j = r1.json || {};
  if (!store.validPeerName(j.name) || typeof j.pub !== 'string' || typeof j.nonce !== 'string' || cx.unb64(j.pub).length !== 32 || cx.unb64(j.nonce).length !== 32) return fail('the other machine sent something unusable');
  const pubB = cx.unb64(j.pub); const nB = cx.unb64(j.nonce);
  store.updateList(root, 'outgoing', (l) => [...l, { id, username, target: t.host, port: t.port, pubB: j.pub, keyid: cx.keyid(pubB), nA: cx.b64(nA), nB: j.nonce, name: j.name, ...(store.validSegment(j.person) ? { person: j.person } : {}), ...(store.validSegment(j.device) ? { device: j.device } : {}), created: new Date().toISOString() }]);
  let r2;
  try { r2 = await call('/pair/reveal', { id, pub: me.pubB64, nonce: cx.b64(nA), addresses: net.ownAddresses(), port: cfg.port }); } catch { r2 = null; }
  if (!r2 || r2.status !== 202) {
    store.removeEntry(root, 'outgoing', id);
    return r2 ? fail(pairError[r2.status] || 'the other machine answered ' + r2.status, r2.status) : fail('lost contact with ' + t.host);
  }
  return { ok: true, id, peer: j.name, keyid: cx.keyid(pubB), code: cx.sasCode(me.pub, pubB, nA, nB), message: 'asked; the owner there must approve; the code to compare is shown' };
}

const pending = safeSync((root, now) => ({
  ok: true,
  pending: store.readList(root, 'pending', now).filter((e) => !e.open).map(({ id, username, person, device: dev, keyid, code, addresses, created }) => ({ id, username, person, device: dev, keyid, code, addresses, created })),
}));

// Approve: store the peer, then tell the other machine with a sealed accept. Refuse: sealed refuse, nothing stored.
async function answer(root, id, approve, now) {
  const e = store.readList(root, 'pending', now).find((x) => x.id === id && !x.open);
  if (!e) return fail('no such pairing request (it may have expired)');
  const cfg = config.loadConfig(root);
  if (!cfg.name) return fail('this machine has no name yet');
  const me = cx.identity(root);
  const salt = cx.pairSalt(cx.unb64(e.pub), me.pub, cx.unb64(e.nA), cx.unb64(e.nB));
  const self = device.self(root);
  const body = approve ? { type: 'accept', name: cfg.name, person: self.person, device: self.device, addresses: net.ownAddresses(), port: cfg.port } : { type: 'refuse', name: cfg.name };
  if (approve && (store.readPeers(root)[e.username] || store.peerByKeyid(root, e.keyid))) return fail('already connected');
  let claimed = false; // two answers at once: only one gets to take the request
  store.updateList(root, 'pending', (l) => (l.some((x) => x.id === id && !x.open) ? (claimed = true, l.filter((x) => x.id !== id)) : store.KEEP), now);
  if (!claimed) return fail('no such pairing request (it may have expired)');
  if (approve) store.setPeer(root, e.username, { pub: e.pub, keyid: e.keyid, salt: salt.toString('hex'), addresses: e.addresses, port: e.port, ...(e.person ? { person: e.person } : {}), ...(e.device ? { device: e.device } : {}) });
  let warning; let queued;
  try {
    if (approve) { // the requester is a stored peer now: an unreachable one collects the accept by fetching
      const r = await outbox.deliver(root, e.username, body);
      if (r.queued) queued = true;
      else if (r.status !== 200) warning = e.username + ' did not confirm (answered ' + r.status + ')';
    } else {
      const r = await net.postSealed(root, e, cx.deriveKeys(me, cx.unb64(e.pub), salt), body);
      if (r.status !== 200) warning = e.username + ' did not confirm (answered ' + r.status + ')';
    }
  } catch { warning = e.username + ' could not be reached; ' + (approve ? 'they are kept as a peer here' : 'the refusal was not delivered'); }
  return { ok: true, peer: e.username, ...(queued ? { queued: true, note: e.username + ' cannot be reached right now; the approval waits until they collect it' } : {}), ...(warning ? { warning } : {}) };
}
const approve = safe((root, id, now) => answer(root, id, true, now));
const refuse = safe((root, id, now) => answer(root, id, false, now));

const addressOf = (name, p) => (p.person && p.device ? p.person + '/' + p.device : name);
const peerRow = (name, p) => ({ name, address: addressOf(name, p), person: p.person, device: p.device, sessions: p.sessions, keyid: p.keyid, addresses: p.addresses, port: p.port, since: p.since });
const peers = safeSync((root) => ({ ok: true, peers: Object.entries(store.readPeers(root)).map(([name, p]) => peerRow(name, p)) }));

// One message to one stored peer, for session `to` there (or its shared inbox). The sent line goes to the sender's own log.
async function sendOne(root, peer, to, text, replyTo, ws) {
  const id = store.newId();
  const log = () => store.appendMessage(ws || root, peer, { id, dir: 'out', text, reply_to: replyTo, to });
  let r;
  try { r = await outbox.deliver(root, peer, { type: 'message', id, text, ...(to ? { to } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }); }
  catch { return fail(peer + ' could not be reached'); }
  if (r.queued) {
    log();
    return { ok: true, id, queued: true, note: peer + ' cannot be reached right now; the message waits until they collect it' };
  }
  if (r.status === 401) return fail(peer + ' no longer recognises this machine; disconnect and pair again', 401);
  if (r.status !== 200) return fail(peer + ' answered ' + r.status, r.status);
  log();
  return { ok: true, id };
}

// `address`: person/device/session (that workspace's inbox), person/device (the device's shared inbox), person (every
// paired device of that person), or a flat v1 peer name. One match: that result as it is; several: { ok, results }.
async function send(root, address, text, replyTo, ws) {
  const known = store.readPeers(root);
  const targets = addressing.targets(address, known);
  if (!targets.length) return fail(addressing.unknown(address, known));
  if (typeof text !== 'string' || !text) return fail('the message is empty');
  if (Buffer.byteLength(text) > MAX_TEXT) return fail('the message is over 64 KB');
  const results = [];
  for (const t of targets) results.push({ peer: t.peer, to: t.to || undefined, ...(await sendOne(root, t.peer, t.to, text, replyTo, ws)) });
  if (results.length === 1) { const { peer, to, ...r } = results[0]; return r; }
  const bad = results.filter((r) => !r.ok);
  return { ok: !bad.length, results, ...(bad.length ? { error: 'not delivered to: ' + bad.map((r) => r.peer + ' (' + r.error + ')').join(', ') } : {}) };
}

// The inboxes a workspace reads: its own (key `peer` in its read.json) and, when it is not the device root, the device's
// shared one (key `shared:peer` in the workspace's read.json, so each session keeps its own place).
const inboxes = (root, ws) => {
  const own = ws || root;
  return [[own, '', false], ...(path.resolve(own) !== path.resolve(root) ? [[root, 'shared:', true]] : [])];
};

// Unread messages from every peer log; marks them read (a second call returns only newer ones). Each item says
// which inbox it came from: `to` (the session it was addressed to, or null) and `shared`.
const inbox = safeSync((root, ws) => {
  const out = [];
  store.updateMarks(ws || root, (marks) => {
    for (const [dir, prefix, shared] of inboxes(root, ws)) {
      for (const peer of store.messagePeers(dir)) {
        const ins = store.readMessages(dir, peer).filter((m) => m.dir === 'in');
        for (const m of ins.slice(marks[prefix + peer] || 0)) out.push(peerdata.item(peer, m, shared));
        marks[prefix + peer] = ins.length;
      }
    }
  });
  return { ok: true, messages: out.sort((a, b) => a.at.localeCompare(b.at)) };
});

const reply = safe(async (root, messageId, text, ws) => {
  for (const [dir] of inboxes(root, ws)) {
    for (const peer of store.messagePeers(dir)) {
      if (store.readMessages(dir, peer).some((m) => m.dir === 'in' && m.id === messageId)) {
        // the answer goes to that peer's device (its shared inbox): a message does not say which session wrote it
        return sendOne(root, peer, undefined, text, messageId, ws);
      }
    }
  }
  return fail('no received message with that id');
});

// Ask every stored peer who it is; what comes back (person, device, sessions) is kept on the peer record. An unreachable
// peer keeps what is stored; one that answers 400 unknown type is a v1 device and stays under its flat name.
const who = safe(async (root) => {
  const rows = await Promise.all(Object.keys(store.readPeers(root)).map(async (name) => {
    let reachable = false; let version;
    try {
      const r = await Promise.race([net.sendToPeer(root, name, { type: 'who' }, { timeout: 4000 }), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 8000).unref())]); // a peer on many dead addresses must not hold who up
      if (r.status === 200 && r.json && store.validSegment(r.json.person) && store.validSegment(r.json.device)) {
        const j = r.json;
        const sessions = Array.isArray(j.sessions) ? j.sessions.filter(store.validSegment).slice(0, 50) : [];
        store.updatePeers(root, (all) => { if (!all[name]) return store.KEEP; Object.assign(all[name], { person: j.person, device: j.device, sessions }); });
        reachable = true; version = 2;
      } else if (r.status === 400) { reachable = true; version = 1; }
    } catch { /* unreachable: what is stored stays */ }
    return { ...peerRow(name, store.readPeers(root)[name] || {}), name, reachable, ...(version ? { version } : {}) };
  }));
  return { ok: true, self: device.self(root), peers: rows };
});

async function disconnect(root, peer) {
  if (!(store.validPeerName(peer) && store.readPeers(root)[peer])) return fail('no such peer: ' + String(peer).slice(0, 40));
  let warning;
  try { await net.sendToPeer(root, peer, { type: 'disconnect' }, { timeout: 3000 }); }
  catch { warning = peer + ' could not be reached; they will notice when they next try'; }
  store.removePeer(root, peer);
  return { ok: true, peer, ...(warning ? { warning } : {}) };
}

// Counts for the unread hook: { ok, messages:{peer:n}, offers:{peer:n}, pending:n, total } (total = all three), for
// workspace `ws` (default root): its own inbox, the device's shared one, the offers meant for it, pairing requests.
const unreadSummary = safeSync((root, ws) => {
  const messages = {}; const offers = {};
  for (const [dir, prefix] of inboxes(root, ws)) {
    const marks = store.readMarks(ws || root);
    for (const peer of store.messagePeers(dir)) {
      const n = store.readMessages(dir, peer).filter((m) => m.dir === 'in').length - (marks[prefix + peer] || 0);
      if (n > 0) messages[peer] = (messages[peer] || 0) + n;
    }
  }
  const session = ws && path.resolve(ws) !== path.resolve(root) ? device.resolve(ws).session : null;
  for (const o of store.readList(root, 'offers')) if (!session || !o.to || o.to === session) offers[o.peer] = (offers[o.peer] || 0) + 1;
  const pend = store.readList(root, 'pending').filter((e) => !e.open).length;
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { ok: true, messages, offers, pending: pend, total: sum(messages) + sum(offers) + pend };
});

module.exports = { connect: safe(connect), pending, approve, refuse, peers, send: safe(send), inbox, reply, who, disconnect: safe(disconnect), unreadSummary };
