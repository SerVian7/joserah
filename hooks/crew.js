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
 *   pre-compact     a `compact` stamp (trigger, transcript_path) on the Ledger
 *   session-end     a `session-end` stamp (reason, transcript_path); both go
 *                   only to the Ledger whose `open` line names this session,
 *                   today's or yesterday's, and to nothing when none does.
 *   session-start   source `compact` only: re-injects this session's Ledger
 *                   (open jobs, owner lines, last decisions, Lead's agent id)
 *                   and, for the main session, the Daily Tracker's open rows.
 *   subagent-start / subagent-stop  the Crew strip's safety net: a crew role
 *                   with no entry on today's Daily Tracker gets one (work), and
 *                   the hook's own entry is dimmed (idle) at the stop.
 *
 * Every path exits 0: a hook that fails must never block a spawn, a compaction
 * or the end of a session. Tests fix the clock with JOSERAH_NOW.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { resolveCrew, ROLES: CREW_ROLES } = require('../tools/lib/crew-config');
const L = require('../tools/lib/ledger');
const { append: appendLine } = require('../tools/ledger');

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
 * Today's Daily Tracker folder: desk/artifacts/<today>/daily-tracker, else the
 * first folder of the day whose index.html says "Daily Tracker" (the test
 * session-brief.js uses for the new-day line). Null when there is none.
 */
function dailyTracker(root) {
  const base = path.join(root, '.joserah', 'desk', 'artifacts', isoDay(now()));
  let subs;
  try { subs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return null; }
  if (subs.includes('daily-tracker')) subs = ['daily-tracker', ...subs.filter((n) => n !== 'daily-tracker')];
  for (const n of subs) {
    const d = path.join(base, n);
    try {
      if (!fs.existsSync(path.join(d, 'rows.json'))) continue;
      if (/Daily Tracker/.test(fs.readFileSync(path.join(d, 'index.html'), 'utf8'))) return d;
    } catch { /* not a page */ }
  }
  return null;
}

/** The Tracker's rows, from either rows.json shape (array, or { rows, crew }). */
function trackerRows(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
    const rows = Array.isArray(j) ? j : (j && Array.isArray(j.rows) ? j.rows : []);
    return rows.filter((r) => r && typeof r.title === 'string');
  } catch { return []; }
}

/**
 * SessionStart `compact`: what the compaction dropped comes back from the
 * files — this session's Ledger (open jobs, owner-waiting lines, last
 * decisions, Lead's agent id) and, for the main session, the Daily Tracker's
 * open rows. A subagent compacting (its payload carries `agent_id`) gets the
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
    const dir = dailyTracker(root);
    const rows = dir ? trackerRows(dir).filter((r) => r.state !== 'ok') : [];
    if (rows.length) parts.push(`Tracker open rows: ${rows.map((r) => `${r.title} [${r.state}]`).join(', ')}`);
  }
  if (!parts.length) return null;
  let text = `[crew] After compaction — ${parts.join('; ')}`;
  if (text.length > MAX_CONTEXT) text = text.slice(0, MAX_CONTEXT - 1) + '…';
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

/**
 * The Crew strip's safety net (spec "Tracker Crew strip", Mechanics): a crew
 * worker with no entry for its role on today's Daily Tracker gets one at start,
 * `{ role, job: <agent_id>, state: work }`, dimmed to `idle` at its stop. An
 * entry Lead already wrote for the role is left as is; the hook writes only
 * what the payload carries (agent type and id), never for a type that is not a
 * crew role, and never publishes. Any refusal or error leaves the file alone.
 */
function stripSafetyNet(root, input, starting) {
  const role = roleOf(input.agent_type);
  const agent = id(input.agent_id);
  if (!CREW_ROLES.includes(role) || !agent) return;
  const dir = dailyTracker(root);
  if (!dir) return;
  try {
    const tracker = require('../tools/tracker');
    const crew = tracker.readCrew(dir);
    const mine = crew.find((e) => e && e.role === role && String(e.job).trim().toLowerCase() === agent.toLowerCase());
    if (starting) {
      if (crew.some((e) => e && e.role === role)) return;
      tracker.upsertCrew(dir, { role, job: agent, state: 'work' });
    } else if (mine && mine.state !== 'idle') {
      tracker.upsertCrew(dir, { role, job: agent, state: 'idle' });
    }
  } catch { /* the strip is a convenience; the spawn and the stop go on */ }
}

function handle(event, root, input) {
  if (event === 'session-start') return reinject(root, input);
  if (event === 'subagent-start' || event === 'subagent-stop') stripSafetyNet(root, input, event === 'subagent-start');
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
