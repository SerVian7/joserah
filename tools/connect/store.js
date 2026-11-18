'use strict';
// Joserah Connect storage: json/jsonl under <root>/.joserah/connect (public data only),
// the one private key under <root>/keys/connect.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;   // pending pair requests, half-open entries, file offers
const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const SEEN_KEEP_MS = 2 * REPLAY_WINDOW_MS; // a ts may be up to a window in the future, so keep iv's twice as long

const connectDir = (root) => path.join(root, '.joserah', 'connect');
const keysPath = (root) => path.join(root, 'keys', 'connect.json');
const newId = () => crypto.randomBytes(8).toString('hex');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// tmp + rename; `secret` makes the file 0600 where the OS allows.
function writeJson(file, data, secret) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', secret ? { mode: 0o600 } : undefined);
  fs.renameSync(tmp, file);
}

const readKeys = (root) => readJson(keysPath(root), {});
const writeKeys = (root, keys) => writeJson(keysPath(root), keys, true);

// Drop entries older than ttl by their `created` stamp.
function pruneByAge(list, now = Date.now(), ttl = TTL_MS, field = 'created') {
  return list.filter((e) => { const t = Date.parse(e[field]); return t && now - t < ttl; });
}

// Lists with a `created` field (pending, outgoing, offers, sending); expired entries are pruned on read.
function readList(root, name, now = Date.now()) {
  const file = path.join(connectDir(root), name + '.json');
  const all = readJson(file, []);
  const kept = pruneByAge(all, now);
  if (kept.length !== all.length) writeJson(file, kept);
  return kept;
}
const writeList = (root, name, list) => writeJson(path.join(connectDir(root), name + '.json'), list);
const removeEntry = (root, name, id) => writeList(root, name, readList(root, name).filter((e) => e.id !== id));

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
function setPeer(root, name, rec) {
  needPeer(name);
  const peers = readPeers(root);
  peers[name] = { since: new Date().toISOString(), ...rec, name: undefined };
  writeJson(peersFile(root), peers);
}
function removePeer(root, name) {
  const peers = readPeers(root);
  delete peers[name];
  writeJson(peersFile(root), peers);
}
// { name, ...record } for the peer with this key id, or null.
function peerByKeyid(root, kid) {
  for (const [name, rec] of Object.entries(readPeers(root))) if (rec.keyid === kid) return { name, ...rec };
  return null;
}
// A request from an authenticated peer adds its source address (kept: the 8 most recent).
function addAddress(root, name, addr) {
  const peers = readPeers(root);
  const p = peers[name];
  if (!p || !addr || p.addresses.includes(addr)) return;
  p.addresses = [...p.addresses, addr].slice(-8);
  writeJson(peersFile(root), peers);
}
// The address that just worked goes first.
function noteAddress(root, name, addr) {
  const peers = readPeers(root);
  const p = peers[name];
  if (!p || p.addresses[0] === addr) return;
  p.addresses = [addr, ...p.addresses.filter((a) => a !== addr)].slice(0, 8);
  writeJson(peersFile(root), peers);
}

// Replay check for a sealed request: |now - ts| <= 10 min and the iv not seen before (then remembered).
function checkReplay(root, kid, iv, ts, now = Date.now()) {
  if (typeof ts !== 'number' || Math.abs(now - ts) > REPLAY_WINDOW_MS || typeof iv !== 'string') return false;
  const file = path.join(connectDir(root), 'seen.json');
  const seen = readJson(file, {});
  for (const k of Object.keys(seen)) {
    for (const i of Object.keys(seen[k])) if (now - seen[k][i] > SEEN_KEEP_MS) delete seen[k][i];
    if (!Object.keys(seen[k]).length) delete seen[k];
  }
  const mine = seen[kid] || (seen[kid] = {});
  if (mine[iv]) return false;
  mine[iv] = now;
  writeJson(file, seen);
  return true;
}

// Messages: one JSON per line in messages/<peer>.jsonl. Appends are a single line, not tmp+rename.
const messagesFile = (root, peer) => path.join(connectDir(root), 'messages', needPeer(peer) + '.jsonl');
function appendMessage(root, peer, m) {
  const line = { id: m.id || newId(), dir: m.dir, text: m.text, ...(m.reply_to ? { reply_to: m.reply_to } : {}), at: new Date().toISOString(), kind: m.kind || 'message' };
  const file = messagesFile(root, peer);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(line) + '\n');
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

module.exports = {
  TTL_MS, REPLAY_WINDOW_MS, connectDir, keysPath, newId, readJson, writeJson, readKeys, writeKeys, pruneByAge,
  readList, writeList, removeEntry, validPeerName, sanitizeName, readPeers, setPeer, removePeer, peerByKeyid,
  addAddress, noteAddress, checkReplay, appendMessage, readMessages, messagePeers, readMarks, writeMarks,
};
