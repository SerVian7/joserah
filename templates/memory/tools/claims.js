#!/usr/bin/env node
/**
 * claims.js — are the typed claim lines in this memory well formed?
 * Usage: node tools/claims.js                 exit 0 ok · 1 malformed lines listed
 *        node tools/claims.js --count <file…> prints how many claim lines those files hold
 *
 * Claim line: `- [measurement|calculation|decision|estimate] subject -> value`, then
 * indented `condition:` `date:` `by:` `source:` `superseded:` fields. Node built-ins only;
 * scans knowledge/, members/, inbox/, questions/, desk/.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['knowledge', 'members', 'inbox', 'questions', 'desk'];
const SOURCES = 'knowledge/sources'; // archived verbatim: never claim-checked
const TYPES = ['measurement', 'calculation', 'decision', 'estimate'];
const CLAIM_RE = /^(\s*)-\s+\[(measurement|calculation|decision|estimate)\]\s+(.+?)\s*$/;
const NEAR_RE = /^(\s*)-\s+\[([A-Za-z][A-Za-z0-9_-]*)\]\s+(.+?)\s*$/;
const FIELD_RE = /^(\s+)(condition|date|by|source|superseded):\s*(.*)$/;
const SPLIT_RE = /\s+·\s+(?=(?:condition|date|by|source|superseded):)/;
const KEY_IN_VALUE_RE = /(?:^|[\s·])(condition|date|by|source|superseded):(?:\s|$)/;
const BREAK_RE = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~|---\s*$)/;

function* mdFiles(dir) {
  if (path.relative(ROOT, dir).split(path.sep).join('/') === SOURCES) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* mdFiles(p);
    else if (e.name.toLowerCase().endsWith('.md')) yield p;
  }
}

/** Claim lines in one text, and what is wrong with them. */
function scan(text) {
  const lines = text.split(/\r?\n/);
  let count = 0;
  const errors = [];
  const err = (line, msg) => errors.push({ line, msg });
  for (let i = 0; i < lines.length; i++) {
    const m = NEAR_RE.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const fieldAt = (j) => { const f = j < lines.length && FIELD_RE.exec(lines[j]); return f && f[1].length > indent ? f : null; };
    const runEnds = (j) => j >= lines.length || !lines[j].trim() || BREAK_RE.test(lines[j]);
    if (!TYPES.includes(m[2])) {
      for (let j = i + 1; !runEnds(j); j++) if (fieldAt(j)) { err(i + 1, `[${m[2]}] is not a claim type (${TYPES.join(', ')}); its fields are never read`); break; }
      continue;
    }
    count++;
    const struck = /^~~[\s\S]*~~$/.test(CLAIM_RE.exec(lines[i])[3]);
    const fields = {};
    let j = i + 1;
    for (; fieldAt(j); j++) {
      const f = FIELD_RE.exec(lines[j]);
      for (const part of `${f[2]}: ${f[3]}`.split(SPLIT_RE)) {
        const kv = /^(condition|date|by|source|superseded):\s*(.*)$/.exec(part.trim());
        if (!kv) continue;
        fields[kv[1]] = kv[2].trim();
        const eaten = KEY_IN_VALUE_RE.exec(kv[2]);
        if (eaten) err(j + 1, `${kv[1]}: swallows ${eaten[1]}: - separate fields on one line with " · "`);
      }
    }
    if (!runEnds(j)) for (let k = j + 1; !runEnds(k); k++) if (fieldAt(k)) { err(j + 1, `this line interrupts the claim on line ${i + 1}; its fields below are lost`); break; }
    if (struck && !fields.superseded) err(i + 1, 'struck through but no superseded: names the successor');
    if (!struck && m[2] === 'measurement' && !fields.condition) err(i + 1, 'a measurement carries its condition:');
  }
  return { count, errors };
}

function countClaims(files) {
  return files.reduce((n, f) => n + scan(fs.readFileSync(f, 'utf8')).count, 0);
}

/** { total, errors: ["file:line message"] } over the whole memory. */
function checkClaims(root = ROOT) {
  let total = 0;
  const errors = [];
  for (const d of DIRS) {
    for (const file of mdFiles(path.join(root, d))) {
      const r = scan(fs.readFileSync(file, 'utf8'));
      total += r.count;
      const rel = path.relative(root, file).split(path.sep).join('/');
      for (const e of r.errors) errors.push(`${rel}:${e.line} ${e.msg}`);
    }
  }
  return { total, errors };
}

module.exports = { checkClaims, countClaims };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--count') {
    console.log(countClaims(args.slice(1)));
  } else {
    const { total, errors } = checkClaims();
    for (const e of errors) console.log(e);
    console.log(errors.length ? `claims: ${errors.length} error(s)` : `claims: ${total} ok`);
    process.exit(errors.length ? 1 : 0);
  }
}
