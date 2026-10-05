#!/usr/bin/env node
/**
 * tracker-guard.js — the main session's turn cannot end while the owner's Daily Tracker is out of date
 * or the answer lives only in chat (owner, 2026-10-05: "bunu da sık sık yapıyorsun iki konuda kızdım
 * ciddiye alıp gerçekten testini yapıp çözmek lazım bu iki sorunu"; rules alone had failed).
 *
 *   node hooks/tracker-guard.js post-tool-use   (PostToolUse, matcher Artifact)
 *       A publish of today's Tracker page (tool_input.file_path is its index.html; no asset upload, no
 *       other action) records the page's hash, the "updated" stamp left out, in the state dir.
 *   node hooks/tracker-guard.js stop            (Stop)
 *       Blocks the turn's end ({"decision":"block","reason":…}, one line, reasons joined " · ") when
 *       A2  today's Tracker page differs from its last recorded publish (or was never published),
 *       B1  an owner row waits on a decision without options, recommend and why — the updater's own
 *           check (tracker.js checkDecisions), and an owner row whose title is a question ("…?") counts
 *           as a decision,
 *       B2  the reply (the payload's last_assistant_message) is a deliverable — a fenced block of 4 or
 *           more lines, or more than 15 non-empty lines — with no claude.ai artifact link in it.
 *       A2 and B1 only when a Tracker for today exists and `dailyTracker` is not false.
 *       `"artifacts": false` in config.json (owner, 2026-10-05: stop publishing pages automatically, keep the
 *       files as Markdown): A2 is skipped, and B2 is met by a reply naming a local .md file, not a page link.
 *
 * Payload fields used, all measured 2026-10-05 (tests/fixtures/hook-payloads): Stop — hook_event_name,
 * session_id, cwd, stop_hook_active, last_assistant_message (no agent_id: a subagent fires SubagentStop
 * instead, so a payload with agent_id is never held); PostToolUse — tool_name, tool_input, cwd. The
 * Artifact tool's own payload was not captured (print mode has no Artifact tool): its tool_name and
 * tool_input.file_path are the names the tool and the transcript use (hooks/report-fresh.js reads the same).
 *
 * No loop: a reason is blocked on once per turn — while the hook holds the turn (stop_hook_active) a
 * reason already blocked on is not raised again; a new one is, once. No model call, no transcript read.
 * Silent outside a workspace and on any error (fail-open). State: JOSERAH_STATE_DIR, else the OS temp dir.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { dailyTracker } = require('./lib/daily-tracker');

const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stateDir = () => process.env.JOSERAH_STATE_DIR || os.tmpdir();
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const FENCE_MIN = 4;
const LINES_MAX = 15;
const PAGE_LINK = /https:\/\/claude\.ai\/(?:code\/)?artifact\//;
// a local Markdown file named in the reply: a path or bare file name ending in .md, never a URL
const MD_FILE = /(?<![\w:/.-])(?:[A-Za-z]:[\\/])?[^\s`"'()<>[\]|*?:]*[^\s`"'()<>[\]|*?:\\/]\.md(?![\w-])/;

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

// the page as published: the "updated" stamp moves on every render and says nothing new
const pageHash = (file) => sha(fs.readFileSync(file, 'utf8').replace(/data-t="[^"]*"/g, 'data-t=""'));
const recordFile = (page) => path.join(stateDir(), `joserah-published-${sha(path.resolve(page).toLowerCase()).slice(0, 16)}.json`);

function tracker(root) {
  const cfg = readConfig(root) || {};
  if (cfg.dailyTracker === false) return null;
  return dailyTracker(root, isoDay(now()));
}

function recordPublish(input) {
  if (input.tool_name !== 'Artifact') return;
  const ti = input.tool_input || {};
  if (ti.asset || (ti.action && ti.action !== 'publish') || typeof ti.file_path !== 'string' || !ti.file_path) return;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const root = findWorkspace(cwd);
  const dir = root && tracker(root);
  if (!dir) return;
  const page = path.join(dir, 'index.html');
  if (!same(path.resolve(cwd, ti.file_path), page)) return;
  fs.writeFileSync(recordFile(page), JSON.stringify({ hash: pageHash(page), at: now().toISOString() }));
}

function staleTracker(dir) {
  const page = path.join(dir, 'index.html');
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(recordFile(page), 'utf8')); } catch { /* never published */ }
  return !rec || rec.hash !== pageHash(page);
}

