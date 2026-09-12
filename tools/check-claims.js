#!/usr/bin/env node
/**
 * check-claims.js — audit the typed claim lines of a workspace.
 * Usage: node check-claims.js <workspace-root> [--json]
 * Exit 0 no errors (warnings allowed) · 1 errors found · 2 not a workspace.
 *
 * The three checks come from the 2026-09-12 typed-claims design: a measurement
 * without its conditions, a superseded line that names no successor, and a
 * calculation left standing next to a measurement of the same subject — the
 * last one is the exact shape of the failure the design was written for.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scanWorkspace } = require('./lib/workspace-scan');
const { parseFrontmatter, parseClaims } = require('./lib/note-format');

const args = process.argv.slice(2);
const json = args.includes('--json');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
if (!fs.existsSync(path.join(root, '.joserah', 'config.json'))) {
  console.error(`check-claims: ${root} is not a Joserah workspace`);
  process.exit(2);
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const findings = [];
let total = 0;
const add = (level, rel, line, kind, detail) => findings.push({ level, file: rel, line, kind, detail });

for (const rel of scanWorkspace(root).files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const { body } = parseFrontmatter(text);
  const offset = text.slice(0, text.length - body.length).split(/\r?\n/).length - 1;
  const claims = parseClaims(body).map((c) => ({ ...c, line: c.line + offset }));
  total += claims.length;
  const live = claims.filter((c) => !c.struck);
  const measured = new Set(live.filter((c) => c.type === 'measurement').map((c) => norm(c.subject)));

  for (const c of claims) {
    if (!c.fields.by) add('warn', rel, c.line, 'missing-by', 'no by: field — every claim names who produced it');
    if (c.struck && !c.fields.superseded) add('error', rel, c.line, 'struck-without-superseded', 'struck through but nothing says what replaced it');
    if (!c.struck && c.type === 'measurement' && !c.fields.condition) add('error', rel, c.line, 'measurement-without-condition', 'a measurement carries its conditions (hardware, engine, settings) or it is not a measurement');
    if (!c.struck && c.type === 'calculation' && measured.has(norm(c.subject))) add('error', rel, c.line, 'calculation-open', `a live measurement of "${c.subject}" exists in this file — strike this line and point superseded: at it`);
  }
  const seen = new Map();
  for (const c of live) {
    const key = `${c.type}|${norm(c.subject)}|${norm(c.fields.condition)}`;
    const prev = seen.get(key);
    if (prev && norm(prev.value) !== norm(c.value)) add('error', rel, c.line, 'conflict', `contradicts line ${prev.line} (${prev.value} vs ${c.value}) under the same conditions; one must supersede the other`);
    else if (!prev) seen.set(key, c);
  }
}

const errors = findings.filter((f) => f.level === 'error').length;
const warnings = findings.length - errors;
if (json) {
  console.log(JSON.stringify({ claims: total, errors, warnings, findings }, null, 2));
} else {
  for (const f of findings) console.log(`${f.level === 'error' ? 'error ' : 'warn  '} ${f.file}:${f.line}  ${f.kind}  ${f.detail}`);
  console.log(`${errors} error(s), ${warnings} warning(s) in ${total} claim(s)`);
}
process.exit(errors ? 1 : 0);
