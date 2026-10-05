import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { toolPath, localDay } from './paths.ts';
import { dailyTrackerLib } from './cjs.ts';
import { TV_CSS, esc } from './layout.ts';

export const ARTIFACTS = '.joserah/desk/artifacts';
export type PageKind = 'tracker' | 'trail' | 'case' | 'static';
export interface PageInfo { day: string; folder: string; kind: PageKind; title: string; url: string; mtimeMs: number; reports: string[] }
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
// One path segment of an asset: no separator, no drive or stream colon, no wildcard, no control character.
const SEG_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,160}$/;
const SOURCES: Record<Exclude<PageKind, 'static'>, { file: string; args: (d: string) => string[] }> = {
  tracker: { file: 'rows.json', args: (d) => [toolPath('tracker.js'), d] },
  trail: { file: 'trail.json', args: (d) => [toolPath('trail.js'), 'render', d] },
  case: { file: 'cases.json', args: (d) => [toolPath('case.js'), 'render', d] },
};

/** The real path of `p` when it lies strictly inside `base` (symlinks resolved on both sides); otherwise null. */
function within(base: string, p: string): string | null {
  let real: string, root: string;
  try { real = fs.realpathSync(p); root = fs.realpathSync(base); } catch { return null; }
  const r = path.relative(root, real);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? real : null;
}

/** A page folder under the artifacts root that holds an index.html, or null for anything else (bad names, escapes, missing). */
export function pageDir(ws: string, day: string, folder: string): string | null {
  if (!DAY_RE.test(day) || !FOLDER_RE.test(folder) || folder.includes('..')) return null;
  const d = within(path.join(ws, ARTIFACTS), path.join(ws, ARTIFACTS, day, folder));
  return d && indexOf(d) ? d : null;
}

/** The page's index.html as a real path inside the page folder (a symlink out is refused), or null. */
export function indexOf(dir: string): string | null {
  const p = within(dir, path.join(dir, 'index.html'));
  try { return p && fs.statSync(p).isFile() ? p : null; } catch { return null; }
}

export function kindOf(dir: string): PageKind {
  for (const k of ['tracker', 'trail', 'case'] as const) if (fs.existsSync(path.join(dir, SOURCES[k].file))) return k;
  return 'static';
}

function titleOf(file: string): string {
  try { const m = /<title>([^<]*)<\/title>/i.exec(fs.readFileSync(file, 'utf8')); return m ? m[1].trim() : path.basename(path.dirname(file)); } catch { return path.basename(path.dirname(file)); }
}

/** Pages of the last `days` day folders, newest day first. */
export function listPages(ws: string, days = 14): PageInfo[] {
  const base = path.join(ws, ARTIFACTS);
  let dayDirs: string[] = [];
  try { dayDirs = fs.readdirSync(base).filter((d) => DAY_RE.test(d)).sort().reverse().slice(0, days); } catch { return []; }
  const out: PageInfo[] = [];
  for (const day of dayDirs) {
    let folders: string[] = [];
    try { folders = fs.readdirSync(path.join(base, day), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { continue; }
    for (const folder of folders) {
      const dir = pageDir(ws, day, folder);
      if (!dir) continue;
      const index = indexOf(dir);
      if (!index) continue;
      out.push({ day, folder, kind: kindOf(dir), title: titleOf(index), url: `/p/${day}/${folder}/`, mtimeMs: fs.statSync(index).mtimeMs,
        reports: fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'tracker.md' && !n.startsWith('.')).sort() });
    }
  }
  return out;
}

/** When the page's source JSON is newer than its index.html (a hand edit), the tool's own CLI renders it again. */
export function ensureFresh(dir: string): { rendered: boolean; error?: string } {
  const kind = kindOf(dir);
  if (kind === 'static') return { rendered: false };
  const src = path.join(dir, SOURCES[kind].file); const index = path.join(dir, 'index.html');
  try { if (fs.statSync(src).mtimeMs <= fs.statSync(index).mtimeMs) return { rendered: false }; } catch { return { rendered: false }; }
  const r = spawnSync(process.execPath, SOURCES[kind].args(dir), { encoding: 'utf8', timeout: 20000, windowsHide: true });
  return r.status === 0 ? { rendered: true } : { rendered: false, error: (r.stderr || r.stdout || '').trim().split('\n')[0] };
}

/**
 * A file inside the page folder named by a decoded, `/`-separated sub path. Null for a dot segment or dotfile, a backslash,
 * a colon or other reserved character, a trailing dot or space (Windows drops them), a symlink out, or anything not a file.
 */
export function resolveAsset(pageDirAbs: string, sub: string): string | null {
  const segs = sub.split('/');
  if (!segs.length || segs.some((s) => !SEG_RE.test(s) || s.startsWith('.') || /[. ]$/.test(s))) return null;
  const p = within(pageDirAbs, path.join(pageDirAbs, ...segs));
  try { return p && fs.statSync(p).isFile() ? p : null; } catch { return null; }
}

export function todayTrackerPage(ws: string): { day: string; folder: string } | null {
  const day = localDay();
  const d = dailyTrackerLib.dailyTracker(ws, day);
  return d ? { day, folder: path.basename(d) } : null;
}

/** Marks a served page (page id, mode), adds a viewport when the page has none, and the TV styles in `tv` mode. */
export function preparePage(html: string, o: { page: string; mode: 'page' | 'tv' }): string {
  let head = `<meta name="joserah-page" content="${esc(o.page)}"><meta name="joserah-mode" content="${o.mode}">`;
  if (!/<meta[^>]+name=["']?viewport["'\s>]/i.test(html)) head = '<meta name="viewport" content="width=device-width, initial-scale=1">' + head;
  if (o.mode === 'tv') head += `<style id="tv">${TV_CSS}</style>`;
  const HEAD = /<head(?:\s[^>]*)?>/i;   // not <header>
  return HEAD.test(html) ? html.replace(HEAD, (m) => m + head) : head + html;
}
