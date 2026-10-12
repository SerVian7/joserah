#!/usr/bin/env node
/**
 * tracker-guard.js — the main session's turn cannot end with a deliverable that lives only in chat (owner,
 * 2026-10-05: "bunu da sık sık yapıyorsun"; rules alone had failed). Stop hook:
 *   a reply (the payload's last_assistant_message) that is a deliverable — a fenced block of 4 or more lines,
 *   or more than 15 non-empty lines — with no claude.ai artifact link in it is blocked once
 *   ({"decision":"block","reason":…}). `"artifacts": false` in config.json: met by a reply naming a local .md file.
 * The Tracker's own checks moved out on 2026-10-13: the page is live (no publish to hold the turn for) and
 * tools/jobs-check.js refuses a decision job without options. Never held: a subagent (payload with agent_id).
 * No loop: a reason is blocked on once per turn. No model call, no transcript read. Silent outside a
 * workspace and on any error (fail-open). State: JOSERAH_STATE_DIR, else the OS temp dir.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');

const stateDir = () => process.env.JOSERAH_STATE_DIR || os.tmpdir();
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

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
  const artifacts = (readConfig(root) || {}).artifacts !== false;
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
      if (event !== 'stop') return;
      let input;
      try { input = JSON.parse(await readStdin()); } catch { return; }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return;
      const out = guard(input);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch { /* fail-open: a guard that breaks never holds a turn */ }
  })().finally(() => process.exit(0));
}

module.exports = { deliverable, guard, FENCE_MIN, LINES_MAX };
