'use strict';
// Joserah Connect: what the MCP tools call. Every function takes the workspace root first and returns
// { ok:true, ... } or { ok:false, error }; none throws, none returns a key.
const crypto = require('crypto');
const store = require('./store');
const config = require('./config');
const cx = require('./crypto');
const net = require('./http');

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
  if (!store.validPeerName(username)) return fail('the username must be 1-40 characters of a-z 0-9 . _ -');
  const cfg = config.loadConfig(root);
  if (!cfg.name) return fail('this machine has no name yet');
  const me = cx.identity(root);
  const id = store.newId();
  const nA = crypto.randomBytes(32);
  const call = (p, json) => net.request({ address: t.host, port: t.port, method: 'POST', path: p, json });
  let r1;
  try { r1 = await call('/pair', { id, username, commit: cx.commit(me.pub, nA) }); } catch { return fail('could not reach ' + t.host + ':' + t.port); }
  if (r1.status !== 200) return fail(pairError[r1.status] || 'the other machine answered ' + r1.status, r1.status);
  const j = r1.json || {};
  if (!store.validPeerName(j.name) || typeof j.pub !== 'string' || typeof j.nonce !== 'string' || cx.unb64(j.pub).length !== 32 || cx.unb64(j.nonce).length !== 32) return fail('the other machine sent something unusable');
  const pubB = cx.unb64(j.pub); const nB = cx.unb64(j.nonce);
  store.updateList(root, 'outgoing', (l) => [...l, { id, username, target: t.host, port: t.port, pubB: j.pub, keyid: cx.keyid(pubB), nA: cx.b64(nA), nB: j.nonce, name: j.name, created: new Date().toISOString() }]);
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
  pending: store.readList(root, 'pending', now).filter((e) => !e.open).map(({ id, username, keyid, code, addresses, created }) => ({ id, username, keyid, code, addresses, created })),
}));

// Approve: store the peer, then tell the other machine with a sealed accept. Refuse: sealed refuse, nothing stored.
async function answer(root, id, approve, now) {
  const e = store.readList(root, 'pending', now).find((x) => x.id === id && !x.open);
  if (!e) return fail('no such pairing request (it may have expired)');
  const cfg = config.loadConfig(root);
  if (!cfg.name) return fail('this machine has no name yet');
  const me = cx.identity(root);
  const salt = cx.pairSalt(cx.unb64(e.pub), me.pub, cx.unb64(e.nA), cx.unb64(e.nB));
  const body = approve ? { type: 'accept', name: cfg.name, addresses: net.ownAddresses(), port: cfg.port } : { type: 'refuse', name: cfg.name };
  if (approve && (store.readPeers(root)[e.username] || store.peerByKeyid(root, e.keyid))) return fail('already connected');
  let claimed = false; // two answers at once: only one gets to take the request
  store.updateList(root, 'pending', (l) => (l.some((x) => x.id === id && !x.open) ? (claimed = true, l.filter((x) => x.id !== id)) : store.KEEP), now);
  if (!claimed) return fail('no such pairing request (it may have expired)');
  if (approve) store.setPeer(root, e.username, { pub: e.pub, keyid: e.keyid, salt: salt.toString('hex'), addresses: e.addresses, port: e.port });
  let warning;
  try {
    const keys = cx.deriveKeys(me, cx.unb64(e.pub), salt);
    const r = await net.postSealed(root, e, keys, body);
    if (r.status !== 200) warning = e.username + ' did not confirm (answered ' + r.status + ')';
    else if (approve) store.noteAddress(root, e.username, r.address);
  } catch { warning = e.username + ' could not be reached; ' + (approve ? 'they are kept as a peer here' : 'the refusal was not delivered'); }
  return { ok: true, peer: e.username, ...(warning ? { warning } : {}) };
}
const approve = safe((root, id, now) => answer(root, id, true, now));
const refuse = safe((root, id, now) => answer(root, id, false, now));

const peers = safeSync((root) => ({ ok: true, peers: Object.entries(store.readPeers(root)).map(([name, p]) => ({ name, keyid: p.keyid, addresses: p.addresses, port: p.port, since: p.since })) }));

async function send(root, peer, text, replyTo) {
  if (!(store.validPeerName(peer) && store.readPeers(root)[peer])) return fail('no such peer: ' + String(peer).slice(0, 40));
  if (typeof text !== 'string' || !text) return fail('the message is empty');
  if (Buffer.byteLength(text) > MAX_TEXT) return fail('the message is over 64 KB');
  const id = store.newId();
  let r;
  try { r = await net.sendToPeer(root, peer, { type: 'message', id, text, ...(replyTo ? { reply_to: replyTo } : {}) }); }
  catch { return fail(peer + ' could not be reached'); }
  if (r.status === 401) return fail(peer + ' no longer recognises this machine; disconnect and pair again', 401);
  if (r.status !== 200) return fail(peer + ' answered ' + r.status, r.status);
  store.appendMessage(root, peer, { id, dir: 'out', text, reply_to: replyTo });
  return { ok: true, id };
}

// Unread messages from every peer log; marks them read (a second call returns only newer ones).
const inbox = safeSync((root) => {
  const out = [];
  store.updateMarks(root, (marks) => {
    for (const peer of store.messagePeers(root)) {
      const ins = store.readMessages(root, peer).filter((m) => m.dir === 'in');
      for (const m of ins.slice(marks[peer] || 0)) out.push({ peer, id: m.id, text: m.text, at: m.at, reply_to: m.reply_to, kind: m.kind });
      marks[peer] = ins.length;
    }
  });
  return { ok: true, messages: out.sort((a, b) => a.at.localeCompare(b.at)) };
});

const reply = safe(async (root, messageId, text) => {
  for (const peer of store.messagePeers(root)) {
    if (store.readMessages(root, peer).some((m) => m.dir === 'in' && m.id === messageId)) return send(root, peer, text, messageId);
  }
  return fail('no received message with that id');
});

async function disconnect(root, peer) {
  if (!(store.validPeerName(peer) && store.readPeers(root)[peer])) return fail('no such peer: ' + String(peer).slice(0, 40));
  let warning;
  try { await net.sendToPeer(root, peer, { type: 'disconnect' }, { timeout: 3000 }); }
  catch { warning = peer + ' could not be reached; they will notice when they next try'; }
  store.removePeer(root, peer);
  return { ok: true, peer, ...(warning ? { warning } : {}) };
}

// Counts for the unread hook: { ok, messages:{peer:n}, offers:{peer:n}, pending:n, total } (total = all three).
const unreadSummary = safeSync((root) => {
  const marks = store.readMarks(root);
  const messages = {}; const offers = {};
  for (const peer of store.messagePeers(root)) {
    const n = store.readMessages(root, peer).filter((m) => m.dir === 'in').length - (marks[peer] || 0);
    if (n > 0) messages[peer] = n;
  }
  for (const o of store.readList(root, 'offers')) offers[o.peer] = (offers[o.peer] || 0) + 1;
  const pend = store.readList(root, 'pending').filter((e) => !e.open).length;
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { ok: true, messages, offers, pending: pend, total: sum(messages) + sum(offers) + pend };
});

module.exports = { connect: safe(connect), pending, approve, refuse, peers, send: safe(send), inbox, reply, disconnect: safe(disconnect), unreadSummary };
