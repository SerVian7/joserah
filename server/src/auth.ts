import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AuthFile { version: 1; scrypt: { salt: string; hash: string; N: number; r: number; p: number; keylen: number }; cookieKey: string; generation: number; createdAt: string }
export class AuthFileError extends Error {}
export type AuthState = { kind: 'setup' } | { kind: 'ready'; file: AuthFile };
export const COOKIE = 'jsid';
export const MIN_PASSWORD = 10;
const P = { N: 16384, r: 8, p: 1, keylen: 64 };

export function loadAuth(stateDir: string): AuthState {
  const p = path.join(stateDir, 'auth.json');
  let text: string;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'setup' };
    throw new AuthFileError(`cannot read ${p}: ${(e as Error).message}`);
  }
  if (!text.trim()) throw new AuthFileError(`${p} is empty — restore it or delete it to run setup again`);
  let j: AuthFile;
  try { j = JSON.parse(text); } catch { throw new AuthFileError(`${p} is not valid JSON`); }
  if (j?.version !== 1 || !j.scrypt?.salt || !j.scrypt?.hash || typeof j.cookieKey !== 'string' || j.cookieKey.length < 32 || typeof j.generation !== 'number') throw new AuthFileError(`${p} is missing fields`);
  return { kind: 'ready', file: j };
}

export function writeAuth(stateDir: string, file: AuthFile): void {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const p = path.join(stateDir, 'auth.json'); const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
}

function scrypt(pw: string, salt: Buffer, s: { N: number; r: number; p: number; keylen: number }): Buffer {
  return crypto.scryptSync(pw.normalize('NFC'), salt, s.keylen, { N: s.N, r: s.r, p: s.p, maxmem: 64 * 1024 * 1024 });
}
export function newAuthFile(password: string, generation = 1): AuthFile {
  const salt = crypto.randomBytes(16);
  return { version: 1, scrypt: { salt: salt.toString('base64'), hash: scrypt(password, salt, P).toString('base64'), ...P }, cookieKey: crypto.randomBytes(32).toString('hex'), generation, createdAt: new Date().toISOString() };
}
export function verifyPassword(password: string, s: AuthFile['scrypt']): boolean {
  const want = Buffer.from(s.hash, 'base64');
  const got = scrypt(password, Buffer.from(s.salt, 'base64'), s);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const mac = (key: string, body: string) => crypto.createHmac('sha256', key).update(body).digest('base64url');
export function signSession(file: AuthFile, nowMs = Date.now(), days = 30): string {
  const body = `${file.generation}.${nowMs + days * 86400000}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${body}.${mac(file.cookieKey, body)}`;
}
export function checkSession(file: AuthFile, value: string | undefined, nowMs = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const body = parts.slice(0, 3).join('.');
  const a = Buffer.from(mac(file.cookieKey, body)); const b = Buffer.from(parts[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(parts[0]) === file.generation && Number(parts[1]) > nowMs;
}

export class RateLimiter {
  #m = new Map<string, { hits: number[]; until: number; level: number }>();
  check(addr: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const e = this.#m.get(addr);
    if (e && e.until > nowMs) return { ok: false, retryAfterSec: Math.ceil((e.until - nowMs) / 1000) };
    return { ok: true };
  }
  fail(addr: string, nowMs: number): void {
    const e = this.#m.get(addr) ?? { hits: [], until: 0, level: 0 };
    e.hits = e.hits.filter((h) => nowMs - h < 60000); e.hits.push(nowMs);
    if (e.hits.length >= 5) { e.level += 1; e.until = nowMs + Math.min(60 * 2 ** (e.level - 1), 3600) * 1000; e.hits = []; }
    this.#m.set(addr, e);
  }
  success(addr: string): void { this.#m.delete(addr); }
}

export function originOk(reqUrl: string, origin: string | undefined, extra: (string | null)[]): boolean {
  if (!origin) return false;
  return origin === new URL(reqUrl).origin || extra.some((x) => !!x && x === origin);
}

export function setupToken(stateDir: string): string {
  const p = path.join(stateDir, 'setup-token');
  try { const t = fs.readFileSync(p, 'utf8').trim(); if (t) return t; } catch { /* first start */ }
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const t = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(p, t, { mode: 0o600 });
  return t;
}
export function clearSetupToken(stateDir: string): void { fs.rmSync(path.join(stateDir, 'setup-token'), { force: true }); }
