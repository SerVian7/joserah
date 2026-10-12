#!/usr/bin/env node
/**
 * crew.js — Lead's Ledger hook (spec "The Ledger"). The Tracker's agent state is hooks/jobs.js.
 *
 *   node hooks/crew.js <subagent-start|pre-compact|session-end|session-start>
 *
 * The event comes from argv (a closed set); the payload from stdin (idle-timer read, stdin is not always closed
 * on Windows). Silent outside a Joserah workspace and when `crew` is off. An empty, broken or non-object
 * payload writes nothing and prints nothing.
 *
 *   subagent-start  agent type `lead` (or `<plugin>:lead`): creates .joserah/desk/crew/<YYYY-MM-DD>/lead/ledger-<HHMM>.md
 *                   with its `open` line (session id, Lead's agent id) and tells Lead the path through
 *                   additionalContext. A Lead already open in this session under the same agent id keeps its Ledger.
 *   pre-compact     a `compact` stamp (trigger, transcript_path) on the Ledger
 *   session-end     a `session-end` stamp (reason, transcript_path); both go only to the Ledger whose `open` line
 *                   names this session, today's or yesterday's, and to nothing when none does.
 *   session-start   source `compact` only: re-injects this session's Ledger (open jobs, owner lines, last decisions,
 *                   Lead's agent id) and, for the main session, the Tracker's open job files.
 *
 * Every path exits 0: a hook that fails must never block a spawn, a compaction or the end of a session.
 * Tests fix the clock with JOSERAH_NOW.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { resolveCrew } = require('../tools/lib/crew-config');
const L = require('../tools/lib/ledger');
const { append: appendLine } = require('../tools/ledger');

const EVENTS = ['subagent-start', 'pre-compact', 'session-end', 'session-start'];

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

/**
 * This session's Ledger: today's, else yesterday's (a session crossing
 * midnight). Matched on the `open` line's session id only, never the newest
 * of the day as a fallback: a stamp must not land in another conversation's.
 */
function sessionLedger(root, session) {
  if (!session) return null;
  const t = now();
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  return L.findLedger(root, isoDay(t), session) || L.findLedger(root, isoDay(y), session);
}

/** PreCompact / SessionEnd: one stamp line, nothing to context (the runtime gives them no way). */
function stamp(root, input, kind, detail) {
  const file = sessionLedger(root, id(input.session_id));
  if (!file) return null;
  const transcript = typeof input.transcript_path === 'string' && input.transcript_path.trim()
    ? input.transcript_path.trim() : '-';
  try {
    appendLine(file, { kind, job: '-', text: typeof detail === 'string' ? detail : '-', path: transcript });
  } catch {
    appendLine(file, { kind, job: '-', text: typeof detail === 'string' ? detail : '-', path: '-' });
  }
  return null;
}

const MAX_CONTEXT = 2000;


/**
 * SessionStart `compact`: what the compaction dropped comes back from the
 * files — this session's Ledger (open jobs, owner-waiting lines, last
 * decisions, Lead's agent id) and, for the main session, the Tracker's
 * open job files. A subagent compacting (its payload carries `agent_id`) gets the
 * Ledger only. Under MAX_CONTEXT characters.
 */
function reinject(root, input) {
  if (input.source !== 'compact') return null;
  const parts = [];
  const file = sessionLedger(root, id(input.session_id));
  if (file) {
    const o = L.openItems(fs.readFileSync(file, 'utf8'));
    const item = (j) => `${j.job} (${j.text}${j.path !== '-' ? `, ${j.path}` : ''})`;
    const open = o.jobs.filter((j) => j.kind === 'start').map(item);
    const owner = o.jobs.filter((j) => j.kind === 'owner').map(item);
    parts.push(`Lead ${o.agentId || '-'} (Ledger ${rel(root, file)})`);
    parts.push(`open: ${open.join(', ') || 'none'}`);
    parts.push(`owner: ${owner.join(', ') || 'none'}`);
    parts.push(`decisions: ${o.decisions.map((d) => d.text).join(', ') || 'none'}`);
  }
  if (!input.agent_id) {
    const dir = path.join(root, '.joserah', 'desk', 'jobs');
    let open = [];
    try { open = fs.readdirSync(dir).filter((n) => /^[^_.].*.json$/.test(n)).map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { return null; } }).filter((j) => j && j.state && j.state !== 'done'); } catch { /* no jobs folder */ }
    if (open.length) parts.push(`Tracker open jobs: ${open.map((j) => `${j.title} [${j.state}]`).join(', ')}`);
  }
  if (!parts.length) return null;
  let text = `[crew] After compaction — ${parts.join('; ')}`;
  if (text.length > MAX_CONTEXT) text = text.slice(0, MAX_CONTEXT - 1) + '…';
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

// Lead's Ledger only (config `crew`). The Tracker's agent state is hooks/jobs.js.
function handle(event, root, input) {
  if (event === 'session-start') return reinject(root, input);
  if (event === 'subagent-start' && roleOf(input.agent_type) === 'lead') return leadStarted(root, input);
  // PreCompact carries `trigger`, SessionEnd `reason` (measured 2026-10-05). SessionEnd
  // may not fire at all when a background shell is still running: best effort only.
  if (event === 'pre-compact') return stamp(root, input, 'compact', input.trigger);
  if (event === 'session-end') return stamp(root, input, 'session-end', input.reason);
  return null;
}

(async () => {
  try {
    const event = process.argv[2];
    if (!EVENTS.includes(event)) return;
    const root = findWorkspace(process.cwd());
    if (!root) return;
    let ledger = false;
    try { ledger = resolveCrew(readConfig(root) || {}).enabled; } catch { /* a crew block the generator would refuse: no Ledger */ }
    if (!ledger) return;
    let input;
    try { input = JSON.parse(await readStdin()); } catch { return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const out = handle(event, root, input);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch { /* never break a spawn, a compaction or a session end */ }
})().finally(() => process.exit(0));
