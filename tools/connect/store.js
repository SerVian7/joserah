'use strict';
// Joserah Connect storage: json/jsonl under <root>/.joserah/connect (public data only),
// the one private key under <root>/keys/connect.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('./lock');

const TTL_MS = 10 * 60 * 1000;   // pending pair requests, half-open entries, file offers
const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const SEEN_KEEP_MS = 2 * REPLAY_WINDOW_MS; // a ts may be up to a window in the future, so keep iv's twice as long

const connectDir = (root) => path.join(root, '.joserah', 'connect');
const keysPath = (root) => path.join(root, 'keys', 'connect.json');
const newId = () => crypto.randomBytes(8).toString('hex');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']); // Windows: the file is open in another process for a moment

function readJson(file, fallback, strict) {
  for (let i = 0; ; i++) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      if (!TRANSIENT.has(e.code)) return fallback;
      if (i >= 4) { if (strict) throw e; return fallback; } // strict (read-modify-write): never mistake a locked file for an empty one
      sleep(5);
    }
  }
}

// Unique tmp (pid + random) + rename, so two writers never share a tmp file; `secret` makes the file 0600 where
// the OS allows. The rename is retried a few times where Windows refuses it while a reader has the file open.
function writeJson(file, data, secret) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', secret ? { mode: 0o600 } : undefined);
  for (let i = 0; ; i++) {
    try { return fs.renameSync(tmp, file); }
    catch (e) { if (i >= 20 || !TRANSIENT.has(e.code)) { fs.rmSync(tmp, { force: true }); throw e; } sleep(5 + i * 2); }
  }
}

// Read-modify-write under the file's lock: fn(data) returns the new data (or nothing, for data changed in place);
// return KEEP to leave the file as it is. Returns what was written (or what was read, for KEEP).
const KEEP = Symbol('keep');
function updateJson(file, fallback, fn, secret) {
  return withLock(file, () => {
    const data = readJson(file, fallback, true);
    const next = fn(data);
    if (next === KEEP) return data;
    const out = next === undefined ? data : next;
    writeJson(file, out, secret);
    return out;
  });
}

const readKeys = (root) => readJson(keysPath(root), {});
const writeKeys = (root, keys) => writeJson(keysPath(root), keys, true);

// Drop entries older than ttl by their `created` stamp.
function pruneByAge(list, now = Date.now(), ttl = TTL_MS, field = 'created') {
  return list.filter((e) => { const t = Date.parse(e[field]); return t && now - t < ttl; });
}

// Lists with a `created` field (pending, outgoing, offers, sending); expired entries are pruned on read.
const listFile = (root, name) => path.join(connectDir(root), name + '.json');
function readList(root, name, now = Date.now()) {
  const all = readJson(listFile(root, name), []);
  const kept = pruneByAge(all, now);
  return kept.length === all.length ? kept : updateList(root, name, (l) => l, now);
}
// Read-modify-write of one of those lists: fn gets the pruned list (see updateJson for what it may return).
const updateList = (root, name, fn, now = Date.now()) =>
  updateJson(listFile(root, name), [], (all) => { const kept = pruneByAge(all, now); const next = fn(kept); return next === undefined ? kept : next; });
const writeList = (root, name, list) => writeJson(listFile(root, name), list);
const removeEntry = (root, name, id) => updateList(root, name, (l) => l.filter((e) => e.id !== id));

// Peer names: lowercase [a-z0-9._-], 1-40 chars.
const validPeerName = (n) => typeof n === 'string' && /^[a-z0-9._-]{1,40}$/.test(n);
function needPeer(n) { if (!validPeerName(n)) throw new Error('bad peer name'); return n; }

// Received file names: basename only, no control chars or <>:"|?*, no leading dots, max 200.
function sanitizeName(name) {
  const base = String(name == null ? '' : name).split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').slice(0, 200);
  return base || 'file';
}

