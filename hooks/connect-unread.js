#!/usr/bin/env node
/**
 * UserPromptSubmit hook. Prints one line with unread Connect counts, or nothing.
 * Reads the connect files directly; never prints message text or file names, starts no process.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace } = require('./lib/workspace');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);
const DIR = path.join(ROOT, '.joserah', 'connect');
if (!fs.existsSync(DIR)) process.exit(0);

const json = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return fallback; }
};
const safe = (name) => /^[a-z0-9._-]{1,40}$/.test(name);

const read = json('read.json', {});
const unread = [];
let names = [];
try { names = fs.readdirSync(path.join(DIR, 'messages')); } catch { /* no messages yet */ }
for (const f of names) {
  const peer = f.replace(/\.jsonl$/, '');
  if (!f.endsWith('.jsonl') || !safe(peer)) continue;
  let n = 0;
  try {
    for (const line of fs.readFileSync(path.join(DIR, 'messages', f), 'utf8').split('\n')) {
      try { if (JSON.parse(line).dir === 'in') n++; } catch { /* blank or torn line */ }
    }
  } catch { continue; }
  n -= Number(read[peer]) || 0;
  if (n > 0) unread.push([peer, n]);
}

const offers = new Map();
const cutoff = Date.now() - 10 * 60000;
const list = json('offers.json', []);
for (const o of Array.isArray(list) ? list : []) {
  if (!o || !safe(String(o.peer)) || !(new Date(o.created).getTime() >= cutoff)) continue;
  offers.set(o.peer, (offers.get(o.peer) || 0) + 1);
}

if (!unread.length && !offers.size) process.exit(0);

const parts = [];
unread.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
if (unread.length) parts.push(unread.map(([p, n], i) => (i ? `${n} from ${p}` : `${n} unread from ${p}`)).join(', '));
if (offers.size) {
  const total = [...offers.values()].reduce((a, b) => a + b, 0);
  parts.push(`${total} file offer${total > 1 ? 's' : ''} from ${[...offers.keys()].join(', ')}`);
}
console.log(`[connect] ${parts.join('; ')}. Read with inbox() / files() when needed.`);
