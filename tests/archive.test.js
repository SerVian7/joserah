'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');

function make(dir, rel, content = 'x') {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function listZip(zip) {
  const r = runTool('archive.js', ['list', zip]);
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}

test('K1: keys exclusion is case-insensitive and covers the legacy path', (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, 'Keys/token.txt', 'secret');
  make(ws, '.joserah/Keys/old-token.txt', 'secret');
  make(ws, 'note.md');
  const r = runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  assert.strictEqual(r.status, 0, r.stderr);
  const names = listZip(path.join(d, 'o.zip'));
  assert.deepStrictEqual(names, ['note.md']);
});

test('I4: nested dir named projects IS archived; root projects/ is not', (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, '.joserah/knowledge/projects/note.md');
  make(ws, 'projects/real-checkout/file.md');
  runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  const names = listZip(path.join(d, 'o.zip'));
  assert.ok(names.includes('.joserah/knowledge/projects/note.md'));
  assert.ok(!names.some((n) => n.startsWith('projects/')));
});

test('I5+M5: symlinks are skipped and reported, not fatal', { skip: process.platform !== 'win32' && 'symlink test tuned for win32 junctions' }, (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, 'real/file.md');
  fs.mkdirSync(path.join(d, 'outside'));
  fs.symlinkSync(path.join(d, 'outside'), path.join(ws, 'link'), 'junction');
  const r = runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepStrictEqual(out.skipped, ['link']);
});

test('M2: empty directories survive the round trip', (t) => {
  const d = tmpdir(t);
  const ws = path.join(d, 'ws');
  make(ws, 'a/file.md');
  fs.mkdirSync(path.join(ws, 'empty'), { recursive: true });
  runTool('archive.js', ['create', ws, path.join(d, 'o.zip')]);
  const target = path.join(d, 'out');
  const r = runTool('archive.js', ['extract', path.join(d, 'o.zip'), target]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.statSync(path.join(target, 'empty')).isDirectory());
});

const zlib = require('zlib');

// CRC-32 for building fixture archives with known-good and known-wrong
// checksums. Inlined rather than imported because archive.js is a CLI
// script with no exports, and rather than zlib.crc32 because that landed
// in Node 20.15 while this project supports Node 18.
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

// Hand-build a minimal one-entry zip so tests can craft hostile names/CRCs.
function buildZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data, crc } of entries) {
    const nb = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const c = crc !== undefined ? crc : crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(c, 14); local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nb.length, 26);
    chunks.push(local, nb, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(c, 16); cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nb.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nb);
    offset += 30 + nb.length + comp.length;
  }
  const cb = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cb.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cb, end]);
}

test('K2: extract refuses Windows-illegal entry names on win32', { skip: process.platform !== 'win32' }, (t) => {
  const d = tmpdir(t);
  const zip = path.join(d, 'h.zip');
  fs.writeFileSync(zip, buildZip([{ name: 'notes: draft.md', data: Buffer.from('x') }]));
  const r = runTool('archive.js', ['extract', zip, path.join(d, 'out')]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /notes: draft\.md/);
  assert.ok(!fs.existsSync(path.join(d, 'out', 'notes')), 'no ADS-truncated file written');
});

test('M6: extract fails on CRC mismatch instead of writing corrupt bytes', (t) => {
  const d = tmpdir(t);
  const zip = path.join(d, 'bad.zip');
  fs.writeFileSync(zip, buildZip([{ name: 'a.md', data: Buffer.from('hello'), crc: 0xdeadbeef }]));
  const r = runTool('archive.js', ['extract', zip, path.join(d, 'out')]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /CRC/i);
});

test('M7: extract refuses to overwrite without --force', (t) => {
  const d = tmpdir(t);
  const zip = path.join(d, 'a.zip');
  fs.writeFileSync(zip, buildZip([{ name: 'a.md', data: Buffer.from('new') }]));
  const target = path.join(d, 'out');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'a.md'), 'old');
  const r1 = runTool('archive.js', ['extract', zip, target]);
  assert.strictEqual(r1.status, 1);
  assert.strictEqual(fs.readFileSync(path.join(target, 'a.md'), 'utf8'), 'old');
  const r2 = runTool('archive.js', ['extract', zip, target, '--force']);
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.strictEqual(fs.readFileSync(path.join(target, 'a.md'), 'utf8'), 'new');
});

test('inflate failure on a corrupt deflate stream names the offending entry', (t) => {
  const d = tmpdir(t);
  const zip = path.join(d, 'corrupt.zip');
  const name = 'broken.md';
  const data = Buffer.from('hello world, this is a test payload for corruption'.repeat(5));
  const zipBuf = buildZip([{ name, data }]);
  const nb = Buffer.byteLength(name, 'utf8');
  const localCompOff = 30 + nb; // where the compressed payload begins
  const origCompLen = zipBuf.readUInt32LE(18); // local header compSize field
  const cut = 4;
  const newCompLen = origCompLen - cut;
  // Drop the last few bytes of the compressed payload, then patch every
  // length/offset field that must agree (local header, central directory,
  // EOCD) so the only thing wrong is the deflate bitstream itself being
  // truncated mid-block — not some structural error archive.js would catch
  // some other way before ever calling zlib.
  const truncated = Buffer.concat([
    zipBuf.subarray(0, localCompOff + newCompLen),
    zipBuf.subarray(localCompOff + origCompLen),
  ]);
  truncated.writeUInt32LE(newCompLen, 18); // local header compSize
  const centralStart = localCompOff + newCompLen;
  truncated.writeUInt32LE(newCompLen, centralStart + 20); // central dir compSize
  const eocdOff = truncated.length - 22;
  truncated.writeUInt32LE(centralStart, eocdOff + 16); // central dir offset
  fs.writeFileSync(zip, truncated);
  const r = runTool('archive.js', ['extract', zip, path.join(d, 'out')]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /broken\.md/);
});

test('extract refuses case-colliding entry names on win32', { skip: process.platform !== 'win32' }, (t) => {
  const d = tmpdir(t);
  const zip = path.join(d, 'case.zip');
  fs.writeFileSync(zip, buildZip([
    { name: 'Notes.md', data: Buffer.from('first') },
    { name: 'notes.md', data: Buffer.from('second') },
  ]));
  const target = path.join(d, 'out');
  const r = runTool('archive.js', ['extract', zip, target]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Notes\.md/);
  assert.match(r.stderr, /notes\.md/);
  assert.ok(!fs.existsSync(target), 'nothing written to target on collision');
});
