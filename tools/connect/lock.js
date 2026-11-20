'use strict';
// Joserah Connect: a synchronous cross-process lock on a file path, no dependencies.
// The lock is <file>.lock, created exclusively (wx) and holding "<pid> <random>". Waiters sleep a few ms at a
// time; a lock older than STALE_MS, or one whose pid is gone, is broken; waiting is bounded and ends in a plain
// error. Inside one process the same file may be locked again (the inner call just runs).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STALE_MS = 10 * 1000;
const WAIT_MS = 5 * 1000;
const BUSY = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']); // what a lock that exists or is being removed looks like on Windows

const held = new Set();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// If the lock is stale, move it aside (a rename only one waiter wins) and drop it.
// shortcut: a waiter that judged a lock stale a moment before another one replaced it can still move the new one
// aside; it checks what it moved and puts it back, but the window is a few microseconds, and a lock is held ms.
function breakIfStale(lock, staleMs) {
  let txt; let st;
  try { st = fs.statSync(lock); txt = fs.readFileSync(lock, 'utf8'); } catch { return; }
  const pid = parseInt(txt, 10);
  if (!(Date.now() - st.mtimeMs > staleMs || (pid > 0 && !alive(pid)))) return;
  const grave = `${lock}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.dead`;
  try { fs.renameSync(lock, grave); } catch { return; }
  let moved = null;
  try { moved = fs.readFileSync(grave, 'utf8'); } catch { /* gone */ }
  if (moved !== null && moved !== txt) { try { fs.renameSync(grave, lock); return; } catch { /* fall through and drop it */ } }
  fs.rmSync(grave, { force: true });
}

function acquire(lock, waitMs, staleMs) {
  const stamp = `${process.pid} ${crypto.randomBytes(8).toString('hex')}`;
  const end = Date.now() + waitMs;
  for (let delay = 1; ; delay = Math.min(delay * 2, 25)) {
    try {
      const fd = fs.openSync(lock, 'wx');
      try { fs.writeSync(fd, stamp); } finally { fs.closeSync(fd); }
      return stamp;
    } catch (e) { if (!BUSY.has(e.code)) throw e; }
    breakIfStale(lock, staleMs);
    if (Date.now() >= end) throw new Error(`could not lock ${path.basename(lock, '.lock')}: another process is holding it`);
    sleep(delay + Math.floor(Math.random() * delay));
  }
}

function release(lock, stamp) {
  for (let i = 0; i < 5; i++) {
    try {
      if (fs.readFileSync(lock, 'utf8') !== stamp) return; // broken as stale and taken by someone else: not ours to remove
      fs.unlinkSync(lock);
      return;
    } catch (e) { if (e.code === 'ENOENT') return; sleep(5); }
  }
}

// withLock(file, fn, { waitMs, staleMs }) -> fn()'s result. fn must be synchronous and short.
function withLock(file, fn, opts = {}) {
  const key = path.resolve(file);
  if (held.has(key)) return fn();
  const lock = key + '.lock';
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const stamp = acquire(lock, opts.waitMs || WAIT_MS, opts.staleMs || STALE_MS);
  held.add(key);
  try { return fn(); } finally { held.delete(key); release(lock, stamp); }
}

module.exports = { withLock, STALE_MS, WAIT_MS };
