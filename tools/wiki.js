#!/usr/bin/env node
/**
 * wiki.js — the knowledge wiki's zero-token operations from the terminal (spec §6).
 *
 *   node tools/wiki.js index <workspace>     rewrite .joserah/knowledge/wiki/index.md when it changed
 *   node tools/wiki.js lint <workspace> [--json]
 *   node tools/wiki.js log <workspace> --op ingest|query|lint --title "<text>"
 *
 * Tests may fix the date with JOSERAH_NOW. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('./lib/wiki');

const [cmd, wsArg, ...rest] = process.argv.slice(2);
const die = (m) => { process.stderr.write(`wiki: ${m}\n`); process.exit(1); };
if (!wsArg) die('usage: wiki.js index|lint|log <workspace> …');
const ws = path.resolve(wsArg);
if (!fs.existsSync(path.join(ws, '.joserah'))) die(`not a Joserah workspace (no .joserah folder): ${ws}`);
const now = process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date();
if (Number.isNaN(now.getTime())) die(`JOSERAH_NOW is not a date: ${process.env.JOSERAH_NOW}`);
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const opt = (n) => { const i = rest.indexOf(n); return i < 0 ? undefined : rest[i + 1]; };

if (cmd === 'index') {
  const pages = W.scan(ws);
  const p = path.join(ws, W.KNOWLEDGE, 'wiki', 'index.md');
  const text = W.buildIndex(pages);
  const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (old !== text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  process.stdout.write(`index: ${pages.length} pages (${old !== text ? 'written' : 'unchanged'})\n`);
} else if (cmd === 'lint') {
  const f = W.lint(ws, { now });
  if (rest.includes('--json')) process.stdout.write(JSON.stringify(f, null, 2) + '\n');
  else for (const x of f) process.stdout.write(`${x.kind} · ${x.rel}${x.line ? `:${x.line}` : ''} · ${x.detail}\n`);
  process.stdout.write(`findings: ${f.length}\n`);
} else if (cmd === 'log') {
  const op = opt('--op'); const title = opt('--title');
  if (!['ingest', 'query', 'lint'].includes(op) || !title) die('usage: wiki.js log <workspace> --op ingest|query|lint --title "<text>"');
  const p = path.join(ws, W.KNOWLEDGE, 'wiki', 'log.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, '# Wiki log\n\n');
  const old = fs.readFileSync(p, 'utf8');
  fs.appendFileSync(p, (old && !old.endsWith('\n') ? '\n' : '') + W.logLine(op, title, day));
} else die(`unknown command ${cmd}`);
