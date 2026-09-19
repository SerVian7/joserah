#!/usr/bin/env node
/**
 * PostToolUse hook (rule D3: after a move or rename, the link check runs).
 * Silent outside a Joserah workspace, silent after a command that moves
 * nothing, and silent when every link still resolves.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace } = require('./lib/workspace');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);

const MOVE = /\bmv\b|git\s+mv|Move-Item|Rename-Item|\brename\b|relocate/i;

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

(async () => {
  let command = '';
  try {
    const raw = await readStdin();
    if (raw) command = String(JSON.parse(raw).tool_input?.command || '');
  } catch { /* ignore malformed input */ }
  if (!MOVE.test(command)) return;

  // The workspace's own copy is the one doctor keeps current; the plugin's is
  // the fallback for a workspace scaffolded before it travelled.
  const local = path.join(ROOT, '.joserah', 'tools', 'verify-links.js');
  const checker = fs.existsSync(local) ? local : path.join(__dirname, '..', 'tools', 'verify-links.js');
  const r = spawnSync(process.execPath, [checker, ROOT], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 1) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `[links] A move or rename just ran and left links broken:\n${(r.stdout || '').trim()}`,
    },
  }));
})();
