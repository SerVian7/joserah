#!/usr/bin/env node
/**
 * PreToolUse(Bash) hook — the vault guard. Silent outside a Joserah workspace.
 * Denies a command that would put a secret on screen:
 *  - a `node …secret.js <name>` call not directly inside `$(` — the value
 *    may only ever be embedded in another command;
 *  - a command naming keys/secrets.json without going through secret.js.
 * A guardrail, not a wall: string matching cannot see every way to read a file.
 */
'use strict';
const { findWorkspace } = require('./lib/workspace');

if (!findWorkspace(process.cwd())) process.exit(0);

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

// Only a real `node …secret.js <name>` call counts; `git add …secret.js`,
// `--list`, `--has` and `--set` print no value.
function exposesSecret(cmd) {
  const bare = [...cmd.matchAll(/\bnode\s+["']?[^\s"']*secret\.js["']?\s+(?!--)\S/g)]
    .some((m) => !/\$\(\s*$/.test(cmd.slice(0, m.index)));
  const direct = /keys[\\/]+secrets\.json/i.test(cmd) && !/secret\.js/.test(cmd);
  return bare || direct;
}

(async () => {
  let command = '';
  try {
    const raw = await readStdin();
    if (raw) command = String(JSON.parse(raw).tool_input?.command || '');
  } catch { /* ignore malformed input */ }
  if (!exposesSecret(command)) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '[vault] Do not look at the value. Call `node .joserah/tools/secret.js <name>` only inside $(...) of the command that uses it; `--list` shows the names. keys/secrets.json is read only through secret.js.',
    },
  }));
})();
