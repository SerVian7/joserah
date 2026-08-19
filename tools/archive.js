#!/usr/bin/env node
/**
 * archive.js — dependency-free ZIP writer and reader for Joserah workspaces.
 *
 *   node archive.js create <workspace> <out.zip> [--include-keys]
 *   node archive.js list   <in.zip>
 *   node archive.js extract <in.zip> <target-dir> [--force]
 *
 * Writes standard ZIP (deflate, no encryption) so any OS unzip tool can open
 * it. Excludes root-level projects/ and docker-stack/, node_modules/.git/
 * .venv/.superpowers/ at any depth, keys/ at the workspace root (plus the
 * pre-0.3.0 legacy location .joserah/keys/) and every environment file
 * (.env, .env.*, *.env, *.env.*, .envrc) by default. Directory symlinks and
 * files that vanish mid-walk are skipped rather than aborting the run; `create`
 * reports them back as workspace-relative paths in its `skipped` output.
 *
 * `extract` verifies every entry's CRC-32 before writing it and refuses an
 * entry name that isn't writable on Windows (illegal characters, reserved
 * device names) rather than silently truncating it. It also refuses to
 * overwrite an existing file unless `--force` is given.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Root-anchored: these are contracts about the WORKSPACE ROOT layout, so a
// nested folder that happens to share the name is still backed up. Matching
// is case-insensitive because Windows and default-macOS filesystems are —
// `.joserah/Keys` IS the credentials directory there.
const EXCLUDE_ROOT_DIRS = ['projects', 'docker-stack'];
// Any-depth: conventional junk that is junk wherever it appears. '.superpowers'
// is disposable scratch written by the superpowers execution harness (plan
// ledgers, briefs, review packages); it is regenerated on demand and would
// otherwise dominate a backup's file count.
const EXCLUDE_ANY_DIRS = new Set(['node_modules', '.git', '.venv', '.superpowers']);
// Current layout plus the pre-0.3.0 layout — published workspaces still have
// the old one, and a credential left behind there must never enter a backup.
const KEYS_PREFIXES = ['keys', '.joserah/keys'];

// Environment files carry credentials. Matching the bare name `.env` is not
// enough: `.env.local`, `.env.production` and a prefixed `root.envrc` hold
// the same secrets. Covers .env, .env.*, *.env, *.env.* and *.envrc
// (including the bare .envrc) — while keeping the documentation files
// `.env.example` and `*.env.example`.
const ENV_ALLOW = /(^|\.)env\.example$/i;
const ENV_DENY = [/\.envrc$/i, /^\.env$/i, /^\.env\./i, /\.env$/i, /\.env\./i];
function isEnvFile(name) {
  if (ENV_ALLOW.test(name)) return false;
  return ENV_DENY.some((re) => re.test(name));
}

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

// Path-based, not name-based: matched against the relative path from the
// workspace root so it is unambiguous which directory this is regardless of
// what else in the tree happens to be named "keys". Case-insensitive because
// Windows and default-macOS filesystems are — a stale case-sensitive test
// here would be a silent security regression, so it must be verified, not
// assumed correct (see the K1 test).
function isKeysPath(rel) {
  const low = rel.toLowerCase();
  return KEYS_PREFIXES.some((p) => low === p || low.startsWith(p + '/'));
}
function isExcludedDir(rel, name) {
  if (EXCLUDE_ANY_DIRS.has(name.toLowerCase())) return true;
  const low = rel.toLowerCase();
  return EXCLUDE_ROOT_DIRS.some((d) => low === d);
}

function collect(root, includeKeys) {
  const files = [];
  const emptyDirs = [];
  const skipped = [];
  (function walk(dir, relBase) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      // A directory symlink/junction makes readFileSync throw EISDIR further
      // down; catching it here means the whole backup doesn't abort over one
      // stray link, and the caller learns exactly which path was skipped.
      if (e.isSymbolicLink()) { skipped.push(rel); continue; }
      if (e.isDirectory()) {
        if (isExcludedDir(rel, e.name)) continue;
        if (isKeysPath(rel) && !includeKeys) continue;
        walk(abs, rel);
      } else if (e.isFile()) {
        if (isEnvFile(e.name)) continue;
        files.push({ rel, abs });
      }
    }
    // A directory needs its own zip entry only if it was genuinely empty on
    // disk — that's what makes an authored empty note folder round-trip
    // through extract. Judging this from what *survived filtering* instead
    // would fabricate a placeholder for a directory that held nothing but an
    // excluded credentials folder or .git: there was never any real content
    // there to preserve, so no entry is written for it either.
    if (entries.length === 0 && relBase) emptyDirs.push(relBase + '/');
  })(root, '');
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  emptyDirs.sort();
  return { files, emptyDirs, skipped };
}

// A plain (non-ZIP64) archive caps both a single field's value and the total
// entry count at 16/32 bits. Failing loudly here beats a silently truncated
// zip that "works" until someone tries to open the file it clipped.
function u32(n, what) {
  if (n > 0xffffffff) {
    throw new Error(`${what} exceeds 4 GB — this writer has no ZIP64 support; exclude the file or split the workspace`);
  }
  return n;
}

function create(root, outPath, includeKeys) {
  const { files, emptyDirs, skipped } = collect(path.resolve(root), includeKeys);
  const totalEntries = files.length + emptyDirs.length;
  if (totalEntries > 0xffff) {
    throw new Error(`${totalEntries} entries — a plain ZIP holds at most 65535; this writer has no ZIP64 support`);
  }
  const chunks = [];
  const central = [];
  let offset = 0;

  function pushEntry(relName, data, comp, mtime) {
    const name = Buffer.from(relName, 'utf8');
    const crc = data.length ? crc32(data) : 0;
    const t = dosTime(mtime), d = dosDate(mtime);
    const method = comp === null ? 0 : 8;
    const compLen = comp === null ? 0 : u32(comp.length, `compressed ${relName}`);
    const rawLen = u32(data.length, relName);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(t, 10);
    local.writeUInt16LE(d, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compLen, 18);
    local.writeUInt32LE(rawLen, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name);
    if (comp !== null) chunks.push(comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(t, 12);
    cen.writeUInt16LE(d, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compLen, 20);
    cen.writeUInt32LE(rawLen, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(u32(offset, 'archive offset'), 42);
    central.push(cen, name);
    offset += 30 + name.length + (comp === null ? 0 : comp.length);
  }

  let written = 0;
  for (const f of files) {
    let data, st;
    try {
      data = fs.readFileSync(f.abs);
      st = fs.statSync(f.abs);
    } catch {
      skipped.push(f.rel); // vanished between walk and read — skip, don't abort
      continue;
    }
    pushEntry(f.rel, data, zlib.deflateRawSync(data, { level: 9 }), st.mtime);
    written++;
  }
  for (const d of emptyDirs) pushEntry(d, Buffer.alloc(0), null, new Date());

  const centralBuf = Buffer.concat(central);
  const count = written + emptyDirs.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(outPath, Buffer.concat([...chunks, centralBuf, end]));
  return { files: written, skipped };
}

function readEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const crc = buf.readUInt32LE(p + 16);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, rawSize, localOff, crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, entries };
}

// Characters ZIP permits but NTFS/Windows Explorer do not, plus the DOS
// device names that are reserved regardless of extension. Without this
// guard, `fs.writeFileSync` on e.g. "notes: draft.md" silently creates a
// 0-byte file named "notes" and diverts the content into an NTFS alternate
// data stream — extract reports success and the note is gone.
const WIN_BAD_CHARS = /[<>:"|?*\x00-\x1f]/;
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function inflateEntry(buf, e) {
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  let data;
  if (e.method === 8) {
    try {
      // maxOutputLength caps decompression so a hostile archive cannot
      // balloon memory (zip bomb); 1 GiB is far beyond any real workspace
      // file.
      data = zlib.inflateRawSync(raw, { maxOutputLength: 1 << 30 });
    } catch (err) {
      // zlib's own errors — a corrupt stream throws "unexpected end of
      // file", exceeding maxOutputLength throws ERR_BUFFER_TOO_LARGE —
      // never mention which entry failed. Rethrow naming it: this is
      // exactly what a caller diagnosing a corrupt archive or a zip bomb
      // needs to know, and it's what `verify` (Task 5) reports per entry.
      throw new Error(`failed to inflate ${e.name}: ${err.message}`);
    }
  } else {
    data = raw;
  }
  if (data.length !== e.rawSize) {
    throw new Error(`size mismatch for ${e.name}: expected ${e.rawSize}, got ${data.length} — archive is corrupt`);
  }
  if (crc32(data) !== e.crc) {
    throw new Error(`CRC mismatch for ${e.name} — archive is corrupt; do not trust this backup`);
  }
  return data;
}

function verify(zipPath) {
  const { buf, entries } = readEntries(zipPath);
  for (const e of entries) {
    if (e.name.endsWith('/') || e.name.endsWith('\\')) continue;
    inflateEntry(buf, e); // throws with the entry name on any mismatch
  }
  return entries.length;
}

function extract(zipPath, target, force) {
  const { buf, entries } = readEntries(zipPath);
  const root = path.resolve(target);
  // A filesystem root ("D:\" or "/") already ends in path.sep; appending
  // another would double it, so every entry's resolved path would fail the
  // startsWith prefix check below and be wrongly refused as unsafe.
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  // Pass 1 — resolve and validate every destination before a single byte is
  // written. An archive is untrusted input, and a traversal attempt or bad
  // name found halfway through must not leave a half-written tree behind.
  const planned = [];
  // Tracks destinations already claimed by an earlier entry in this same
  // archive, so two distinct, individually legal entries that collide once
  // written — e.g. "Notes.md" and "notes.md" on case-insensitive NTFS — are
  // caught here instead of the second silently overwriting the first in
  // pass 2 while extract still reports success.
  const seenDest = new Map();
  for (const e of entries) {
    // Windows' own `Compress-Archive` (and some other tools) emit entry names
    // with backslash separators, including for directory entries. Normalize
    // to forward slashes before deciding directory-ness or resolving a
    // destination, so a mixed-separator archive lands in the right place.
    const name = e.name.split('\\').join('/');
    // Entries whose (normalized) name ends in "/" are directories. Every ZIP
    // produced by `zip -r`, Finder, Explorer or Compress-Archive contains
    // them; writing one as a file creates a 0-byte file where a directory
    // belongs and the next entry then fails EEXIST.
    const isDir = name.endsWith('/');
    if (process.platform === 'win32') {
      for (const seg of name.split('/').filter(Boolean)) {
        if (WIN_BAD_CHARS.test(seg) || WIN_RESERVED.test(seg)) {
          throw new Error(`entry name is not writable on Windows: ${e.name} — extract on macOS/Linux or repack with a safe name`);
        }
      }
    }
    const dest = path.resolve(root, name);
    if (!dest.startsWith(rootWithSep)) {
      // A directory entry naming the target itself ("./") is a no-op, not an
      // attack. Anything else outside the target is refused.
      if (isDir && dest === root) continue;
      throw new Error(`refusing unsafe path in archive: ${e.name}`);
    }
    if (!isDir) {
      const key = process.platform === 'win32' ? dest.toLowerCase() : dest;
      const prior = seenDest.get(key);
      if (prior !== undefined) {
        throw new Error(`refusing case-colliding entries: ${prior} and ${e.name}`);
      }
      seenDest.set(key, e.name);
      if (!force && fs.existsSync(dest)) {
        throw new Error(`refusing to overwrite existing file: ${name} (pass --force to overwrite)`);
      }
    }
    planned.push({ e, dest, isDir });
  }

  // Pass 2 — write.
  for (const { e, dest, isDir } of planned) {
    if (isDir) { fs.mkdirSync(dest, { recursive: true }); continue; }
    const data = inflateEntry(buf, e);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return planned.length;
}

const [cmd, a, b] = process.argv.slice(2);
const includeKeys = process.argv.includes('--include-keys');
const force = process.argv.includes('--force');
try {
  if (cmd === 'create') { const r = create(a, b, includeKeys); console.log(JSON.stringify({ files: r.files, skipped: r.skipped, out: b })); }
  else if (cmd === 'list') console.log(readEntries(a).entries.map((e) => e.name).join('\n'));
  else if (cmd === 'extract') console.log(JSON.stringify({ files: extract(a, b, force), target: b }));
  else if (cmd === 'verify') console.log(JSON.stringify({ ok: true, entries: verify(a) }));
  else { console.error('usage: archive.js create|list|extract|verify'); process.exit(1); }
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}
