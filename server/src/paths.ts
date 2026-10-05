import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');
export function toolPath(name: string): string { return path.join(PLUGIN_ROOT, 'tools', name); }
export function now(): Date { const s = process.env.JOSERAH_NOW; return s ? new Date(s) : new Date(); }
const pad = (n: number) => String(n).padStart(2, '0');
export function localDay(d: Date = now()): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function hhmm(d: Date = now()): string { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function stateDir(workspace: string): string {
  if (process.env.JOSERAH_STATE_DIR) return process.env.JOSERAH_STATE_DIR;
  const abs = path.resolve(workspace);
  // Windows paths are case-insensitive: `c:\x` and `C:\X` must find the same state (password, cookie key).
  const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  return path.join(os.homedir(), '.joserah-server', h);
}
export function rel(root: string, abs: string): string { return path.relative(root, abs).split(path.sep).join('/'); }
