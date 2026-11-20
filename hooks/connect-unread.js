#!/usr/bin/env node
/**
 * UserPromptSubmit hook. Prints one line with unread Connect counts, or nothing.
 * Counts this workspace's own inbox, the device's shared inbox (owner trust only: a guest workspace never reads the
 * home folder), file offers meant for this workspace and pairing requests. Reads the files directly; never prints
 * message text or file names, starts no process.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace } = require('./lib/workspace');
const device = require('../tools/connect/device');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);
let info;
try { info = device.resolve(ROOT); } catch { process.exit(0); }
const OWN = path.join(ROOT, '.joserah', 'connect');
const DEV = info.mode === 'owner' ? info.deviceRoot : null; // the device folder is its own connect folder
if (!fs.existsSync(OWN) && !(DEV && fs.existsSync(DEV))) process.exit(0);

const json = (dir, f, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return fallback; }
};
const safe = (name) => /^[a-z0-9._-]{1,40}$/.test(name);

const read = json(OWN, 'read.json', {});
const unread = new Map();
for (const [dir, prefix] of [[OWN, ''], ...(DEV ? [[DEV, 'shared:']] : [])]) {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'messages')); } catch { /* no messages yet */ }
  for (const f of names) {
    const peer = f.replace(/\.jsonl$/, '');
    if (!f.endsWith('.jsonl') || !safe(peer)) continue;
    let n = 0;
    try {
      for (const line of fs.readFileSync(path.join(dir, 'messages', f), 'utf8').split('\n')) {
        try { if (JSON.parse(line).dir === 'in') n++; } catch { /* blank or torn line */ }
      }
    } catch { continue; }
    n -= Number(read[prefix + peer]) || 0;
    if (n > 0) unread.set(peer, (unread.get(peer) || 0) + n);
  }
}

// offers and pairing requests are device state (the workspace itself in guest mode)
const STATE = DEV || OWN;
const cutoff = Date.now() - 10 * 60000;
const fresh = (e) => e && new Date(e.created).getTime() >= cutoff;
const offers = new Map();
const list = json(STATE, 'offers.json', []);
for (const o of Array.isArray(list) ? list : []) {
  if (!fresh(o) || !safe(String(o.peer)) || (DEV && o.to && o.to !== info.session)) continue;
  offers.set(o.peer, (offers.get(o.peer) || 0) + 1);
}
const pend = json(STATE, 'pending.json', []);
const pairing = (Array.isArray(pend) ? pend : []).filter((e) => fresh(e) && !e.open).length;

if (!unread.size && !offers.size && !pairing) process.exit(0);

const parts = [];
const rows = [...unread].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
if (rows.length) parts.push(rows.map(([p, n], i) => (i ? `${n} from ${p}` : `${n} unread from ${p}`)).join(', '));
if (offers.size) {
  const total = [...offers.values()].reduce((a, b) => a + b, 0);
  parts.push(`${total} file offer${total > 1 ? 's' : ''} from ${[...offers.keys()].join(', ')}`);
}
if (pairing) parts.push(`${pairing} pairing request${pairing > 1 ? 's' : ''} waiting`);
console.log(`[connect] ${parts.join('; ')}. Read with inbox() / files() / pending() when needed.`);
