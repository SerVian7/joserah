#!/usr/bin/env node
/**
 * answers.js — read and answer what the owner wrote on a page served by the Joserah server.
 *
 *   node tools/answers.js list <page-dir> [--new] [--json]
 *   node tools/answers.js mark <page-dir> <id> read
 *   node tools/answers.js reply <page-dir> <id> --note "<text>"
 *   node tools/answers.js pages <workspace> [--days N]
 *
 * <page-dir> is the page's folder (.joserah/desk/artifacts/<day>/<folder>); answers.json sits beside its
 * rows.json. Replies are "<id>--r<time>" documents from the assistant; an owner document is never changed
 * except its read mark (tools/lib/answers.js). No dependencies.
 */
'use strict';
const path = require('path');
const A = require('./lib/answers');

function die(msg) { process.stderr.write(`answers: ${msg}\n`); process.exit(1); }
const hm = (iso) => { const d = new Date(iso); return isNaN(d) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, 2); return v; };
const has = (name) => { const i = rest.indexOf(name); if (i < 0) return false; rest.splice(i, 1); return true; };

if (cmd === 'list') {
  const onlyNew = has('--new'); const json = has('--json'); const dir = rest[0];
  if (!dir) die('usage: answers.js list <page-dir> [--new] [--json]');
  const docs = A.list(path.resolve(dir), { onlyNew });
  if (json) process.stdout.write(JSON.stringify(docs, null, 2) + '\n');
  else for (const d of docs) process.stdout.write(`${d.id} · ${d.state || '-'} · ${hm(d.at)} · ${d.key || '-'} · ${flat(d.row) || '-'} · ${flat(d.note).slice(0, 120)}\n`);
} else if (cmd === 'mark') {
  const [dir, id, what] = rest;
  if (!dir || !id || what !== 'read') die('usage: answers.js mark <page-dir> <id> read');
  const r = A.markRead(path.resolve(dir), id);
  if (!r.ok) die(r.code);
  process.stdout.write(`marked: ${id}\n`);
} else if (cmd === 'reply') {
  const note = flag('--note'); const [dir, id] = rest;
  if (!dir || !id || !note) die('usage: answers.js reply <page-dir> <id> --note "<text>"');
  // A reply answers something on the page: a mistyped id is refused, not answered into the void.
  if (!A.read(path.resolve(dir)).docs[id]) die('not-found');
  const r = A.reply(path.resolve(dir), id, note);
  if (!r.ok) die(r.code);
  process.stdout.write(`reply: ${r.id}\n`);
} else if (cmd === 'pages') {
  const days = Number(flag('--days') || 2); const ws = rest[0];
  if (!ws || !Number.isInteger(days) || days < 1) die('usage: answers.js pages <workspace> [--days N]');
  for (const p of A.newCounts(path.resolve(ws), days)) process.stdout.write(`${p.page} · ${p.count} new · ${p.dir}\n`);
} else {
  die('usage: answers.js list|mark|reply|pages …');
}
