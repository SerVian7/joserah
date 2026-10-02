#!/usr/bin/env node
/**
 * Stop hook (0.16.9, owner 2026-10-01): a report published in this session
 * must not go stale silently. Silent outside a workspace, in a subagent, on
 * the turn it already held open (stop_hook_active), when nothing is new since
 * its last reminder, and on any error.
 *
 * Reads the transcript the hook is handed (main thread only): the last publish
 * of each report-like artifact (its <title>, title, description or label says
 * Rapor, Report, Gün Sonu, Takip or Status), and what changed after it — files
 * written by Write/Edit/NotebookEdit, other artifact publishes, and workspace
 * files `git status` shows modified since (what a subagent wrote). The stalest
 * report holds the turn open once with one line in the owner's language.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace, readConfig } = require('./lib/workspace');

const REPORT = /rapor|report|gün sonu|takip|status/i;
const EDITS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function htmlTitle(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = /<title[^>]*>([^<]*)<\/title>/i.exec(buf.toString('utf8', 0, n));
    return m ? m[1] : '';
  } catch { return ''; }
}

// Main-thread tool calls in transcript order: { at: ms, name, input }.
function toolCalls(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || !o.message || !Array.isArray(o.message.content)) continue;
    const at = Date.parse(o.timestamp);
    if (isNaN(at)) continue;
    for (const c of o.message.content) {
      if (c && c.type === 'tool_use') out.push({ at, name: c.name, input: c.input || {} });
    }
  }
  return out;
}

const isPublish = (c) => c.name === 'Artifact' && !c.input.asset && !!c.input.file_path
  && (!c.input.action || c.input.action === 'publish');
const key = (p) => path.resolve(String(p)).toLowerCase();

// Workspace files git sees changed, as [path, mtime ms]. Empty on any failure.
function gitChanges(root) {
  try {
    const r = spawnSync('git', ['-C', root, 'status', '--porcelain', '-z'], { encoding: 'utf8', timeout: 1500 });
    if (r.status !== 0) return [];
    const parts = r.stdout.split('\0');
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i];
      if (e.length < 4) continue;
      if (/^[RC]/.test(e)) i++; // a rename carries its old path as the next entry
      const abs = path.join(root, e.slice(3));
      try { out.push([abs, fs.statSync(abs).mtimeMs]); } catch { /* deleted */ }
    }
    return out;
  } catch { return []; }
}

// The stalest report: { file, title, at, n }, or null when every report is current.
function staleReport(calls, titleOf = htmlTitle, changed = []) {
  const pubs = calls.filter(isPublish);
  const titles = new Map();
  const title = (p) => { if (!titles.has(p)) titles.set(p, titleOf(p)); return titles.get(p); };
  const reports = new Set(pubs.filter((c) => REPORT.test(
    [title(c.input.file_path), c.input.title, c.input.description, c.input.label].join(' ')))
    .map((c) => c.input.file_path));
  let worst = null;
  // a report filed under a past day's folder (…/YYYY-MM-DD/…) belongs to a closed day: later changes are not its
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (const file of reports) {
    const day = /(\d{4}-\d{2}-\d{2})[\\/]/.exec(String(file).replace(/\\/g, '/') + '/');
    if (day && day[1] < today) continue;
    const at = Math.max(...pubs.filter((c) => c.input.file_path === file).map((c) => c.at));
    const files = new Set(); // each changed file or other page counts once
    for (const c of calls) {
      if (c.at <= at) continue;
      if (EDITS.has(c.name) && (c.input.file_path || c.input.notebook_path)) files.add(key(c.input.file_path || c.input.notebook_path));
      else if (isPublish(c) && c.input.file_path !== file) files.add(key(c.input.file_path));
    }
    for (const [p, mtime] of changed) if (mtime > at) files.add(key(p));
    const n = files.size;
    if (n && (!worst || n > worst.n)) worst = { file, title: title(file), at, n };
  }
  return worst;
}

function reminderLine(stale, language) {
  const d = new Date(stale.at);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return /^(tr|turk|türk)/i.test(String(language || ''))
    ? `Yayınlanan rapor güncel mi? Son yayın ${hhmm}, sonrasında ${stale.n} değişiklik.`
    : `Is the published report current? Last publish ${hhmm}, ${stale.n} changes since.`;
}

function readStdin(idleMs = 1000) {
  return new Promise((resolve) => {
    let raw = '';
    let timer = setTimeout(() => resolve(raw), idleMs);
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => resolve(raw), idleMs); };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; arm(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(raw); });
  });
}

async function main() {
  const root = findWorkspace(process.cwd());
  if (!root) return;
  const input = JSON.parse(await readStdin());
  if (input.stop_hook_active || input.agent_id || !input.transcript_path) return;
  const calls = toolCalls(fs.readFileSync(input.transcript_path, 'utf8'));
  if (!calls.some(isPublish)) return;
  const stale = staleReport(calls, htmlTitle, gitChanges(root));
  if (!stale) return;
  // One reminder per state: the same report, publish and count stay quiet.
  const id = String(input.session_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const seen = id && path.join(os.tmpdir(), `joserah-report-fresh-${id}`);
  const state = `${stale.file}|${stale.at}|${stale.n}`;
  if (seen) {
    try { if (fs.readFileSync(seen, 'utf8') === state) return; } catch { /* first reminder */ }
    fs.writeFileSync(seen, state, 'utf8');
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: reminderLine(stale, (readConfig(root) || {}).dialogueLanguage) }));
}

if (require.main === module) main().catch(() => {}).finally(() => process.exit(0));

module.exports = { toolCalls, staleReport, reminderLine, gitChanges };
