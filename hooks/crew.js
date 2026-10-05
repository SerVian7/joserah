#!/usr/bin/env node
/**
 * crew.js — the crew's one payload-reading hook (spec "The Ledger", safety net).
 *
 *   node hooks/crew.js <subagent-start|subagent-stop|pre-compact|session-end|session-start|post-tool-use>
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
 *                   at the stop the hook's own entry, or one tagged with that
 *                   agent's id (`--agent`), is dimmed (idle).
 *   post-tool-use   a worker's tool call (payload with agent_id): its entry's
 *                   context size (`ctx`, `ctxTime`) from its own transcript, at
 *                   most once a minute; SubagentStop writes the final figure.
 *
 * Every path exits 0: a hook that fails must never block a spawn, a compaction
 * or the end of a session. Tests fix the clock with JOSERAH_NOW.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { resolveCrew, ROLES: CREW_ROLES } = require('../tools/lib/crew-config');
const L = require('../tools/lib/ledger');
const DT = require('./lib/daily-tracker');
const { append: appendLine } = require('../tools/ledger');

const EVENTS = ['subagent-start', 'subagent-stop', 'pre-compact', 'session-end', 'session-start', 'post-tool-use', 'pre-tool-use'];

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

/** Today's Daily Tracker folder (hooks/lib/daily-tracker.js), or null. */
const dailyTracker = (root) => DT.dailyTracker(root, isoDay(now()));

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
 * Every crew agent on today's Daily Tracker, by itself (owner, 2026-10-05: "bunu da sık sık yapıyorsun …
 * gerçekten testini yapıp çözmek lazım"). Measured payloads (tests/fixtures/hook-payloads, 2026-10-05):
 * SubagentStart carries agent_id and agent_type but no description; the Agent tool call carries the
 * description — PreToolUse `tool_input.description` before the start, and PostToolUse
 * `tool_response.agentId` with that description (at launch for a background agent, status
 * `async_launched`; at the end for a foreground one, status `completed`) and `resolvedModel`.
 *
 *   pre-tool-use (Agent)   the description waits in a per-session pending list (OS temp dir)
 *   subagent-start         the agent's entry: role from its type, job the oldest waiting description of
 *                          that type (else its agent id), state work, model and effort from its definition
 *   post-tool-use (Agent)  the exact agent id ↔ description: the entry is created if the start has not
 *                          come yet, its job corrected if the start took another one's description
 *   subagent-stop          its entry goes idle
 *
 * An entry is found by its agent id, else by role + job. Each change re-renders the page with tracker.js
 * (no publish). Never for a type that is not a crew role; nothing without a Tracker for today; any error
 * leaves the files alone.
 */
