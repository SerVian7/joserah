#!/usr/bin/env node
/**
 * jobs.js — the Tracker's hook: the only writer of .joserah/desk/jobs/_agents.json ({agentId: {job, role, state,
 * model, effort, ctx, ctxTime, since, transcript}}), and the checker's trigger when a job file is written.
 *
 *   node hooks/jobs.js <pre-tool-use|post-tool-use|subagent-start|subagent-stop>
 *
 * Pairing is by id, never by text or order: the Agent call names its job as a `job:<slug>` token in its
 * description (or prompt); PreToolUse keeps tool_use_id -> job, PostToolUse finds that id again with the
 * launch's own tool_response.agentId and writes the entry. SubagentStart/Stop only move an entry that exists
 * (a resumed agent returns to work); a start alone never creates a line, and an agent that already finished
 * (foreground, status `completed`) never gets one. A launch with no job match makes no entry and the writer
 * gets one warning line. Sweep on every event: job done, job file gone, or the agent's transcript quiet for
 * QUIET_MS with an end_turn as its last entry -> idle / dropped. A worker's Write of its own report log
 * (desk/crew/<day>/<role>/HHMM-<slug>.md) idles it (queued jobs: the agent keeps running).
 * Silent outside a workspace with a desk/jobs folder; every path exits 0.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { ROLES } = require('../tools/lib/crew-config');
const J = require('../tools/jobs-check');

const EVENTS = ['pre-tool-use', 'post-tool-use', 'subagent-start', 'subagent-stop'];
const QUIET_MS = 10 * 60 * 1000;
const CTX_EVERY_MS = 60 * 1000;
const PENDING_TTL = 60 * 60 * 1000;
const IDLE_KEEP_MS = 24 * 60 * 60 * 1000;
const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const id = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : null);
const roleOf = (type) => (typeof type === 'string' ? type.split(':').pop() : '');
const stateDir = () => process.env.JOSERAH_STATE_DIR || os.tmpdir();

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

// ---- pending launches: tool_use_id -> job, per session, in the state dir -----------------------
const pendingFile = (session) => path.join(stateDir(), `joserah-jobs-pending-${String(session || '-').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}.json`);
function readPending(session) { try { const j = JSON.parse(fs.readFileSync(pendingFile(session), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function writePending(session, list) {
  const t = now().getTime();
  try { fs.writeFileSync(pendingFile(session), JSON.stringify(list.filter((x) => t - x.at < PENDING_TTL))); } catch { /* best effort */ }
}

