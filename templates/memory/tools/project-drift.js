#!/usr/bin/env node
/**
 * project-drift.js — have the project pages in knowledge/ kept up with their repositories?
 * Usage: node tools/project-drift.js     prints one line; exit 0 always (a report)
 *
 * A page about a project or module carries frontmatter `repo: <git remote url>` and a body
 * line `Last change: <short hash> · <YYYY-MM-DD HH:MM> <tz> · <commit subject>`.
 * .memory/repos.json (this machine only, gitignored) maps a normalised repo url to a local
 * checkout; each mapped page's hash is compared with that checkout's HEAD. A page with
 * `repo:` and no `Last change:` line counts as behind. Node built-ins and git only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { mdFiles } = require('./verify-links');

const ROOT = path.resolve(__dirname, '..');

/** One form for every spelling of a remote: https, lowercase host, no userinfo, no .git. */
function normaliseRepo(url) {
  let u = String(url || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(u);
  if (scp) u = `https://${scp[1]}/${scp[2]}`;
  const m = /^(?:[a-z+]+:\/\/)(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u);
  return m ? `https://${m[1].toLowerCase()}/${m[2]}` : u;
}

/** Every knowledge page carrying `repo:`: { file (relative), name, repo (normalised), hash|null }. */
function projectPages(root = ROOT) {
  const out = [];
  for (const f of mdFiles(path.join(root, 'knowledge'))) {
    const text = fs.readFileSync(f, 'utf8').replace(/\r/g, '');
    const head = (/^---\n([\s\S]*?)\n---/.exec(text) || [])[1] || '';
    const repo = (/^repo:\s*(\S+)/m.exec(head) || [])[1];
    if (!repo) continue;
    const hash = (/^[-*\s]*Last change:\**\s*([0-9a-f]{4,40})\b/mi.exec(text) || [])[1] || null;
    out.push({ file: path.relative(root, f).split(path.sep).join('/'), name: path.basename(f, '.md'), repo: normaliseRepo(repo), hash });
  }
  return out;
}

/** The one line: null when no page carries `repo:`. */
function driftLine(root = ROOT) {
  const pages = projectPages(root);
  if (!pages.length) return null;
  let map = {};
  try { map = JSON.parse(fs.readFileSync(path.join(root, '.memory', 'repos.json'), 'utf8')); } catch { /* none mapped */ }
  const local = Object.fromEntries(Object.entries(map).map(([k, v]) => [normaliseRepo(k), v]));
  let compared = 0;
  const behind = [];
  for (const p of pages) {
    if (!local[p.repo]) continue;
    const r = spawnSync('git', ['-C', local[p.repo], 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    const full = r.status === 0 ? r.stdout.trim() : '';
    if (!full) continue;
    compared++;
    if (!p.hash || !full.startsWith(p.hash.toLowerCase())) behind.push(`${p.name} (page ${p.hash || 'none'}, repo ${full.slice(0, (p.hash || '').length || 7)})`);
  }
  if (!compared) return 'projects: no local checkouts mapped';
  return behind.length ? `projects: ${behind.length} behind — ${behind.join(', ')}` : 'projects: all current';
}

module.exports = { normaliseRepo, projectPages, driftLine };

if (require.main === module) console.log(driftLine() || 'projects: no project pages');
