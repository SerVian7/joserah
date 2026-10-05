#!/usr/bin/env node
/**
 * measure-run.js — what one job cost, read from the runtime's own transcripts.
 *
 *   node tools/measure-run.js <session transcript.jsonl> [--from <ISO>] [--to <ISO>]
 *
 * Sums the main transcript and every `<session>/subagents/agent-*.jsonl` beside
 * it (the runtime's transcript layout), counting only assistant entries whose
 * `timestamp` falls inside [--from, --to] — the request and the reply.
 * Output: { wallSeconds, sessions, tokens: { input, output, cacheRead, cacheWrite } }
 *   wallSeconds  --to minus --from; a missing end is the first / last timestamp
 *                inside the window across all transcripts
 *   sessions     transcripts with at least one counted message
 *   tokens       message.usage input_tokens, output_tokens,
 *                cache_read_input_tokens, cache_creation_input_tokens;
 *                a field that is absent counts as 0
 * One API message is written as several entries (one per content block) that
 * repeat the same input figures while output_tokens grows, so each message
 * (`message.id`) is counted once, from its last entry inside the window.
 * Exit 1: no transcript, transcript not found, or a time that does not parse —
 * never a row of zeros the caller could mistake for a measurement.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function fail(msg) {
  process.stderr.write(`measure-run: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { file: null, from: null, to: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from' || a === '--to') {
      const v = argv[++i];
      const ms = v === undefined ? NaN : Date.parse(v);
      if (Number.isNaN(ms)) fail(`${a} needs an ISO time, got ${v === undefined ? 'nothing' : JSON.stringify(v)}`);
      opts[a.slice(2)] = ms;
    } else if (!opts.file) {
      opts.file = a;
    } else {
      fail(`unexpected argument ${JSON.stringify(a)}`);
    }
  }
  if (!opts.file) fail('usage: measure-run.js <session transcript.jsonl> [--from <ISO>] [--to <ISO>]');
  return opts;
}

function transcripts(main) {
  const list = [main];
  const subs = path.join(main.replace(/\.jsonl$/i, ''), 'subagents');
  let names = [];
  try { names = fs.readdirSync(subs); } catch { /* no subagents */ }
  for (const n of names.sort()) if (/^agent-.*\.jsonl$/.test(n)) list.push(path.join(subs, n));
  return list;
}

function entries(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn or foreign line is skipped */ }
  }
  return out;
}

const int = (v) => (Number.isFinite(v) ? v : 0);

function measure({ file, from, to }) {
  const main = path.resolve(file);
  if (!fs.existsSync(main)) fail(`transcript not found: ${main}`);
  const inside = (ms) => !Number.isNaN(ms) && (from === null || ms >= from) && (to === null || ms <= to);

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let sessions = 0;
  let first = null;
  let last = null;
  for (const t of transcripts(main)) {
    const messages = new Map(); // message id -> last usage inside the window
    let anon = 0;
    for (const e of entries(t)) {
      const ms = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
      if (!inside(ms)) continue;
      if (first === null || ms < first) first = ms;
      if (last === null || ms > last) last = ms;
      const usage = e.type === 'assistant' && e.message && e.message.usage;
      if (!usage) continue;
      messages.set(e.message.id || e.requestId || `anon-${anon++}`, usage);
    }
    if (messages.size) sessions++;
    for (const u of messages.values()) {
      tokens.input += int(u.input_tokens);
      tokens.output += int(u.output_tokens);
      tokens.cacheRead += int(u.cache_read_input_tokens);
      tokens.cacheWrite += int(u.cache_creation_input_tokens);
    }
  }
  const start = from !== null ? from : first;
  const end = to !== null ? to : last;
  const wallSeconds = start !== null && end !== null ? (end - start) / 1000 : 0;
  return { wallSeconds, sessions, tokens };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(measure(parseArgs(process.argv.slice(2)))) + '\n');
}

module.exports = { measure };
