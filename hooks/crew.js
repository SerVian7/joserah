#!/usr/bin/env node
/**
 * crew.js — the crew's one payload-reading hook (spec "The Ledger", safety net).
 *
 *   node hooks/crew.js <subagent-start|subagent-stop|pre-compact|session-end|session-start>
 *
 * The event comes from argv (a closed set); the payload from stdin, read with
 * the idle-timer read of tool-count.js, because stdin is not always closed on
 * Windows. Silent outside a Joserah workspace, with the crew off, or with a
 * `crew` block the generator would refuse (doctor reports that one). An empty,
 * broken or non-object payload writes nothing and prints nothing.
 *
 *   subagent-start  agent type `lead` (or `<plugin>:lead`): creates
 *                   .joserah/desk/crew/<YYYY-MM-DD>/lead/ledger-<HHMM>.md with
 *                   its `open` line (session id, Lead's agent id) and tells
 *                   Lead the path through additionalContext. A Lead already
 *                   open in this session under the same agent id keeps its
 *                   Ledger.
 *
 * Every path exits 0: a hook that fails must never block a spawn, a compaction
 * or the end of a session. Tests fix the clock with JOSERAH_NOW.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { resolveCrew } = require('../tools/lib/crew-config');
const L = require('../tools/lib/ledger');

const EVENTS = ['subagent-start', 'subagent-stop', 'pre-compact', 'session-end', 'session-start'];

const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const id = (v) => (typeof v === 'string' && /^[^\s·]+$/.test(v) ? v : null);

// The agent type as the generator names it; a plugin-namespaced one counts too.
// An empty type (compaction's summariser, measured 2026-10-05) is no role.
const roleOf = (type) => (typeof type === 'string' ? type.split(':').pop() : '');

// Same idle-timer read as the other hooks: stdin is not always closed.
function readStdin(idleMs = 1000) {
  return new Promise((resolve) => {
    let raw = '';
    let timer = setTimeout(() => resolve(raw), idleMs);
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => resolve(raw), idleMs); };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; arm(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(raw); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

/** Lead opened: its Ledger, created once, and its path for Lead. */
function leadStarted(root, input) {
  const session = id(input.session_id);
  const agent = id(input.agent_id);
  if (!session || !agent) return null;
  const t = now();
  const dir = path.join(root, '.joserah', 'desk', 'crew', isoDay(t), 'lead');
  let file = L.findLedger(root, isoDay(t), session);
  if (!file || L.openItems(fs.readFileSync(file, 'utf8')).agentId !== agent) {
    fs.mkdirSync(dir, { recursive: true });
    const stem = `ledger-${hm(t).replace(':', '')}`;
    file = path.join(dir, `${stem}.md`);
    // a second Lead in the same minute: ledger-HHMMb.md, which sorts after the first
    for (let c = 98; fs.existsSync(file) && c <= 122; c++) file = path.join(dir, `${stem}${String.fromCharCode(c)}.md`);
    const line = L.formatLine({ time: hm(t), kind: 'open', job: 'lead', text: `session ${session} agent ${agent}`, path: '-' });
    fs.writeFileSync(file, line + '\n', { encoding: 'utf8', flag: 'wx' });
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: `Your Ledger: ${rel(root, file)}`,
    },
  };
}

function handle(event, root, input) {
  if (event === 'subagent-start' && roleOf(input.agent_type) === 'lead') return leadStarted(root, input);
  return null;
}

(async () => {
  try {
    const event = process.argv[2];
    if (!EVENTS.includes(event)) return;
    const root = findWorkspace(process.cwd());
    if (!root) return;
    let crew;
    try { crew = resolveCrew(readConfig(root) || {}); } catch { return; }
    if (!crew.enabled) return;
    let input;
    try { input = JSON.parse(await readStdin()); } catch { return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const out = handle(event, root, input);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch { /* never break a spawn, a compaction or a session end */ }
})().finally(() => process.exit(0));
