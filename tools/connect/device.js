'use strict';
// Joserah Connect device identity: who this workspace is (person / device / session), where the
// device-level state lives, and the one-time move of v1 per-workspace state to the device folder.
//   owner trust: <home>/.joserah-connect/<person>/  (identity key, peers, lists, config, sessions.json)
//   guest trust: the workspace itself (v1 layout); nothing outside the workspace is ever read or written.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { validPeerName } = store;

const DIR_NAME = '.joserah-connect';
const BACKUP = '.v1-backup';
const V1_LISTS = ['peers.json', 'pending.json', 'outgoing.json', 'offers.json', 'sending.json', 'outbox.json', 'seen.json', 'delivered.json'];
const TURKISH = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u' };

function slug(s) {
  if (typeof s !== 'string') return null;
  const out = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TURKISH[c]).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return out && validPeerName(out) ? out : null;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeFile(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

function deviceDir(home, person) {
  if (!validPeerName(person) || /^\.+$/.test(person)) throw new Error('bad person');
  return path.join(home, DIR_NAME, person);
}
const isDeviceRoot = (p) => typeof p === 'string' && store.isDeviceRoot(p);

// Pure: reads the workspace config (and, for owner trust, the device folder's config). Creates nothing.
function resolve(wsRoot, { home = process.env.JOSERAH_CONNECT_HOME || os.homedir(), hostname = os.hostname() } = {}) {
  const cfg = readJson(path.join(wsRoot, '.joserah', 'config.json'), {}) || {};
  const mode = cfg.trust === 'owner' ? 'owner' : 'guest';
  const person = slug(cfg.ownerName) || 'owner';
  const session = slug(cfg.workspaceName) || slug(path.basename(path.resolve(wsRoot))) || 'workspace';
  const deviceRoot = mode === 'owner' ? deviceDir(home, person) : wsRoot;
  const own = mode === 'owner' ? readJson(path.join(deviceRoot, 'config.json'), {}) || {} : {};
  const v1 = readJson(path.join(wsRoot, '.joserah', 'connect', 'config.json'), {}) || {};
  const dev = slug(own.device) || slug(own.name) || slug(v1.name) || slug(hostname) || 'device';
  return { mode, person, device: dev, session, deviceRoot, wsRoot };
}

// One-time, idempotent move of v1 state into the person's device folder (owner trust only).
// -> { migrated, conflict?, invalid?, moved:[file names] }; never carries a key.
function migrate(wsRoot, { home = process.env.JOSERAH_CONNECT_HOME || os.homedir(), hostname = os.hostname() } = {}) {
  const none = { migrated: false, moved: [] };
  const r = resolve(wsRoot, { home, hostname });
  if (r.mode !== 'owner') return none;
  const v1Dir = path.join(wsRoot, '.joserah', 'connect');
  const keySrc = path.join(wsRoot, 'keys', 'connect.json');
  const keyDst = path.join(r.deviceRoot, 'keys', 'connect.json');
  const found = [['keys/connect.json', keySrc], ...['config.json', ...V1_LISTS].map((f) => [f, path.join(v1Dir, f)])]
    .filter(([, p]) => fs.existsSync(p));
  if (!found.length) return none;

  const v1Key = fs.existsSync(keySrc) ? (readJson(keySrc, {}) || {}).identity : undefined;
  if (fs.existsSync(keySrc) && !(v1Key && v1Key.public)) return { ...none, invalid: true };
  const devKey = ((readJson(keyDst, {}) || {}).identity || {}).public;

  if (devKey) {
    if (!v1Key) return none; // no v1 key to compare: nothing here belongs to this device yet
    if (v1Key.public !== devKey) return { ...none, conflict: true };
  } else {
    // copy everything first, retire the originals after: a crash in between is finished by the next run
    fs.mkdirSync(r.deviceRoot, { recursive: true, mode: 0o700 });
    for (const [name, src] of found) {
      const dst = name === 'keys/connect.json' ? keyDst : path.join(r.deviceRoot, name);
      if (fs.existsSync(dst)) continue;
      if (name === 'config.json') {
        const c = readJson(src, {}) || {};
        const out = { ...(c.name ? { name: c.name, device: c.name } : {}) };
        for (const k of ['port', 'bind', 'smallFileMax']) if (c[k] !== undefined) out[k] = c[k];
        writeFile(dst, JSON.stringify(out, null, 2) + '\n');
      } else writeFile(dst, fs.readFileSync(src), name === 'keys/connect.json' ? 0o600 : undefined);
    }
  }
  for (const [, src] of found) { try { fs.renameSync(src, src + BACKUP); } catch (e) { if (e.code !== 'ENOENT') throw e; } } // another session may have retired it already
  return { migrated: true, moved: found.map(([n]) => n) };
}

// info is resolve()'s result. Records this workspace under its session name so one listener can route to it.
function registerSession(info) {
  if (!info || info.mode !== 'owner' || !isDeviceRoot(info.deviceRoot) || !info.session || !info.wsRoot) return { registered: false };
  const file = path.join(info.deviceRoot, 'sessions.json');
  // under the file's lock: several sessions start at once and each adds its own entry
  store.updateJson(file, {}, (map) => { map[info.session] = { root: info.wsRoot, updated: new Date().toISOString() }; });
  return { registered: true };
}

// -> the workspace root registered under this session name, or null.
function sessionRoot(deviceRoot, session) {
  const map = readJson(path.join(deviceRoot, 'sessions.json'), {}) || {};
  const e = typeof session === 'string' && Object.hasOwn(map, session) ? map[session] : null;
  return e && typeof e.root === 'string' ? e.root : null;
}

// -> the root whose inbox/files a message or file addressed to session `to` belongs in: that session's workspace when
// it is registered here (and still there), else the device folder itself (the shared inbox).
function inboxRoot(deviceRoot, to) {
  const ws = typeof to === 'string' && validPeerName(to) ? sessionRoot(deviceRoot, to) : null;
  return ws && fs.existsSync(path.join(ws, '.joserah')) ? ws : deviceRoot;
}

// What this device tells a peer about itself (the `who` answer, minus nothing secret): { person, device, sessions, version: 2 }.
function self(root, { hostname = os.hostname() } = {}) {
  if (!isDeviceRoot(root)) { const r = resolve(root, { hostname }); return { person: r.person, device: r.device, sessions: [r.session], version: 2 }; }
  const cfg = readJson(path.join(root, 'config.json'), {}) || {};
  const map = readJson(path.join(root, 'sessions.json'), {}) || {};
  return { person: path.basename(path.resolve(root)), device: slug(cfg.device) || slug(cfg.name) || slug(hostname) || 'device', sessions: Object.keys(map).filter(validPeerName).sort(), version: 2 };
}

module.exports = { slug, resolve, deviceDir, migrate, registerSession, sessionRoot, inboxRoot, self, isDeviceRoot };
