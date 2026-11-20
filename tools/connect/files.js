'use strict';
// Joserah Connect file transfer: small files are pushed (POST /f), large ones are offered and pulled once the
// receiver accepts. Every byte is sealed (crypto.js frames). A received file is only written, never opened or run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const config = require('./config');
const store = require('./store');
const cx = require('./crypto');
const http = require('./http');
const outbox = require('./outbox');
const { registerRoutes } = require('./listener');

const CHUNK = 64 * 1024;
const MAX_OFFERS = 20;
const QUEUED_LIFE_MS = 7 * 24 * 3600 * 1000; // a `sending` entry that waits for a fetch lives as long as its outbox item
const HEX = (n) => new RegExp('^[0-9a-f]{' + n + '}$');
const fail = (status, message) => Object.assign(new Error(message), { status });
const fmt = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const dirOf = (root, peer) => path.join(store.connectDir(root), 'files', peer);
const notice = (root, peer, dir, text) => store.appendMessage(root, peer, { dir, kind: 'notice', text });

function hashFile(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Sealed frames of one file: header, then 64 KB chunks. The last chunk is held back until the whole file has
// been read, so a file that changed since `hdr` was made (size or sha256) aborts before the end frame.
async function* frames(w, file, hdr) {
  yield w.header(hdr);
  const h = crypto.createHash('sha256');
  let n = 0; let prev = null;
  for await (const buf of fs.createReadStream(file, { highWaterMark: CHUNK })) {
    h.update(buf); n += buf.length;
    if (prev) yield w.chunk(prev, false);
    prev = buf;
  }
  if (n !== hdr.size || h.digest('hex') !== hdr.sha256) throw new Error('file changed');
  yield w.chunk(prev || Buffer.alloc(0), true);
}

// Windows device names would open a device, not a file.
const safeName = (n) => { const s = store.sanitizeName(n); return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s) ? '_' + s : s; };