function undecided(dir) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')); } catch { return []; }
  const rows = Array.isArray(j) ? j : (j && Array.isArray(j.rows) ? j.rows : []);
  const crew = j && !Array.isArray(j) && Array.isArray(j.crew) ? j.crew : [];
  const { checkDecisions } = require('../tools/tracker.js');
  const out = [];
  for (const r of rows) {
    if (!r || r.state !== 'you' || typeof r.title !== 'string') continue;
    const asked = r.title.trim().endsWith('?') ? [{ state: 'owner', reason: 'decision', row: r.title }] : [];
    try { checkDecisions([r], [...crew, ...asked]); } catch { out.push(r.title.trim()); }
  }
  return out;
}

function deliverable(text, { artifacts = true } = {}) {
  if (typeof text !== 'string' || !text.trim() || (artifacts ? PAGE_LINK : MD_FILE).test(text)) return false;
  let inFence = false; let fenced = 0; let most = 0;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { if (inFence) { most = Math.max(most, fenced); fenced = 0; } inFence = !inFence; continue; }
    if (inFence && line.trim()) fenced++;
  }
  most = Math.max(most, fenced);
  return most >= FENCE_MIN || text.split('\n').filter((l) => l.trim()).length > LINES_MAX;
}

function guard(input) {
  if (input.hook_event_name !== 'Stop' || typeof input.session_id !== 'string' || input.agent_id) return null;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const root = findWorkspace(cwd);
  if (!root) return null;
  const reasons = [];
  const dir = tracker(root);
  const artifacts = (readConfig(root) || {}).artifacts !== false;
  if (dir) {
    try { if (artifacts && staleTracker(dir)) reasons.push({ key: 'a2', text: 'Daily Tracker changed since its last publish: publish it (Artifact, the same file) before ending the turn' }); } catch { /* fail-open */ }
    try {
      for (const t of undecided(dir)) reasons.push({ key: `b1:${t.toLowerCase()}`, text: `owner row "${t}" waits on a decision without options, recommend and why: add them (tracker.js row --option/--recommend/--why), never invented — ask whoever knows them` });
    } catch { /* fail-open */ }
  }
  if (deliverable(input.last_assistant_message, { artifacts })) {
    reasons.push({ key: 'b2', text: artifacts ? 'deliverable must be a page: publish it as an artifact and reply with one line and its link' : 'deliverable must be saved as a Markdown file: write it and name the file in one line' });
  }

  const held = input.stop_hook_active === true;
  const file = path.join(stateDir(), `joserah-guard-${safe(input.session_id)}.json`);
  let prior = [];
  if (held) { try { prior = JSON.parse(fs.readFileSync(file, 'utf8')).keys || []; } catch { prior = []; } }
  const fresh = reasons.filter((r) => !prior.includes(r.key));
  if (!fresh.length) { if (!held) { try { fs.rmSync(file, { force: true }); } catch { /* gone */ } } return null; }
  fs.writeFileSync(file, JSON.stringify({ keys: [...prior, ...fresh.map((r) => r.key)] }));
  return { decision: 'block', reason: fresh.map((r) => r.text).join(' · ') };
}

if (require.main === module) {
  (async () => {
    try {
      const event = process.argv[2];
      if (event !== 'stop' && event !== 'post-tool-use') return;
      let input;
      try { input = JSON.parse(await readStdin()); } catch { return; }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return;
      if (event === 'post-tool-use') { recordPublish(input); return; }
      const out = guard(input);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch { /* fail-open: a guard that breaks never holds a turn */ }
  })().finally(() => process.exit(0));
}

module.exports = { deliverable, guard, recordPublish, FENCE_MIN, LINES_MAX };
