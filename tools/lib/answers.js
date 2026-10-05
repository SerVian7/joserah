'use strict';
/**
 * answers.js (lib) — the answers a page collects, kept in answers.json beside the page's rows.json.
 * Two writers share it: the server (the owner's answers from the page) and the terminal
 * (tools/answers.js: the assistant's replies and read marks). Every write takes answers.json.lock,
 * re-reads, merges by document id and field, and replaces the file atomically, so neither writer loses
 * the other's work. An owner document never becomes the assistant's and the reverse (spec §8: "Answers
 * never overwrite"). Ids are the page's: slugId ("a-<slug>-<hash>"), a note "<id>--n<time>", a reply
 * "<id>--r<time>". No dependencies.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'answers.json';
const ID_RE = /^[a-z0-9-]{1,160}$/;
const FIELDS = ['row', 'key', 'label', 'note', 'at'];
const TRANSIENT = ['EPERM', 'EBUSY', 'EACCES'];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const isReplyId = (id) => /--r[a-z0-9]+$/.test(id);
const empty = () => ({ version: 1, docs: {} });
const shape = (j) => (j && typeof j.docs === 'object' && j.docs && !Array.isArray(j.docs) ? { version: 1, docs: j.docs } : null);

// The lock is a file created exclusively; a lock older than 10 s is a dead writer's and is taken over.
// Not re-entrant: nothing inside fn may call withLock on the same dir.
function withLock(dir, fn) {
  const lock = path.join(dir, FILE + '.lock');
  const until = Date.now() + 5000;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST' && !TRANSIENT.includes(e.code)) throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmSync(lock, { force: true }); continue; } } catch { /* gone or busy: retry */ }
      if (Date.now() > until) throw new Error(`answers: ${lock} is held by another writer`);
      sleep(10 + Math.floor(Math.random() * 20));
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

// For readers: a missing or broken file reads as empty.
function read(dir) {
  try { return shape(JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'))) || empty(); } catch { return empty(); }
}

// For writers, under the lock: a transient read error is retried, never taken for an empty file (that
// would write the other writer's answers away); a file that is not answers JSON is kept aside, not lost.
function readForWrite(dir) {
  const p = path.join(dir, FILE);
  let text;
  for (let i = 0; ; i++) {
    try { text = fs.readFileSync(p, 'utf8'); break; } catch (e) {
      if (e.code === 'ENOENT') return empty();
      if (i >= 6 || !TRANSIENT.includes(e.code)) throw e;
      sleep(20 * (i + 1));
    }
  }
  let j = null;
  try { j = shape(JSON.parse(text)); } catch { /* broken */ }
  if (j) return j;
  fs.writeFileSync(`${p}.broken-${Date.now()}`, text);
  return empty();
}

function write(dir, store) {
  const p = path.join(dir, FILE);
  const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, p); return; } catch (e) {
      if (i >= 6 || !TRANSIENT.includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      sleep(20 * (i + 1));
    }
  }
}

function clean(doc) {
  const out = {};
  for (const k of FIELDS) {
    if (doc[k] === undefined) continue;
    if (typeof doc[k] !== 'string') return null;
    out[k] = doc[k].slice(0, k === 'note' ? 2000 : 300);
  }
  return out;
}

function check(id, doc, author) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, code: 'bad-id' };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, code: 'bad-doc' };
  const c = clean(doc);
  if (!c) return { ok: false, code: 'bad-doc' };
  if ((author === 'assistant') !== isReplyId(id)) return { ok: false, code: 'not-yours' };
  return { ok: true, c };
}

// Merge c into the store s under the lock; the caller writes.
function merge(s, id, c, author) {
  const cur = s.docs[id];
  if (cur && (cur.from === 'assistant') !== (author === 'assistant')) return { ok: false, code: 'not-yours' };
  const next = author === 'assistant' ? { ...cur, ...c, from: 'assistant', state: 'reply' } : { ...cur, ...c, state: 'new' };
  if (!next.at) next.at = new Date().toISOString();
  s.docs[id] = next;
  return { ok: true, doc: next };
}

function put(dir, id, doc, author) {
  const v = check(id, doc, author);
  if (!v.ok) return v;
  fs.mkdirSync(dir, { recursive: true });
  return withLock(dir, () => {
    const s = readForWrite(dir);
    const r = merge(s, id, v.c, author);
    if (r.ok) write(dir, s);
    return r;
  });
}

function list(dir, { onlyNew = false } = {}) {
  return Object.entries(read(dir).docs).map(([id, d]) => ({ id, ...d }))
    .filter((d) => !onlyNew || d.state === 'new')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));
}

function markRead(dir, id) {
  if (typeof id !== 'string' || !ID_RE.test(id) || !fs.existsSync(path.join(dir, FILE))) return { ok: false, code: 'not-found' };
  return withLock(dir, () => {
    const s = readForWrite(dir);
    const d = s.docs[id];
    if (!d) return { ok: false, code: 'not-found' };
    if (d.from === 'assistant') return { ok: false, code: 'not-yours' };
    s.docs[id] = { ...d, state: 'read' };
    write(dir, s);
    return { ok: true, doc: s.docs[id] };
  });
}

// The reply id is chosen under the lock, so two replies to one answer in the same millisecond get two
// documents instead of the second merging over the first.
function reply(dir, baseId, note, nowMs = Date.now()) {
  const base = String(baseId).split('--')[0];
  if (!ID_RE.test(base)) return { ok: false, code: 'bad-id' };
  const probe = check(`${base}--r0`, { note: String(note) }, 'assistant');
  if (!probe.ok) return probe;
  fs.mkdirSync(dir, { recursive: true });
  return withLock(dir, () => {
    const s = readForWrite(dir);
    let t = nowMs;
    while (s.docs[`${base}--r${t.toString(36)}`]) t++;
    const id = `${base}--r${t.toString(36)}`;
    if (!ID_RE.test(id)) return { ok: false, code: 'bad-id' };
    const row = (s.docs[baseId] || s.docs[base] || {}).row;
    const c = clean({ ...(typeof row === 'string' ? { row } : {}), note: String(note), at: new Date(nowMs).toISOString() });
    const r = merge(s, id, c, 'assistant');
    if (!r.ok) return r;
    write(dir, s);
    return { ...r, id };
  });
}

function newCounts(workspace, days = 2) {
  const base = path.join(workspace, '.joserah', 'desk', 'artifacts');
  let dayDirs = [];
  try { dayDirs = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, days); } catch { return []; }
  const out = [];
  for (const day of dayDirs) {
    let folders = [];
    try { folders = fs.readdirSync(path.join(base, day), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { continue; }
    for (const f of folders) {
      const dir = path.join(base, day, f);
      if (!fs.existsSync(path.join(dir, FILE))) continue;
      const count = list(dir, { onlyNew: true }).length;
      if (count) out.push({ page: `${day}/${f}`, dir, count });
    }
  }
  return out;
}

module.exports = { FILE, ID_RE, isReplyId, read, put, list, markRead, reply, newCounts, withLock };
