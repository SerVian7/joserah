#!/usr/bin/env node
/**
 * PreToolUse(every tool) hook — silence guard. Silent outside a Joserah
 * workspace and inside a subagent (its payload carries `agent_id`). Counts
 * the main thread's tool calls since the owner's last message; on the 3rd and
 * every 3rd after, adds one line of context. Never blocks a tool, and exits 0
 * on any error: a nudge must not be able to break a tool call.
 *
 * The count lives in the OS temp dir, one small file per session, like the
 * other stamps these hooks keep; user-prompt-submit.js deletes it.
 */
'use strict';
const fs = require('fs');
const { findWorkspace } = require('./lib/workspace');
const { toolCountFile } = require('./lib/tool-count');

const EVERY = 3;

// Same idle-timer read as the other hooks: stdin is not always closed.
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
  try {
    if (!findWorkspace(process.cwd())) return;
    const input = JSON.parse(await readStdin());
    if (input.agent_id) return;
    const file = toolCountFile(input.session_id);
    if (!file) return;
    let n = 0;
    try { n = parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch { /* first call */ }
    n += 1;
    fs.writeFileSync(file, String(n), 'utf8');
    if (n % EVERY) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `${n} tool calls since the owner's last message — if the answer is already in hand, answer now; if not, tell the owner in one line what is happening.`,
      },
    }));
  } catch { /* never break a tool call */ }
})().finally(() => process.exit(0));
