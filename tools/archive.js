#!/usr/bin/env node
/**
 * archive.js — dependency-free ZIP writer and reader for Joserah workspaces.
 *
 *   node archive.js create <workspace> <out.zip> [--include-keys]
 *   node archive.js list   <in.zip>
 *   node archive.js extract <in.zip> <target-dir>
 *
 * Writes standard ZIP (deflate, no encryption) so any OS unzip tool can open
 * it. Excludes projects/, docker-stack/, keys/ and every environment file
 * (.env, .env.*, *.env, *.env.*, .envrc) by default.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EXCLUDE_DIRS = new Set(['projects', 'docker-stack', 'node_modules', '.git', '.venv']);

// Environment files carry credentials. Matching the bare name `.env` is not
// enough: `.env.local`, `.env.production` and `.envrc` hold the same secrets.
// Covers .env, .env.*, *.env, *.env.* and .envrc — while keeping the
// documentation files `.env.example` and `*.env.example`.
const ENV_ALLOW = /(^|\.)env\.example$/i;
const ENV_DENY = [/^\.envrc$/i, /^\.env$/i, /^\.env\./i, /\.env$/i, /\.env\./i];
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

function collect(root, includeKeys) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue;
        if (e.name === 'keys' && !includeKeys) continue;
        walk(abs);
      } else {
        if (isEnvFile(e.name)) continue;
        out.push({ rel, abs });
      }
    }
  })(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function create(root, outPath, includeKeys) {
  const files = collect(path.resolve(root), includeKeys);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(f.rel, 'utf8');
    const st = fs.statSync(f.abs);
    const crc = crc32(data);
    const t = dosTime(st.mtime), d = dosDate(st.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // UTF-8 filename flag
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt16LE(t, 10);
    local.writeUInt16LE(d, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(t, 12);
    cen.writeUInt16LE(d, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(outPath, Buffer.concat([...chunks, centralBuf, end]));
  return files.length;
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
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, rawSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, entries };
}

function extract(zipPath, target) {
  const { buf, entries } = readEntries(zipPath);
  for (const e of entries) {
    const nameLen = buf.readUInt16LE(e.localOff + 26);
    const extraLen = buf.readUInt16LE(e.localOff + 28);
    const start = e.localOff + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + e.compSize);
    const data = e.method === 8 ? zlib.inflateRawSync(raw) : raw;
    // Refuse path traversal — an archive is untrusted input.
    const dest = path.resolve(target, e.name);
    if (!dest.startsWith(path.resolve(target) + path.sep)) {
      throw new Error(`refusing unsafe path in archive: ${e.name}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return entries.length;
}

const [cmd, a, b] = process.argv.slice(2);
const includeKeys = process.argv.includes('--include-keys');
try {
  if (cmd === 'create') console.log(JSON.stringify({ files: create(a, b, includeKeys), out: b }));
  else if (cmd === 'list') console.log(readEntries(a).entries.map((e) => e.name).join('\n'));
  else if (cmd === 'extract') console.log(JSON.stringify({ files: extract(a, b), target: b }));
  else { console.error('usage: archive.js create|list|extract'); process.exit(1); }
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}
