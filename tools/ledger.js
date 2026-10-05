#!/usr/bin/env node
/**
 * ledger.js — Lead's Ledger, appended one line at a time (lib/ledger.js).
 *
 *   node ledger.js add <ledger> <kind> <job> <text> [path]
 *   node ledger.js open <ledger>
 *   node ledger.js stamp <ledger> <compact|session-end> <detail> <transcript_path>
 *
 * `add` appends one line, never rewriting the file; the time is now, or
 * JOSERAH_NOW=<ISO timestamp>. The Ledger must already exist (the
 * SubagentStart hook creates it), so a mistyped path makes no stray file.
 * `open` prints Lead's agent id, then each open job (last line `start` or
 * `owner`) and the last decisions, one Ledger line each. `stamp` is the
 * hooks' entry: a `compact` or `session-end` line with no job.
 *
 * Exit 0 on success; 1 on bad arguments, an unknown kind or a missing Ledger,
 * with the reason on stderr and the file untouched.
 */
'use strict';
const fs = require('fs');
const L = require('./lib/ledger');

const now = () => (process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date());
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const STAMPS = ['compact', 'session-end'];
const USAGE = 'usage: ledger.js add <ledger> <kind> <job> <text> [path] | open <ledger> | stamp <ledger> <compact|session-end> <detail> <transcript_path>';

function append(file, entry) {
  if (!fs.existsSync(file)) throw new Error(`ledger.js: no Ledger at ${file}`);
  const line = L.formatLine({ time: hm(now()), ...entry });
  const text = fs.readFileSync(file, 'utf8');
  const lead = text.length && !text.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, lead + line + '\n', 'utf8');
}

function open(file) {
  const o = L.openItems(fs.readFileSync(file, 'utf8'));
  const out = [`lead · agent ${o.agentId || '-'} · session ${o.sessionId || '-'}`];
  if (!o.jobs.length) out.push('no open jobs');
  for (const j of o.jobs) out.push(L.formatLine(j));
  for (const d of o.decisions) out.push(L.formatLine(d));
  return out.join('\n') + '\n';
}

function main([cmd, file, ...rest]) {
  if (!file) throw new Error(USAGE);
  if (cmd === 'add') {
    const [kind, job, text, p] = rest;
    if (rest.length < 3) throw new Error(USAGE);
    append(file, { kind, job, text, path: p });
  } else if (cmd === 'stamp') {
    const [kind, detail, transcript] = rest;
    if (!STAMPS.includes(kind)) throw new Error(`ledger.js: stamp takes compact or session-end, not "${kind}"`);
    append(file, { kind, job: '-', text: detail, path: transcript });
  } else if (cmd === 'open') {
    if (!fs.existsSync(file)) throw new Error(`ledger.js: no Ledger at ${file}`);
    process.stdout.write(open(file));
  } else {
    throw new Error(USAGE);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { open, append };
