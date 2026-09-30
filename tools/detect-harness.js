#!/usr/bin/env node
/**
 * detect-harness.js — which assistant is this install running in?
 * Usage: node tools/detect-harness.js
 * Prints { "harness": "claude-code"|"antigravity"|"unknown", "evidence": [...] }.
 *
 * Documented markers only, strongest first:
 *  - `CLAUDECODE=1` — Claude Code sets it in every subprocess it spawns
 *    (code.claude.com/docs/en/env-vars). This one says "running in it now";
 *    every other marker only says "installed on this machine".
 *  - Antigravity's global folders, `~/.gemini/config/` (Antigravity 2.0) and
 *    `~/.gemini/antigravity-cli/` (its CLI) — antigravity.google/docs/skills.
 *    Its docs name no environment variable for the agent's own terminal, so
 *    none is checked: an undocumented marker would be a guess.
 *  - `claude` on PATH, or `~/.claude/` — Claude Code installed.
 * The assistant reading the answer knows which tool it is; this is the
 * evidence it confirms against, not the last word.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = os.homedir();
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function onPath(name) {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}

const running = process.env.CLAUDECODE === '1' ? ['CLAUDECODE=1 (running inside Claude Code)'] : [];
const antigravity = [path.join(home, '.gemini', 'config'), path.join(home, '.gemini', 'antigravity-cli')]
  .filter(isDir).map((p) => `${p} (Antigravity installed)`);
const claudeBin = onPath('claude');
const claude = [
  ...(claudeBin ? [`${claudeBin} (claude on PATH)`] : []),
  ...(isDir(path.join(home, '.claude')) ? [`${path.join(home, '.claude')} (Claude Code installed)`] : []),
];

const harness = running.length ? 'claude-code'
  : antigravity.length ? 'antigravity'
    : claude.length ? 'claude-code' : 'unknown';
console.log(JSON.stringify({ harness, evidence: [...running, ...antigravity, ...claude] }));