// Read a sealed file stream from peer `s` ({ name, rec, keys }) into files/<peer>/, hashing as it is written.
// `offer` (large files): the header must match it. Resolves { name, size }; throws {status, message} and removes
// the part file on any failure.
async function receive(root, s, source, now, offer) {
  const dir = dirOf(root, s.name);
  fs.mkdirSync(dir, { recursive: true });
  const r = cx.frameReader(s.keys.recv, s.rec.keyid);
  const hash = crypto.createHash('sha256');
  let hdr = null; let part = null; let fd = null; let n = 0;
  const close = () => { if (fd !== null) { fs.closeSync(fd); fd = null; } };
  try {
    for await (const buf of source) {
      for (const it of r.push(buf)) {
        if (it.header) {
          hdr = it.header;
          if (!store.checkReplay(root, s.rec.keyid, it.iv, hdr.ts, now)) throw fail(401, 'not accepted');
          if (!HEX(16).test(hdr.id) || typeof hdr.name !== 'string' || !Number.isInteger(hdr.size) || hdr.size < 0 || !HEX(64).test(hdr.sha256)) throw fail(422, 'bad file header');
          if (!offer && hdr.size > config.loadConfig(root).smallFileMax) throw fail(413, 'the file is too large to send without asking first');
          if (offer && ['id', 'name', 'size', 'sha256'].some((k) => hdr[k] !== offer[k])) throw fail(422, 'the file is not the one offered');
          part = path.join(dir, '.' + hdr.id + '.part');
          fd = fs.openSync(part, 'wx');
        } else {
          n += it.data.length;
          if (n > hdr.size) throw fail(422, 'the file is larger than announced');
          hash.update(it.data);
          fs.writeSync(fd, it.data);
        }
      }
    }
    r.end();
    if (n !== hdr.size || hash.digest('hex') !== hdr.sha256) throw fail(422, 'the file failed the check');
    close();
    // Reserve a free name with wx (never overwrite), then move the part file onto our own reservation.
    const name = safeName(hdr.name);
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    for (let i = 0; ; i++) {
      const candidate = i ? `${stem} (${i})${ext}` : name;
      const target = path.join(dir, candidate);
      if (path.dirname(path.resolve(target)) !== path.resolve(dir)) throw fail(422, 'bad file name');
      try { fs.closeSync(fs.openSync(target, 'wx')); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
      fs.renameSync(part, target);
      notice(root, s.name, 'in', `file received: ${candidate}, ${fmt(n)}`);
      return { name: candidate, size: n };
    }
  } catch (e) {
    close();
    if (part) fs.rmSync(part, { force: true });
    throw e.status ? e : fail(422, 'the file stream was not valid');
  }
}

const drain = async (stream) => { const c = []; for await (const b of stream) c.push(b); return Buffer.concat(c); };
const errorOf = async (r) => {
  let msg = '';
  try { msg = JSON.parse((await drain(r.stream || [])).toString('utf8')).error || ''; } catch { /* not json */ }
  return msg || (r.json && r.json.error) || 'the other side answered ' + r.status;
};

// ---- receiving side routes ------------------------------------------------
registerRoutes(({ route, sealed, sender, send }) => {
  route('POST', '/f', async (ctx) => {
    const from = ctx.req.headers['x-connect-from'];
    const s = sender(ctx.root, from);
    if (!s || !s.rec) return ctx.send(401, { error: 'not accepted' });
    try {
      const got = await receive(ctx.root, s, ctx.req, ctx.state.now());
      send(ctx.res, 200, { saved: !!got.name }); // no name: nothing readable goes back in the clear
    } catch (e) { send(ctx.res, e.status || 422, { error: e.message }); }
  });

  sealed('file-offer', async (ctx) => {
    const m = ctx.msg;
    if (!HEX(16).test(m.id) || typeof m.name !== 'string' || !Number.isInteger(m.size) || m.size < 0 || !HEX(64).test(m.sha256)) throw fail(400, 'bad offer');
    store.updateList(ctx.root, 'offers', (list) => {
      if (list.length >= MAX_OFFERS) throw fail(429, 'too many open offers');
      if (list.some((o) => o.id === m.id)) throw fail(409, 'duplicate offer');
      list.push({ id: m.id, peer: ctx.name, name: m.name, size: m.size, sha256: m.sha256, created: new Date(ctx.state.now()).toISOString() });
    });
    notice(ctx.root, ctx.name, 'in', `${ctx.name} wants to send ${safeName(m.name)}, ${fmt(m.size)}`);
    // a small file the sender queued (it could not be reached) is pulled at once, from here to there; a large one waits for accept_file
    if (m.auto === true && ctx.fetched && m.size <= ctx.config.smallFileMax) await acceptFile(ctx.root, m.id);
    return { ok: true };
  });

  // The receiver asks for the file: answer only for a live offer of ours made to this very peer.
  sealed('file-pull', async (ctx) => {
    const e = store.readList(ctx.root, 'sending').find((x) => x.id === ctx.msg.id && x.peer === ctx.name);
    if (!e) throw fail(404, 'no such offer');
    let st;
    try { st = fs.statSync(e.path); } catch { throw fail(404, 'the file is gone'); }
    if (st.size !== e.size) throw fail(409, 'the file changed');
    const w = cx.frameWriter(ctx.keys.send, cx.identity(ctx.root).keyid);
    ctx.res.writeHead(200, { 'content-type': 'application/octet-stream' });
    try {
      for await (const f of frames(w, e.path, { id: e.id, name: e.name, size: e.size, sha256: e.sha256 })) {
        if (!ctx.res.write(f)) await once(ctx.res, 'drain');
      }
      ctx.res.end();
    } catch { ctx.res.destroy(); }
  });

  sealed('file-result', (ctx) => {
    const e = store.readList(ctx.root, 'sending').find((x) => x.id === ctx.msg.id && x.peer === ctx.name);
    if (e) {
      store.removeEntry(ctx.root, 'sending', e.id);
      notice(ctx.root, ctx.name, 'in', ctx.msg.refused ? `${e.name} refused` : ctx.msg.ok ? `${e.name} delivered` : `${e.name} failed the check and was deleted`);
    }
    return { ok: true };
  });
});

// ---- tool functions (root first) -------------------------------------------
const queuedNote = (peer) => peer + ' cannot be reached right now; the file waits until they collect it';
// pruneByAge keeps an entry while now - created < 10 min, so a `created` that far ahead gives it a longer life.
const keepSending = (root, id) => store.updateList(root, 'sending', (l) => l.map((e) => (e.id === id ? { ...e, created: new Date(Date.now() + QUEUED_LIFE_MS - store.TTL_MS).toISOString() } : e)));
function queueOffer(root, peer, hdr, abs, auto) {
  store.updateList(root, 'sending', (l) => [...l, { ...hdr, peer, path: abs, created: new Date().toISOString() }]);
  keepSending(root, hdr.id);
  outbox.queue(root, peer, { type: 'file-offer', ...hdr, ...(auto ? { auto: true } : {}) });
  return { ok: true, queued: true, id: hdr.id, name: hdr.name, size: hdr.size, note: queuedNote(peer) };
}

async function sendFile(root, peer, file) {
  try {
    if (!store.readPeers(root)[peer]) return { ok: false, error: 'no such peer' };
    let st;
    try { st = fs.statSync(file); } catch { return { ok: false, error: 'file not found' }; }
    if (!st.isFile()) return { ok: false, error: 'not a file' };
    const abs = path.resolve(file);
    const hdr = { id: store.newId(), name: path.basename(abs), size: st.size, sha256: await hashFile(abs) };
    if (st.size <= config.loadConfig(root).smallFileMax) {
      const w = cx.frameWriter(cx.linkKeys(root, store.readPeers(root)[peer]).send, cx.identity(root).keyid);
      const out = [];
      for await (const f of frames(w, abs, hdr)) out.push(f); // shortcut: whole file in memory, bounded by smallFileMax
      let r;
      try { r = await http.sendToPeer(root, peer, null, { path: '/f', body: Buffer.concat(out) }); }
      catch (e) {
        if (!e.connect) throw e;
        return queueOffer(root, peer, hdr, abs, true); // unreachable: the receiver pulls it when it collects
      }
      return r.status === 200 ? { ok: true, name: hdr.name, size: hdr.size } : { ok: false, error: await errorOf(r) };
    }
    store.updateList(root, 'sending', (l) => [...l, { ...hdr, peer, path: abs, created: new Date().toISOString() }]);
    const r = await outbox.deliver(root, peer, { type: 'file-offer', ...hdr });
    if (r.queued) { keepSending(root, hdr.id); return { ok: true, waiting: true, queued: true, id: hdr.id, name: hdr.name, size: hdr.size, note: queuedNote(peer) }; }
    if (r.status !== 200) { store.removeEntry(root, 'sending', hdr.id); return { ok: false, error: await errorOf(r) }; }
    return { ok: true, waiting: true, id: hdr.id, name: hdr.name, size: hdr.size };
  } catch (e) { return { ok: false, error: e.message === 'file changed' ? 'the file changed while it was being sent' : e.message }; }
}

function files(root) {
  const received = [];
  let peers = [];
  try { peers = fs.readdirSync(path.join(store.connectDir(root), 'files')).filter(store.validPeerName); } catch { /* none yet */ }
  for (const peer of peers) {
    for (const name of fs.readdirSync(dirOf(root, peer))) {
      if (!name.startsWith('.')) received.push({ peer, name, size: fs.statSync(path.join(dirOf(root, peer), name)).size });
    }
  }
  return { ok: true, offers: store.readList(root, 'offers'), received };
}

async function acceptFile(root, id) {
  const offer = store.readList(root, 'offers').find((o) => o.id === id);
  if (!offer) return { ok: false, error: 'no such offer (it may have expired)' };
  const rec = store.readPeers(root)[offer.peer];
  if (!rec) return { ok: false, error: 'that peer is no longer connected' };
  let result;
  try {
    const r = await http.sendToPeer(root, offer.peer, { type: 'file-pull', id }, { stream: true });
    if (r.status !== 200) return { ok: false, error: await errorOf(r) };
    const s = { name: offer.peer, rec, keys: cx.linkKeys(root, rec) };
    const got = await receive(root, s, r.stream, Date.now(), offer);
    result = { ok: true, saved: got.name, size: got.size };
  } catch (e) { result = { ok: false, error: e.status ? e.message : 'the transfer was interrupted' }; }
  store.removeEntry(root, 'offers', id);
  try { await outbox.deliver(root, offer.peer, { type: 'file-result', id, ok: result.ok }); } catch { /* sender will time the entry out */ }
  return result;
}

async function refuseFile(root, id) {
  const offer = store.readList(root, 'offers').find((o) => o.id === id);
  if (!offer) return { ok: false, error: 'no such offer (it may have expired)' };
  store.removeEntry(root, 'offers', id);
  try { const r = await outbox.deliver(root, offer.peer, { type: 'file-result', id, ok: false, refused: true }); return { ok: true, peer: offer.peer, ...(r.queued ? { queued: true } : {}) }; }
  catch { return { ok: true, peer: offer.peer, warning: 'could not tell ' + offer.peer }; }
}

module.exports = { sendFile, files, acceptFile, refuseFile };