// peers.json: { name: { pub, keyid, salt, addresses:[..], port, since } } public data only.
const peersFile = (root) => path.join(connectDir(root), 'peers.json');
const readPeers = (root) => readJson(peersFile(root), {});
const updatePeers = (root, fn) => updateJson(peersFile(root), {}, fn);
function setPeer(root, name, rec) {
  needPeer(name);
  updatePeers(root, (peers) => { peers[name] = { since: new Date().toISOString(), ...rec, name: undefined }; });
}
function removePeer(root, name) {
  updatePeers(root, (peers) => { delete peers[name]; });
}
// { name, ...record } for the peer with this key id, or null.
function peerByKeyid(root, kid) {
  for (const [name, rec] of Object.entries(readPeers(root))) if (rec.keyid === kid) return { name, ...rec };
  return null;
}
// A request from an authenticated peer adds its source address (kept: the 8 most recent).
// The unlocked look first: on almost every request there is nothing to change, and nothing is locked.
function addAddress(root, name, addr) {
  const need = (p) => p && addr && !p.addresses.includes(addr);
  if (!need(readPeers(root)[name])) return;
  updatePeers(root, (peers) => {
    if (!need(peers[name])) return KEEP;
    peers[name].addresses = [...peers[name].addresses, addr].slice(-8);
  });
}
// The address that just worked goes first.
function noteAddress(root, name, addr) {
  const need = (p) => p && p.addresses[0] !== addr;
  if (!need(readPeers(root)[name])) return;
  updatePeers(root, (peers) => {
    if (!need(peers[name])) return KEEP;
    peers[name].addresses = [addr, ...peers[name].addresses.filter((a) => a !== addr)].slice(0, 8);
  });
}

// Replay check for a sealed request: |now - ts| <= 10 min and the iv not seen before (then remembered).
function checkReplay(root, kid, iv, ts, now = Date.now()) {
  if (typeof ts !== 'number' || Math.abs(now - ts) > REPLAY_WINDOW_MS || typeof iv !== 'string') return false;
  let fresh = false;
  updateJson(path.join(connectDir(root), 'seen.json'), {}, (seen) => {
    for (const k of Object.keys(seen)) {
      for (const i of Object.keys(seen[k])) if (now - seen[k][i] > SEEN_KEEP_MS) delete seen[k][i];
      if (!Object.keys(seen[k]).length) delete seen[k];
    }
    const mine = seen[kid] || (seen[kid] = {});
    if (mine[iv]) return;
    mine[iv] = now;
    fresh = true;
  });
  return fresh;
}

// Messages: one JSON per line in messages/<peer>.jsonl. Appends are a single line, not tmp+rename.
const messagesFile = (root, peer) => path.join(connectDir(root), 'messages', needPeer(peer) + '.jsonl');
function appendMessage(root, peer, m) {
  const line = { id: m.id || newId(), dir: m.dir, text: m.text, ...(m.reply_to ? { reply_to: m.reply_to } : {}), at: new Date().toISOString(), kind: m.kind || 'message' };
  const file = messagesFile(root, peer);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  withLock(file, () => fs.appendFileSync(file, JSON.stringify(line) + '\n'));
  return line;
}
function readMessages(root, peer) {
  try {
    return fs.readFileSync(messagesFile(root, peer), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function messagePeers(root) {
  try { return fs.readdirSync(path.join(connectDir(root), 'messages')).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).filter(validPeerName); }
  catch { return []; }
}

// read.json: { peer: number of "in" lines already shown }
const readMarks = (root) => readJson(path.join(connectDir(root), 'read.json'), {});
const writeMarks = (root, marks) => writeJson(path.join(connectDir(root), 'read.json'), marks);
const updateMarks = (root, fn) => updateJson(path.join(connectDir(root), 'read.json'), {}, fn);

module.exports = {
  TTL_MS, REPLAY_WINDOW_MS, KEEP, connectDir, keysPath, newId, readJson, writeJson, updateJson, readKeys, writeKeys,
  pruneByAge, readList, updateList, writeList, removeEntry, validPeerName, sanitizeName, readPeers, setPeer, removePeer, peerByKeyid,
  addAddress, noteAddress, checkReplay, appendMessage, readMessages, messagePeers, readMarks, writeMarks, updateMarks,
};