// under JOSERAH_STATE_DIR when set (tests, a dry run), else the OS temp dir: two runs never share a list
const stateDir = () => process.env.JOSERAH_STATE_DIR || require('os').tmpdir();
const pendingFile = (session) => path.join(stateDir(), `joserah-crew-pending-${safe(session || '-')}.json`);
const PENDING_TTL = 60 * 60 * 1000;
function readPending(session) {
  try { const j = JSON.parse(fs.readFileSync(pendingFile(session), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}
function writePending(session, list) {
  const t = now().getTime();
  try { fs.writeFileSync(pendingFile(session), JSON.stringify(list.filter((x) => t - x.at < PENDING_TTL))); } catch { /* best effort */ }
}

/** model and effort from the agent's definition frontmatter (workspace, user, plugin), as written there. */
function agentDefinition(root, type) {
  const name = String(type).split(':').pop();
  if (!/^[\w-]{1,60}$/.test(name)) return {};
  const dirs = [path.join(root, '.claude', 'agents'), path.join(require('os').homedir(), '.claude', 'agents'), path.join(__dirname, '..', 'agents')];
  for (const d of dirs) {
    let text;
    try { text = fs.readFileSync(path.join(d, `${name}.md`), 'utf8'); } catch { continue; }
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return {};
    const field = (k) => ((new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm').exec(m[1]) || [])[1] || '');
    const out = {};
    const model = field('model'); const effort = field('effort');
    if (/^[\w.:[\]-]{1,40}$/.test(model) && model !== 'inherit') out.model = model;
    if (['low', 'medium', 'high'].includes(effort)) out.effort = effort;
    return out;
  }
  return {};
}

/** Reads today's store, lets `change` edit its crew, writes and re-renders when it changed. */
function withCrew(root, change) {
  const dir = dailyTracker(root);
  if (!dir) return;
  const rowsPath = path.join(dir, 'rows.json');
  let raw; let j;
  try { raw = fs.readFileSync(rowsPath, 'utf8'); j = JSON.parse(raw); } catch { return; }
  const store = Array.isArray(j) ? { rows: j, crew: [] } : (j && Array.isArray(j.rows) ? { rows: j.rows, crew: Array.isArray(j.crew) ? j.crew : [] } : null);
  if (!store) return;
  if (!change(store.crew)) return;
  fs.writeFileSync(rowsPath, JSON.stringify({ rows: store.rows, crew: store.crew }, null, 1) + '\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'tracker.js'), dir],
    { encoding: 'utf8', timeout: 8000, env: process.env });
  // a page that does not render keeps its store as it was: the strip is a convenience, never a break
  if (r.status !== 0) fs.writeFileSync(rowsPath, raw);
}

const k = (x) => String(x ?? '').trim().toLowerCase();
const stampNow = (e, state) => {
  const t = now();
  if (e.state !== state || e.sinceState !== state) { e.since = t.toISOString(); e.sinceState = state; }
  e.state = state; e.time = hm(t);
};
function upsertAgent(crew, { role, agent, job, state, model, effort }) {
  let e = crew.find((x) => x && x.agent === agent)
    || crew.find((x) => x && x.role === role && !x.agent && k(x.job) === k(job))
    || crew.find((x) => x && x.role === role && k(x.job) === k(agent));
  if (!e) { e = { role, job }; crew.push(e); }
  e.agent = agent;
  if (job && k(e.job) === k(agent)) e.job = job;
  if (model && !e.model) e.model = model;
  if (effort && !e.effort) e.effort = effort;
  stampNow(e, state);
  return e;
}

function agentToolStart(input) {
  const ti = input.tool_input || {};
  const role = roleOf(ti.subagent_type);
  const desc = typeof ti.description === 'string' ? ti.description.trim() : '';
  if (!CREW_ROLES.includes(role) || !desc || !id(input.session_id)) return;
  const list = readPending(input.session_id);
  list.push({ tu: String(input.tool_use_id || ''), role, desc, at: now().getTime() });
  writePending(input.session_id, list);
}

function agentStarted(root, input) {
  const role = roleOf(input.agent_type);
  const agent = id(input.agent_id);
  if (!CREW_ROLES.includes(role) || !agent || !dailyTracker(root)) return;
  const list = readPending(input.session_id);
  const known = list.find((x) => x.agent === agent);
  const next = known || list.find((x) => x.role === role && !x.agent);
  if (next) { next.agent = agent; writePending(input.session_id, list); }
  const def = agentDefinition(root, input.agent_type);
  withCrew(root, (crew) => { upsertAgent(crew, { role, agent, job: next ? next.desc : agent, state: 'work', ...def }); return true; });
}

function agentToolDone(root, input) {
  const ti = input.tool_input || {};
  const tr = input.tool_response || {};
  const role = roleOf(ti.subagent_type);
  const agent = id(tr.agentId);
  const desc = typeof ti.description === 'string' ? ti.description.trim() : '';
  if (!CREW_ROLES.includes(role) || !agent || !desc || !dailyTracker(root)) return;
  const list = readPending(input.session_id);
  const mine = list.find((x) => x.tu && x.tu === String(input.tool_use_id || '')) || list.find((x) => x.role === role && x.desc === desc && !x.agent);
  // the start took another launch's description: hand that one back to the agent that has its own
  const swapped = list.find((x) => x.agent === agent && x !== mine);
  if (swapped && mine && mine.agent) { const other = mine.agent; mine.agent = agent; swapped.agent = other; } else if (mine) mine.agent = agent;
  writePending(input.session_id, list);
  const def = agentDefinition(root, ti.subagent_type);
  if (!def.model && typeof tr.resolvedModel === 'string') def.model = tr.resolvedModel;
  withCrew(root, (crew) => {
    const e = crew.find((x) => x && x.agent === agent);
    if (e) {
      if (k(e.job) === k(desc)) return false;
      const other = crew.find((x) => x && x !== e && x.role === role && k(x.job) === k(desc));
      if (other) other.job = e.job; // the two swapped at the start
      e.job = desc;
      return true;
    }
    // the start has not come yet (background launch): the entry now, working; a finished foreground
    // agent's entry was already dimmed at its stop
    upsertAgent(crew, { role, agent, job: desc, state: tr.status === 'completed' ? 'idle' : 'work', ...def });
    return true;
  });
}

function agentStopped(root, input) {
  const role = roleOf(input.agent_type);
  const agent = id(input.agent_id);
  if (!CREW_ROLES.includes(role) || !agent || !dailyTracker(root)) return;
  withCrew(root, (crew) => {
    const mine = crew.filter((e) => e && e.role === role && e.state !== 'idle'
      && (e.agent === agent || k(e.job) === k(agent)));
    for (const e of mine) stampNow(e, 'idle');
    return mine.length > 0;
  });
}

// ---- context size (Task 4.6; owner, 2026-10-05: "never an estimate") --------
// Measured 2026-10-05 (spec "Measured payloads"): a worker's own transcript is
// <dir of transcript_path>/<session_id>/subagents/agent-<agent_id>.jsonl — the same
// file SubagentStop names as agent_transcript_path — written live from the worker's
// first tool call, each assistant entry carrying message.usage. The figure is the
// last assistant entry's input + cache read + cache creation tokens, timed by that
// entry's own timestamp. No such entry, no figure: nothing is ever guessed.
const CTX_EVERY_MS = 60 * 1000;
const CTX_TAIL = 512 * 1024;

/** { ctx, ctxTime } from the last assistant entry with full usage in `file`, or null. */
function lastContext(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, CTX_TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift(); // a cut first line is not a line
    for (let i = lines.length - 1; i >= 0; i--) {
      let j;
      try { j = JSON.parse(lines[i]); } catch { continue; }
      const u = j && j.type === 'assistant' && j.message && j.message.usage;
      if (!u) continue;
      const parts = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens];
      if (!parts.every((n) => Number.isInteger(n) && n >= 0)) continue;
      const at = new Date(j.timestamp);
      if (!Number.isFinite(at.getTime())) continue;
      return { ctx: parts[0] + parts[1] + parts[2], ctxTime: hm(at) };
    }
  } catch { /* no transcript yet */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
  return null;
}

/** The worker's own transcript: SubagentStop names it; otherwise derived as measured. */
function agentTranscript(input, agent) {
  if (typeof input.agent_transcript_path === 'string' && input.agent_transcript_path) return input.agent_transcript_path;
  const session = id(input.session_id);
  if (!session || typeof input.transcript_path !== 'string' || !input.transcript_path) return null;
  return path.join(path.dirname(input.transcript_path), session, 'subagents', `agent-${agent}.jsonl`);
}

// Throttle stamp, one small file per session + agent in the OS temp dir, like tool-count.js.
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
const ctxStampFile = (session, agent) => path.join(require('os').tmpdir(), `joserah-crew-ctx-${safe(session)}-${safe(agent)}`);

/**
 * Sets `ctx` / `ctxTime` on this agent's Crew strip entry on today's Daily
 * Tracker: the one tagged with `--agent <id>` first, else the one the safety
 * net wrote (role + job = agent id); no other entry. A worker's PostToolUse
 * reads at most once a minute per agent (`force` at its stop). A local
 * rows.json write: no re-render, no publish.
 */
function recordContext(root, input, force) {
  const role = roleOf(input.agent_type);
  const agent = id(input.agent_id);
  if (!CREW_ROLES.includes(role) || !agent) return;
  const stampFile = ctxStampFile(input.session_id || '-', agent);
  const t = now().getTime();
  if (!force) {
    let last = NaN;
    try { last = Number(fs.readFileSync(stampFile, 'utf8')); } catch { /* first read */ }
    if (Number.isFinite(last) && t - last < CTX_EVERY_MS && t >= last) return;
  }
  const dir = dailyTracker(root);
  if (!dir) return;
  const file = agentTranscript(input, agent);
  if (!file) return;
  try { fs.writeFileSync(stampFile, String(t), 'utf8'); } catch { /* throttle is best effort */ }
  const fig = lastContext(file);
  if (!fig) return;
  const rowsPath = path.join(dir, 'rows.json');
  let j;
  try { j = JSON.parse(fs.readFileSync(rowsPath, 'utf8')); } catch { return; }
  if (!j || Array.isArray(j) || !Array.isArray(j.crew)) return; // no crew entry yet, so not this agent's
  const e = j.crew.find((x) => x && x.role === role && x.agent === agent)
    || j.crew.find((x) => x && x.role === role && String(x.job).trim().toLowerCase() === agent.toLowerCase());
  if (!e || (e.ctx === fig.ctx && e.ctxTime === fig.ctxTime)) return;
  e.ctx = fig.ctx;
  e.ctxTime = fig.ctxTime;
  fs.writeFileSync(rowsPath, JSON.stringify(j, null, 1) + '\n');
}

function handle(event, root, input) {
  if (event === 'session-start') return reinject(root, input);
  const agentTool = input.tool_name === 'Agent' || input.tool_name === 'Task';
  if (event === 'pre-tool-use') { if (agentTool) agentToolStart(input); return null; }
  if (event === 'subagent-start') { try { agentStarted(root, input); } catch { /* the strip is a convenience */ } }
  if (event === 'subagent-stop') { try { agentStopped(root, input); } catch { /* idem */ } recordContext(root, input, true); }
  // a worker's tool call (its payload carries agent_id, measured); the main thread's has none
  if (event === 'post-tool-use') {
    if (agentTool) { try { agentToolDone(root, input); } catch { /* idem */ } }
    if (input.agent_id) recordContext(root, input, false);
    return null;
  }
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
