#!/usr/bin/env node
/**
 * sweep-due.js — is the shared record behind its inbox?
 * Usage: node tools/sweep-due.js [--json] [--stamp]
 *   (no flag)  prints one line when a sweep is due, nothing otherwise; exit 0
 *   --json     prints { days, inbox, due, sweeper }
 *   --stamp    records now as lastSweep in .memory/config.json (the sweeper, after a sweep)
 *
 * Due: the inbox holds a note, and there has been no sweep for a week or ever.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DUE_AFTER_DAYS = 7;
const cfgPath = (root) => path.join(root, '.memory', 'config.json');
const readCfg = (root) => JSON.parse(fs.readFileSync(cfgPath(root), 'utf8').replace(/^﻿/, ''));

function sweepState(root, now = new Date()) {
  const cfg = readCfg(root);
  let inbox = 0;
  try { inbox = fs.readdirSync(path.join(root, 'inbox')).filter((f) => f.endsWith('.md')).length; } catch { /* no inbox */ }
  const last = cfg.lastSweep ? new Date(cfg.lastSweep) : null;
  const days = last && !isNaN(last) ? Math.floor((now - last) / 86400000) : null;
  return { days, inbox, sweeper: cfg.sweeper || null, due: inbox > 0 && (days === null || days >= DUE_AFTER_DAYS) };
}

function sweepLine(s) {
  if (!s.due) return '';
  const since = s.days === null ? 'never swept' : `${s.days} days since last sweep`;
  return `Sweep due: ${since}, ${s.inbox} inbox file(s) — the sweeper (${s.sweeper}) runs it.`;
}

module.exports = { sweepState, sweepLine, DUE_AFTER_DAYS };

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
