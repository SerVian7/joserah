import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { App } from './app.ts';
import { PLUGIN_ROOT } from './paths.ts';

// The interface's own files (stylesheet, script, vendored libraries, font) under server/static, plus the recorded J.
// Served without a session (the sign-in page needs them) and only by exact name: the table is built once from the
// folder, so no request path is ever joined onto the disk.
const ROOT = path.resolve(import.meta.dirname, '..', 'static');
const TYPES: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
interface Entry { file: string; type: string; etag: string; gz: Buffer | null }

function build(): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const add = (name: string, file: string) => {
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return;
    const buf = fs.readFileSync(file);
    const etag = `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
    // Text is gzipped once here; fonts and images are compressed already.
    const gz = type.startsWith('text/') ? zlib.gzipSync(buf, { level: 9 }) : null;
    out.set(name, { file, type, etag, gz });
  };
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      else if (e.isFile()) add(prefix + e.name, path.join(dir, e.name));
    }
  };
  walk(ROOT, '');
  // The J: the brand's own faded mark, unchanged. The page lifts it to full strength itself.
  add('j.png', path.join(PLUGIN_ROOT, 'assets', 'j-faded.png'));
  return out;
}
const FILES = build();

/** A short content hash for cache busting: `/_/s/ui.css?v=…`. */
export const ASSET_V = crypto.createHash('sha1').update([...FILES.values()].map((f) => f.etag).join()).digest('hex').slice(0, 8);
export const asset = (name: string) => `/_/s/${name}?v=${ASSET_V}`;

export function register(app: App): void {
  app.get('/_/s/*', (c) => {
    const name = new URL(c.req.url).pathname.slice('/_/s/'.length);
    const f = FILES.get(name);
    if (!f) return c.notFound();
    // A versioned link never changes; an unversioned one (the font a stylesheet names) is checked each time.
    const cache = c.req.query('v') === ASSET_V ? 'public, max-age=31536000, immutable' : 'no-cache';
    if (c.req.header('if-none-match') === f.etag) return c.body(null, 304, { ETag: f.etag, 'Cache-Control': cache });
    const base = { 'Content-Type': f.type, ETag: f.etag, 'Cache-Control': cache, Vary: 'Accept-Encoding' };
    if (f.gz && /(^|[\s,])gzip([\s;,]|$)/i.test(c.req.header('accept-encoding') ?? '')) return c.body(new Uint8Array(f.gz), 200, { ...base, 'Content-Encoding': 'gzip' });
    return c.body(fs.readFileSync(f.file), 200, base);
  });
}