const jobsDir = (root) => path.join(root, '.joserah', 'desk', 'jobs');
const jobFile = (root, slug) => path.join(jobsDir(root), `${slug}.json`);
const readJob = (root, slug) => { try { return JSON.parse(fs.readFileSync(jobFile(root, slug), 'utf8')); } catch { return null; } };
const agentsPath = (root) => path.join(jobsDir(root), '_agents.json');
function loadAgents(root) {
  try { const j = JSON.parse(fs.readFileSync(agentsPath(root), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}

const launchOf = (ti) => {
  const out = {};
  if (typeof ti.model === 'string' && /^[\w.:[\]-]{1,40}$/.test(ti.model) && ti.model !== 'inherit') out.model = ti.model;
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(ti.effort)) out.effort = ti.effort;
  return out;
};
const tokenOf = (ti) => { const m = /\bjob:([a-z0-9][a-z0-9-]*)/.exec(`${ti.description || ''}\n${ti.prompt || ''}`); return m ? m[1] : null; };

// ---- a worker's own transcript: context size and how it ended ----------------------------------
const CTX_TAIL = 512 * 1024;
function tailOf(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size, mtimeMs } = fs.fstatSync(fd);
    const len = Math.min(size, CTX_TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    if (len < size) lines.shift();
    const out = { mtimeMs, ended: false };
    let first = true;
    for (let i = lines.length - 1; i >= 0; i--) {
      let j; try { j = JSON.parse(lines[i]); } catch { continue; }
      if (first) { out.ended = j.type === 'assistant' && j.message && j.message.stop_reason === 'end_turn'; first = false; }
      const u = j.type === 'assistant' && j.message && j.message.usage;
      if (!u) continue;
      const parts = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens];
      const at = new Date(j.timestamp);
      if (parts.every((n) => Number.isInteger(n) && n >= 0) && Number.isFinite(at.getTime())) { out.ctx = parts[0] + parts[1] + parts[2]; out.ctxTime = hm(at); break; }
    }
    return out;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}
const transcriptOf = (input, agent) => {
  const s = id(input.session_id);
  if (typeof input.agent_transcript_path === 'string' && input.agent_transcript_path) return input.agent_transcript_path;
  return s && typeof input.transcript_path === 'string' && input.transcript_path ? path.join(path.dirname(input.transcript_path), s, 'subagents', `agent-${agent}.jsonl`) : null;
};

const REPORT_LOG = /\.joserah\/desk\/crew\/\d{4}-\d{2}-\d{2}\/([a-z]+)\/\d{4}-[^/]+\.md$/;

function setState(e, state) { if (e.state !== state) { e.state = state; e.since = now().toISOString(); } }

/** Mutates `agents` for this event; returns warning lines for the writer. */
function apply(event, root, input, agents) {
  const warn = [];
  const tool = input.tool_name;
  const agentTool = tool === 'Agent' || tool === 'Task';
  const agent = id(input.agent_id);
  if (event === 'pre-tool-use' && agentTool) {
    const ti = input.tool_input || {};
    const role = roleOf(ti.subagent_type);
    if (ROLES.includes(role) && id(input.session_id) && input.tool_use_id) {
      const list = readPending(input.session_id);
      list.push({ tu: String(input.tool_use_id), role, job: tokenOf(ti), at: now().getTime(), ...launchOf(ti) });
      writePending(input.session_id, list);
    }
  } else if (event === 'post-tool-use' && agentTool) {
    const ti = input.tool_input || {}; const tr = input.tool_response || {};
    const aid = id(tr.agentId); const role = roleOf(ti.subagent_type);
    const list = readPending(input.session_id);
    const p = list.find((x) => x.tu === String(input.tool_use_id || ''));
    if (aid && ROLES.includes(role)) {
      const slug = (p && p.job) || tokenOf(ti);
      if (agents[aid]) { if (tr.status === 'completed') setState(agents[aid], 'idle'); } // the id's one entry only moves
      else if (tr.status !== 'completed') {
        if (slug && readJob(root, slug)) {
          const model = (p && p.model) || launchOf(ti).model || (typeof tr.resolvedModel === 'string' ? tr.resolvedModel : undefined);
          agents[aid] = { job: slug, role, state: 'work', since: now().toISOString(), ...(model ? { model } : {}), ...(p && p.effort ? { effort: p.effort } : {}), ...(transcriptOf(input, aid) ? { transcript: transcriptOf(input, aid) } : {}) };
        } else warn.push(`[jobs] agent ${aid} (${role}) has no job line: put job:<slug> of an existing job file in the Agent call's description.`);
      }
    }
    if (p) writePending(input.session_id, list.filter((x) => x !== p));
  } else if (event === 'subagent-start') {
    if (agent && agents[agent]) setState(agents[agent], 'work');
  } else if (event === 'subagent-stop') {
    if (agent && agents[agent]) {
      setState(agents[agent], 'idle');
      const f = transcriptOf(input, agent); const tail = f && tailOf(f);
      if (tail && tail.ctx !== undefined) { agents[agent].ctx = tail.ctx; agents[agent].ctxTime = tail.ctxTime; }
    }
  } else if (event === 'post-tool-use') {
    const file = input.tool_input && input.tool_input.file_path;
    if (['Write', 'Edit', 'MultiEdit'].includes(tool) && typeof file === 'string') {
      const r = J.afterWrite(root, file, now());
      if (r && r.errors.length) warn.push(`[jobs] ${path.basename(file)}: ${r.errors.join('; ')}`);
      const m = REPORT_LOG.exec(file.replace(/\\/g, '/'));
      if (m && agent && agents[agent] && agents[agent].role === m[1] && roleOf(input.agent_type) === m[1]) setState(agents[agent], 'idle');
    }
    const e = agent && agents[agent];
    if (e && e.state === 'work') { // context size, at most once a minute per agent
      const t = now().getTime();
      if (!(t - (e.ctxRead || 0) < CTX_EVERY_MS && t >= (e.ctxRead || 0))) {
        const f = e.transcript || transcriptOf(input, agent); const tail = f && tailOf(f);
        e.ctxRead = t;
        if (tail && tail.ctx !== undefined) { e.ctx = tail.ctx; e.ctxTime = tail.ctxTime; }
      }
    }
  }
  sweep(root, agents);
  return warn;
}

function sweep(root, agents) {
  const t = now().getTime();
  for (const [aid, e] of Object.entries(agents)) {
    const job = readJob(root, e.job);
    if (!job) { delete agents[aid]; continue; }
    if (e.state === 'idle') { if (t - Date.parse(e.since) > IDLE_KEEP_MS) delete agents[aid]; continue; }
    if (job.state === 'done') { setState(e, 'idle'); continue; }
    const tail = e.transcript && tailOf(e.transcript);
    if (tail && tail.ended && t - tail.mtimeMs > QUIET_MS) setState(e, 'idle');
  }
}

(async () => {
  try {
    const event = process.argv[2];
    if (!EVENTS.includes(event)) return;
    const root = findWorkspace(process.cwd());
    if (!root || !fs.existsSync(jobsDir(root))) return;
    const cfg = readConfig(root) || {};
    if (cfg.dailyTracker === false) return;
    let input;
    try { input = JSON.parse(await readStdin()); } catch { return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const agents = loadAgents(root);
    const before = JSON.stringify(agents);
    const warn = apply(event, root, input, agents);
    if (JSON.stringify(agents) !== before) {
      const f = agentsPath(root);
      fs.writeFileSync(f + '.tmp', JSON.stringify(agents, null, 1) + '\n'); fs.renameSync(f + '.tmp', f);
    }
    if (warn.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event === 'post-tool-use' ? 'PostToolUse' : 'PreToolUse', additionalContext: warn.join(' ') } }));
  } catch { /* a hook must never break a spawn or a session */ }
})().finally(() => process.exit(0));
