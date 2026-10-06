import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { SERVER_ROOT, tmpdir, tmpWorkspace } from './helpers.ts';
import { setupToken } from '../src/auth.ts';

const BIN = path.join(SERVER_ROOT, 'bin', 'joserah.mjs');
const free = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });

test('usage and a folder outside any workspace are refused plainly', (t) => {
  let r = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /usage: joserah serve/);
  r = spawnSync(process.execPath, [BIN, 'serve'], { cwd: tmpdir(t), encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /no workspace here/);
});

test('serve finds the workspace from a subfolder and prints its URL', async (t) => {
  const ws = tmpWorkspace(t); const port = await free();
  const child = spawn(process.execPath, [BIN, 'serve', '--port', String(port)], { cwd: path.join(ws, '.joserah'), env: { ...process.env, JOSERAH_STATE_DIR: path.join(tmpdir(t), 's'), JOSERAH_CLAUDE_BIN: process.execPath, JOSERAH_CLAUDE_PREFIX: path.join(SERVER_ROOT, 'test', 'fixtures', 'fake-claude.mjs') } });
  // Stopped inside the test and awaited: a process still running in the workspace folder would keep it from being removed (Windows).
  const stopped = new Promise<void>((r) => child.once('exit', () => r()));
  let line: string;
  try {
    line = await new Promise<string>((resolve, reject) => {
      let out = ''; child.stdout.on('data', (d: Buffer) => { out += d; if (out.includes('/setup?token=')) resolve(out); });
      setTimeout(() => reject(new Error(`no URL: ${out}`)), 15000).unref();
    });
  } finally { child.kill(); await stopped; }
  assert.match(line, new RegExp(`Joserah server: http://127\\.0\\.0\\.1:${port}/`));
});

test('setup-link prints the link from the state dir, never creating a password', (t) => {
  const ws = tmpWorkspace(t); const s = path.join(tmpdir(t), 's');
  const tok = setupToken(s);
  const r = spawnSync(process.execPath, [BIN, 'setup-link', '--workspace', ws], { encoding: 'utf8', env: { ...process.env, JOSERAH_STATE_DIR: s } });
  assert.equal(r.stdout.trim(), `http://127.0.0.1:4747/setup?token=${tok}`);
});
