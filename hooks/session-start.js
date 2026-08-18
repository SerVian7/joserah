#!/usr/bin/env node
/**
 * SessionStart hook. Silent unless the working directory is inside a
 * Joserah workspace. Injects: date, open tasks, today's journal, recent
 * learnings, and a backup-staleness line. Creates today's journal stub if
 * missing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function weekday(d) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

function ensureDailyStub(today) {
  const p = path.join(ROOT, '.joserah', 'desk', 'daily', today.slice(0, 4), `${today}.md`);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `# ${today}\n\n## Top of mind\n-\n\n## Done today\n-\n\n## Notes\n`, 'utf8');
  }
  return p;
}

function firstNOpenTasks(p, n) {
  const out = [];
  for (const line of readText(p).split(/\r?\n/)) {
    if (line.trim().startsWith('- [ ]')) {
      out.push(line.trim());
      if (out.length >= n) break;
    }
  }
  return out;
}

function lastLearnedEntries(p, n) {
  const sections = [];
  let current = null;
  for (const line of readText(p).split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current.join('\n').trimEnd());
      current = [line];
    } else if (current) current.push(line);
  }
  if (current) sections.push(current.join('\n').trimEnd());
  return sections.slice(0, n).join('\n\n');
}

// Local-only staleness signal: no git, no network, modification times only.
// Every file's mtime under desk/, knowledge/ and personal/ is compared
// against `lastBackup`. When there is no `lastBackup` yet, the workspace's
// own `.joserah/config.json` mtime stands in for it — every template file
// scaffold.js writes predates that file (it is written last in the initial
// run), so a freshly scaffolded, untouched workspace naturally reports
// nothing; only files touched after that point count as "changed".
function allFileMtimes(dirs) {
  const out = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          try { out.push(fs.statSync(p).mtimeMs); } catch { /* raced deletion — skip */ }
        }
      }
    })(dir);
  }
  return out;
}

function formatAgo(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function backupStalenessLine(root, cfg, now) {
  const configPath = path.join(root, '.joserah', 'config.json');
  let sinceMs = null;
  let neverBackedUp = !cfg.lastBackup;
  if (cfg.lastBackup) {
    const parsed = new Date(cfg.lastBackup);
    if (!isNaN(parsed.valueOf())) sinceMs = parsed.getTime();
  }
  if (sinceMs === null) {
    try { sinceMs = fs.statSync(configPath).mtimeMs; } catch { return null; }
  }
  const dirs = ['desk', 'knowledge', 'personal'].map((d) => path.join(root, '.joserah', d));
  const changed = allFileMtimes(dirs).filter((m) => m > sinceMs);
  if (!changed.length) return null;
  const agoLabel = neverBackedUp ? 'no backup taken yet' : `${formatAgo(now.getTime() - sinceMs)} ago`;
  return `[backup] ${changed.length} file(s) changed since last backup (${agoLabel}).`;
}

const now = new Date();
const today = isoDate(now);
const cfg = readConfig(ROOT) || {};
const dailyPath = ensureDailyStub(today);

const parts = [
  `## Joserah session context — ${today} ${pad(now.getHours())}:${pad(now.getMinutes())} ${weekday(now)}`,
  `Workspace: ${cfg.workspaceName || path.basename(ROOT)} (${ROOT})`,
];

const tasks = firstNOpenTasks(path.join(ROOT, '.joserah', 'desk', 'tasks', 'now.md'), 5);
if (tasks.length) parts.push('\n### Current focus (.joserah/desk/tasks/now.md)\n' + tasks.join('\n'));

const dailyText = readText(dailyPath);
if (dailyText.split(/\r?\n/).length > 5) {
  parts.push(`\n### Today's journal (.joserah/desk/daily/${today.slice(0, 4)}/${today}.md)\n${dailyText}`);
}

const learned = lastLearnedEntries(path.join(ROOT, '.joserah', 'learned.md'), 3);
if (learned) parts.push('\n### Recent learnings (.joserah/learned.md)\n' + learned);

const staleness = backupStalenessLine(ROOT, cfg, now);
if (staleness) parts.push('\n' + staleness);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: parts.join('\n'),
  },
}));
