#!/usr/bin/env node
// Stands in for the claude CLI when screenshots need a job that keeps running: it thinks out loud every 1.6 s until stopped.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.289 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
for await (const _ of process.stdin) { /* drain */ }
const sid = '00000000-0000-4000-8000-000000000002';
const first = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'stream-ok.jsonl'), 'utf8').trim().split('\n')[0].replaceAll('SESSION', sid));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out(first);
const said = ['Bu haftanın günlüklerini okuyorum.', 'Pazartesi ve salı notlarında yayın hazırlığı öne çıkıyor.', 'Kararları ve açık işleri ayırıyorum.', 'Özetin ilk taslağını yazıyorum.'];
let i = 0;
setInterval(() => {
  const k = i++ % (said.length + 1);
  out({ type: 'assistant', session_id: sid, message: { content: k === said.length ? [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }] : [{ type: 'text', text: said[k] }] } });
}, 1600);
