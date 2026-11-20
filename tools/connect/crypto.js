'use strict';
// Joserah Connect crypto: X25519 identity, commit-then-reveal pairing code, HKDF per-direction keys,
// AES-256-GCM seals and frames. Built-in crypto only. Binary values are Buffers; on the wire and in
// json files they are base64url.
const crypto = require('crypto');
const store = require('./store');

const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');
const sha = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))))).digest();
const keyid = (pub) => sha(Buffer.isBuffer(pub) ? pub : unb64(pub)).toString('hex').slice(0, 16);
const pubKey = (raw) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64(raw) }, format: 'jwk' });

// This machine's long-term key, made on first use. { priv: KeyObject, pub: Buffer(32), pubB64, keyid }
const cache = new Map();
function identity(root) {
  if (cache.has(root)) return cache.get(root);
  // under the file's lock: sessions of one person start together and must end up with one key
  const keys = store.updateJson(store.keysPath(root), {}, (k) => {
    if (k.identity) return store.KEEP;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    k.identity = { private: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), public: publicKey.export({ format: 'jwk' }).x };
  }, true);
  const pub = unb64(keys.identity.public);
  const id = { priv: crypto.createPrivateKey({ key: Buffer.from(keys.identity.private, 'base64'), format: 'der', type: 'pkcs8' }), pub, pubB64: keys.identity.public, keyid: keyid(pub) };
  cache.set(root, id);
  return id;
}

// ---- pairing ----
const commit = (pubA, nA) => sha('jc1 commit', pubA, nA).toString('hex');
const sasCode = (pubA, pubB, nA, nB) => String(sha('jc1 sas', pubA, pubB, nA, nB).readUInt32BE(0) % 1000000).padStart(6, '0');
const pairSalt = (pubA, pubB, nA, nB) => sha(pubA, pubB, nA, nB);

// One key per direction: { send: k(me->them), recv: k(them->me) }.
function deriveKeys(me, theirPub, salt) {
  const shared = crypto.diffieHellman({ privateKey: me.priv, publicKey: pubKey(theirPub) });
  const k = (from, to) => Buffer.from(crypto.hkdfSync('sha256', shared, salt, 'jc1 ' + keyid(from) + '>' + keyid(to), 32));
  return { send: k(me.pub, theirPub), recv: k(theirPub, me.pub) };
}

// Keys for a stored peer record { pub, salt } (b64url / hex), derived once and kept in memory.
const links = new Map();
function linkKeys(root, rec) {
  const id = root + '|' + rec.keyid + '|' + rec.salt;
  if (!links.has(id)) links.set(id, deriveKeys(identity(root), unb64(rec.pub), Buffer.from(rec.salt, 'hex')));
  return links.get(id);
}

// ---- seals ----
function sealRaw(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  return { iv, ct: Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]) };
}
function openRaw(key, iv, ct, aad) {
  if (iv.length !== 12 || ct.length < 16) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(ct.subarray(ct.length - 16));
    return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  } catch { return null; }
}
// seal(key, obj, aad) -> { iv, ct } base64url; open(key, env, aad) -> obj or null (never throws).
function seal(key, obj, aad) {
  const { iv, ct } = sealRaw(key, Buffer.from(JSON.stringify(obj)), aad);
  return { iv: b64(iv), ct: b64(ct) };
}
function open(key, env, aad) {
  if (!env || typeof env.iv !== 'string' || typeof env.ct !== 'string') return null;
  const plain = openRaw(key, unb64(env.iv), unb64(env.ct), aad);
  try { return plain && JSON.parse(plain.toString('utf8')); } catch { return null; }
}

// The sealed request body every authenticated call carries: { from, iv, ct }. ts is added unless given.
const requestAad = (from) => 'jc1 m ' + from;
function sealRequest(root, keys, obj) {
  const from = identity(root).keyid;
  return { from, ...seal(keys.send, { ts: Date.now(), ...obj }, requestAad(from)) };
}

// ---- frames: uint32be(len) || iv(12) || ct+tag, plaintext chunks of 64 KB ----
const MAX_FRAME = 12 + 64 * 1024 + 16 + 4096; // a header or a chunk, never more
const frame = ({ iv, ct }) => { const h = Buffer.alloc(4); h.writeUInt32BE(iv.length + ct.length); return Buffer.concat([h, iv, ct]); };
const chunkAad = (id, i, last) => 'jc1 f ' + id + ' ' + i + ' ' + (last ? '1' : '0');

// Writer: header(obj) first (obj.id names the stream; ts added), then chunk(buf, last) for each <= 64 KB piece,
// the final one with last=true (an empty file is one empty last chunk). `from` = our keyid.
function frameWriter(key, from) {
  let id = null; let i = 0;
  return {
    header(obj) { id = obj.id; return frame(sealRaw(key, Buffer.from(JSON.stringify({ ts: Date.now(), ...obj })), requestAad(from))); },
    chunk(buf, last) { return frame(sealRaw(key, buf, chunkAad(id, i++, last))); },
  };
}

// Reader: push(buffer) returns [{header: obj, iv}] then [{data: Buffer, last}] items as frames complete;
// it throws on any bad, reordered, extra or oversized frame. end() throws unless the last frame arrived.
// `from` = the sender's keyid. The caller checks the header's ts and iv with store.checkReplay.
function frameReader(key, from) {
  let buf = Buffer.alloc(0); let header = null; let i = 0; let done = false;
  const bad = () => { throw new Error('bad frame'); };
  return {
    push(chunk) {
      if (done) bad();
      buf = Buffer.concat([buf, chunk]);
      const items = [];
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len < 28 || len > MAX_FRAME) bad();
        if (buf.length < 4 + len) break;
        const iv = buf.subarray(4, 16); const ct = buf.subarray(16, 4 + len);
        buf = buf.subarray(4 + len);
        if (done) bad();
        if (!header) {
          const plain = openRaw(key, iv, ct, requestAad(from));
          try { header = JSON.parse(plain.toString('utf8')); } catch { bad(); }
          items.push({ header, iv: b64(iv) });
        } else {
          const last = openRaw(key, iv, ct, chunkAad(header.id, i, true));
          const data = last || openRaw(key, iv, ct, chunkAad(header.id, i, false)) || bad();
          i++;
          if (last) done = true;
          items.push({ data, last: !!last });
        }
      }
      if (done && buf.length) bad();
      return items;
    },
    end() { if (!done) bad(); },
  };
}

module.exports = { b64, unb64, keyid, identity, commit, sasCode, pairSalt, deriveKeys, linkKeys, seal, open, requestAad, sealRequest, frameWriter, frameReader };
