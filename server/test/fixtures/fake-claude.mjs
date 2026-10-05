#!/usr/bin/env node
// Stands in for the claude CLI in tests. Records argv and stdin, writes or deletes files on request,
// then plays a scripted stream. FAKE_CLAUDE_MODE: ok | deny | budget | crash | hang | turns | echo | resume-fail.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const env = process.env;
const args = process.argv.slice(2);
if (env.FAKE_CLAUDE_ARGS_OUT) fs.writeFileSync(env.FAKE_CLAUDE_ARGS_OUT, JSON.stringify(args));
if (args[0] === '--version') { console.log('2.1.289 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: env.FAKE_CLAUDE_SIGNED_IN !== '0', authMethod: 'claude.ai' })); process.exit(0); }

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const stdin = Buffer.concat(chunks);
if (env.FAKE_CLAUDE_STDIN_OUT) fs.writeFileSync(env.FAKE_CLAUDE_STDIN_OUT, stdin);

const mode = env.FAKE_CLAUDE_MODE || 'ok';
const r = args.indexOf('--resume');
const sid = r >= 0 ? args[r + 1] : (env.FAKE_CLAUDE_SESSION || '00000000-0000-4000-8000-000000000001');
const lines = fs.readFileSync(path.join(import.meta.dirname, 'stream-ok.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l.replaceAll('SESSION', sid)));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

for (const spec of (env.FAKE_CLAUDE_WRITE || '').split(';').filter(Boolean)) {
  const i = spec.indexOf(':'); const rel = spec.slice(0, i);
  fs.mkdirSync(path.dirname(rel), { recursive: true }); fs.writeFileSync(rel, spec.slice(i + 1));
}
for (const rel of (env.FAKE_CLAUDE_DELETE || '').split(';').filter(Boolean)) fs.rmSync(rel, { force: true });

if (mode === 'resume-fail' && r >= 0) { process.stderr.write(`No conversation found with session ID: ${sid}\n`); process.exit(1); }
if (mode === 'crash') { out(lines[0]); process.stderr.write('boom\n'); process.exit(3); }
if (mode === 'hang') {
  out(lines[0]);
  const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  if (env.FAKE_CLAUDE_PIDS) fs.writeFileSync(env.FAKE_CLAUDE_PIDS, JSON.stringify([process.pid, g.pid]));
  setInterval(() => {}, 1000);
} else if (mode === 'turns') {
  out(lines[0]);
  let i = 0;
  setInterval(() => {
    out({ type: 'assistant', session_id: sid, message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }] } });
    out({ type: 'user', session_id: sid, message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'x' }] } });
    i += 1;
  }, 5);
} else {
  for (const o of lines) {
    if (o.type === 'result') {
      if (mode === 'deny') {
        out({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'toolu_d', session_id: sid });
        o.permission_denials = [{ tool_name: 'Bash', tool_use_id: 'toolu_d', tool_input: { command: 'make' } }];
      }
      if (mode === 'budget') { o.subtype = 'error_max_budget_usd'; o.is_error = true; o.result = ''; }
      if (mode === 'echo') o.result = stdin.toString('utf8');
    }
    out(o);
  }
  process.stdout.write('this line is not json\n');
  process.exit(0);
}
