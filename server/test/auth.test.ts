import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadAuth, writeAuth, newAuthFile, verifyPassword, signSession, checkSession, RateLimiter, originOk, AuthFileError, setupToken, clearSetupToken } from '../src/auth.ts';
import { tmpdir } from './helpers.ts';

test('a missing auth file means setup; empty, unreadable or broken stops the server', (t) => {
  const d = tmpdir(t);
  assert.deepEqual(loadAuth(d), { kind: 'setup' });
  fs.writeFileSync(path.join(d, 'auth.json'), '');
  assert.throws(() => loadAuth(d), AuthFileError);
  fs.writeFileSync(path.join(d, 'auth.json'), '{"version":1}');
  assert.throws(() => loadAuth(d), /missing fields/);
  fs.rmSync(path.join(d, 'auth.json')); fs.mkdirSync(path.join(d, 'auth.json'));
  assert.throws(() => loadAuth(d), AuthFileError, 'a directory in its place is unreadable, not missing');
});

test('scrypt round trip and a written file loads back', (t) => {
  const d = tmpdir(t);
  const f = newAuthFile('correct horse battery');
  assert.ok(verifyPassword('correct horse battery', f.scrypt));
  assert.ok(!verifyPassword('correct horse batterx', f.scrypt));
  writeAuth(d, f);
  const s = loadAuth(d);
  assert.equal(s.kind, 'ready');
  assert.equal(JSON.stringify(s), JSON.stringify({ kind: 'ready', file: f }));
});

test('session cookies expire, are tamper-proof and die with a new generation', () => {
  const f = newAuthFile('pw-0123456789');
  const v = signSession(f, 1000, 1);
  assert.ok(checkSession(f, v, 2000));
  assert.ok(!checkSession(f, v, 1000 + 86400000 + 1), 'expired');
  assert.ok(!checkSession(f, v.slice(0, -2) + 'xx', 2000), 'tampered');
  assert.ok(!checkSession({ ...f, generation: f.generation + 1 }, v, 2000), 'signed out everywhere');
  assert.ok(!checkSession(f, undefined, 2000));
});

test('rate limit: 5 a minute, then a doubling block capped at an hour', () => {
  const r = new RateLimiter();
  let t0 = 0;
  for (let i = 0; i < 5; i++) { assert.deepEqual(r.check('a', t0), { ok: true }); r.fail('a', t0); }
  assert.deepEqual(r.check('a', t0), { ok: false, retryAfterSec: 60 });
  assert.deepEqual(r.check('b', t0), { ok: true }, 'per address');
  t0 += 61000;
  for (let i = 0; i < 5; i++) r.fail('a', t0);
  assert.deepEqual(r.check('a', t0), { ok: false, retryAfterSec: 120 });
  for (let k = 0; k < 10; k++) { t0 += 4000000; for (let i = 0; i < 5; i++) r.fail('a', t0); }
  assert.deepEqual(r.check('a', t0), { ok: false, retryAfterSec: 3600 });
  r.success('a');
  assert.deepEqual(r.check('a', t0), { ok: true });
});

test('origin must match the server or the declared public origin', () => {
  assert.ok(originOk('http://127.0.0.1:4747/api/x', 'http://127.0.0.1:4747', []));
  assert.ok(!originOk('http://127.0.0.1:4747/api/x', 'http://evil.example.invalid', []));
  assert.ok(!originOk('http://127.0.0.1:4747/api/x', undefined, []));
  assert.ok(originOk('http://127.0.0.1:4747/api/x', 'https://w.example.invalid', ['https://w.example.invalid']));
});

test('setup token is created once and cleared', (t) => {
  const d = tmpdir(t);
  const a = setupToken(d);
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(setupToken(d), a);
  clearSetupToken(d);
  assert.notEqual(setupToken(d), a);
});

test('origin: a declared public origin matches with or without a trailing slash', () => {
  assert.ok(originOk('http://127.0.0.1:4747/api/x', 'https://w.example.invalid', ['https://w.example.invalid/']));
  assert.ok(!originOk('http://127.0.0.1:4747/api/x', 'https://w.example.invalid.evil.example.invalid', ['https://w.example.invalid/']));
  assert.ok(!originOk('http://127.0.0.1:4747/api/x', 'null', ['not a url', null]));
});

test('an auth file whose scrypt parameters are missing or absurd stops the server', (t) => {
  const d = tmpdir(t);
  const good = newAuthFile('pw-0123456789');
  const bad = (scrypt: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ ...good, scrypt: { ...good.scrypt, ...scrypt }, ...extra }));
    assert.throws(() => loadAuth(d), AuthFileError, JSON.stringify({ scrypt, extra }));
  };
  bad({ keylen: undefined }); bad({ N: 1000 }); bad({ r: 0 }); bad({ p: 'x' }); bad({ keylen: 8 }); bad({ salt: 5 });
  bad({}, { generation: 1.5 });
  writeAuth(d, good);
  assert.equal(loadAuth(d).kind, 'ready');
});
