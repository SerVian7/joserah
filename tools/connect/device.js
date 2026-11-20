'use strict';
// Joserah Connect device identity: who this workspace is (person / device / session), where the
// device-level state lives, and the one-time move of v1 per-workspace state to the device folder.
//   owner trust: <home>/.joserah-connect/<person>/  (identity key, peers, lists, config, sessions.json)
//   guest trust: the workspace itself (v1 layout); nothing outside the workspace is ever read or written.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validPeerName } = require('./store');

const DIR_NAME = '.joserah-connect';
const BACKUP = '.v1-backup';
const V1_LISTS = ['peers.json', 'pending.json', 'outgoing.json', 'offers.json', 'sending.json'];
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
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

function deviceDir(home, person) {
  if (!validPeerName(person) || /^\.+$/.test(person)) throw new Error('bad person');
  return path.join(home, DIR_NAME, person);
}
const isDeviceRoot = (p) => typeof p === 'string' && path.basename(path.dirname(path.resolve(p))) === DIR_NAME;

// Pure: reads the workspace config (and, for owner trust, the device folder's config). Creates nothing.
function resolve(wsRoot, { home = os.homedir(), hostname = os.hostname() } = {}) {
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
function migrate(wsRoot, { home = os.homedir(), hostname = os.hostname() } = {}) {
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
  for (const [, src] of found) fs.renameSync(src, src + BACKUP);
  return { migrated: true, moved: found.map(([n]) => n) };
}

// info is resolve()'s result. Records this workspace under its session name so one listener can route to it.
function registerSession(info) {
  if (!info || info.mode !== 'owner' || !isDeviceRoot(info.deviceRoot) || !info.session || !info.wsRoot) return { registered: false };
  const file = path.join(info.deviceRoot, 'sessions.json');
  const map = readJson(file, {}) || {};
  map[info.session] = { root: info.wsRoot, updated: new Date().toISOString() };
  writeFile(file, JSON.stringify(map, null, 2) + '\n');
  return { registered: true };
}

// -> the workspace root registered under this session name, or null.
function sessionRoot(deviceRoot, session) {
  const map = readJson(path.join(deviceRoot, 'sessions.json'), {}) || {};
  const e = typeof session === 'string' && Object.hasOwn(map, session) ? map[session] : null;
  return e && typeof e.root === 'string' ? e.root : null;
}

module.exports = { slug, resolve, deviceDir, migrate, registerSession, sessionRoot, isDeviceRoot };
