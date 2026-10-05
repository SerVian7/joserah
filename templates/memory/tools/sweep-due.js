#!/usr/bin/env node
/**
 * sweep-due.js — is the shared record behind its inbox?
 * Usage: node tools/sweep-due.js [--json] [--stamp]
 *   (no flag)  prints one line when a sweep is due, nothing otherwise; exit 0
 *   --json     prints { days, inbox, due, sweeper }
 *   --stamp    records now as lastSweep in .memory/config.json (the sweeper, after a sweep)
 *
 * Due: the inbox holds 5 or more files, or it holds any and a week has passed since the last sweep
 * (or there never was one) — whichever comes first. Under continuous recording (config "recording":
 * "continuous", RECORDING.md) there is no sweep: any inbox note is due, as a note waiting for ingest.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DUE_AFTER_DAYS = 7;
const DUE_INBOX_FILES = 5;
const cfgPath = (root) => path.join(root, '.memory', 'config.json');
const readCfg = (root) => JSON.parse(fs.readFileSync(cfgPath(root), 'utf8').replace(/^﻿/, ''));

function sweepState(root, now = new Date()) {
  const cfg = readCfg(root);
  let inbox = 0;
  try { inbox = fs.readdirSync(path.join(root, 'inbox')).filter((f) => f.endsWith('.md')).length; } catch { /* no inbox */ }
  const last = cfg.lastSweep ? new Date(cfg.lastSweep) : null;
  const days = last && !isNaN(last) ? Math.floor((now - last) / 86400000) : null;
  if (cfg.recording === 'continuous') return { days, inbox, sweeper: cfg.sweeper || null, continuous: true, byInbox: false, byDays: false, due: inbox > 0 };
  return { days, inbox, sweeper: cfg.sweeper || null, byInbox: inbox >= DUE_INBOX_FILES, byDays: inbox > 0 && (days === null || days >= DUE_AFTER_DAYS),
    due: inbox >= DUE_INBOX_FILES || (inbox > 0 && (days === null || days >= DUE_AFTER_DAYS)) };
}

function sweepLine(s) {
  if (!s.due) return '';
  if (s.continuous) return s.inbox === 1 ? `inbox: 1 note waiting for ingest — ${s.sweeper} or any member ingests it.`
    : `inbox: ${s.inbox} notes waiting for ingest — ${s.sweeper} or any member ingests them.`;
  const why = [s.byInbox && `${s.inbox} inbox files`, s.byDays && (s.days === null ? 'never swept' : `${s.days} days`)].filter(Boolean);
  return `sweep due: ${why.join(', ')} — the sweeper (${s.sweeper}) runs it.`;
}

module.exports = { sweepState, sweepLine, DUE_AFTER_DAYS, DUE_INBOX_FILES };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  if (args.includes('--stamp')) {
    const cfg = readCfg(root);
    cfg.lastSweep = new Date().toISOString();
    fs.writeFileSync(cfgPath(root), JSON.stringify(cfg, null, 2) + '\n');
    console.log(`lastSweep ${cfg.lastSweep}`);
  } else if (args.includes('--json')) {
    console.log(JSON.stringify(sweepState(root)));
  } else {
    const line = sweepLine(sweepState(root));
    if (line) console.log(line);
  }
}
