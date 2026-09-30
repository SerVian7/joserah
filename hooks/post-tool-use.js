#!/usr/bin/env node
/**
 * PostToolUse hook, after a Bash call.
 * - Rule D3: after a move or rename, the link check runs; silent when every link resolves.
 * - 0.15.8: after a commit or push inside <workspace>/projects/, one [project] line says
 *   which records to bring up to date, once per session per repo HEAD.
 * Silent outside a Joserah workspace; never blocks, never fails the tool call.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace, readConfig } = require('./lib/workspace');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);

const MOVE = /\bmv\b|git\s+mv|Move-Item|Rename-Item|\brename\b|relocate/i;
const COMMIT = /\bgit\b[^;&|\n]*?\b(commit|push)\b/;

// Same idle-timer read as user-prompt-submit.js: stdin is not always closed.
function readStdin(idleMs = 1000) {
  return new Promise((resolve) => {
    let raw = '';
    let timer = setTimeout(() => resolve(raw), idleMs);
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => resolve(raw), idleMs); };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; arm(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(raw); });
  });
}

const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : '';
};

// The directory the commit ran in: `git -C <dir>`, else the last `cd <dir>` before it, else the session's cwd.
function commandDir(command, m, cwd) {
  const unq = (s) => (s || '').replace(/^["']|["']$/g, '');
  let dir = unq((/\s-C\s+("[^"]+"|'[^']+'|\S+)/.exec(m[0]) || [])[1]);
  if (!dir) {
    const cds = [...command.slice(0, m.index).matchAll(/\b(?:cd|pushd|Set-Location)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)];
    dir = cds.length ? unq(cds[cds.length - 1][1]) : '';
  }
  if (process.platform === 'win32') dir = dir.replace(/^\/([a-z])(?=\/|$)/i, '$1:');
  return path.resolve(cwd, dir || '.');
}

function projectLine(command, input) {
  const m = COMMIT.exec(command);
  if (!m) return null;
  const top = git(commandDir(command, m, input.cwd || process.cwd()), 'rev-parse', '--show-toplevel');
  if (!top) return null;
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const rel = path.relative(real(path.join(ROOT, 'projects')), real(top));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [full, h, date, ...subj] = git(top, 'log', '-1', '--format=%H%x09%h%x09%ad%x09%s', '--date=format:%Y-%m-%d %H:%M %z').split('\t');
  if (!full) return null;
  const subject = subj.join('\t');
  // A commit that only updates the record itself has nothing new to record (0.15.9).
  const files = git(top, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').filter(Boolean);
  if (files.length && files.every((f) => /^(docs\/status\.md|docs\/learnings\.md|CHANGELOG\.md)$/.test(f))) return null;
  // Once per session per repo HEAD, stamped in the OS temp dir like session-brief's once-a-day lines.
  const key = require('crypto').createHash('sha1').update(`${input.session_id || ''}|${real(top)}|${full}`).digest('hex').slice(0, 16);
  const stamp = path.join(os.tmpdir(), `joserah-project-${key}.stamp`);
  if (fs.existsSync(stamp)) return null;
  fs.writeFileSync(stamp, full, 'utf8');

  const name = path.basename(top);
  let line = `[project] ${name} — HEAD ${h} "${subject}". Update its record: docs/status.md "Last change: ${h} · ${date} · ${subject}", ` +
    'decisions as [decision] (strike the superseded), measurements to the device\'s page';
  const origin = git(top, 'remote', 'get-url', 'origin');
  if (origin) {
    const { normaliseRepo, projectPages } = require('../templates/memory/tools/project-drift');
    const want = normaliseRepo(origin);
    const cfg = readConfig(ROOT) || {};
    for (const s of Array.isArray(cfg.shared) ? cfg.shared : []) {
      let pages = [];
      try { pages = projectPages(path.resolve(ROOT, s.path || '')).filter((p) => p.repo === want); } catch { /* unreadable memory: no part */ }
      if (pages.length) line += `; and for shared memory ${s.name}: ${pages.map((p) => p.file).join(', ')} (via inbox note unless you are the sweeper)`;
    }
  }
  return line + '.';
}

(async () => {
  let input = {};
  try {
    const raw = await readStdin();
    if (raw) input = JSON.parse(raw) || {};
  } catch { /* ignore malformed input */ }
  const command = String(input.tool_input?.command || '');
  const out = [];
  try { const p = projectLine(command, input); if (p) out.push(p); } catch { /* silent, see above */ }

  if (MOVE.test(command)) {
    // The workspace's own copy is the one doctor keeps current; the plugin's is
    // the fallback for a workspace scaffolded before it travelled.
    const local = path.join(ROOT, '.joserah', 'tools', 'verify-links.js');
    const checker = fs.existsSync(local) ? local : path.join(__dirname, '..', 'tools', 'verify-links.js');
    const r = spawnSync(process.execPath, [checker, ROOT], { cwd: ROOT, encoding: 'utf8' });
    if (r.status === 1) out.push(`[links] A move or rename just ran and left links broken:\n${(r.stdout || '').trim()}`);
  }
  if (!out.length) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: out.join('\n') },
  }));
})();
