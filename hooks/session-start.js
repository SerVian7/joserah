#!/usr/bin/env node
/**
 * SessionStart hook. Silent unless the working directory is inside a
 * Joserah workspace. Injects: date, open tasks, today's journal, recent
 * learnings. Creates today's journal stub if missing.
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
  const p = path.join(ROOT, 'desk', 'daily', today.slice(0, 4), `${today}.md`);
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

const now = new Date();
const today = isoDate(now);
const cfg = readConfig(ROOT) || {};
const dailyPath = ensureDailyStub(today);

const parts = [
  `## Joserah session context — ${today} ${pad(now.getHours())}:${pad(now.getMinutes())} ${weekday(now)}`,
  `Workspace: ${cfg.workspaceName || path.basename(ROOT)} (${ROOT})`,
];

const tasks = firstNOpenTasks(path.join(ROOT, 'desk', 'tasks', 'now.md'), 5);
if (tasks.length) parts.push('\n### Current focus (desk/tasks/now.md)\n' + tasks.join('\n'));

const dailyText = readText(dailyPath);
if (dailyText.split(/\r?\n/).length > 5) {
  parts.push(`\n### Today's journal (desk/daily/${today.slice(0, 4)}/${today}.md)\n${dailyText}`);
}

const learned = lastLearnedEntries(path.join(ROOT, '.joserah', 'learned.md'), 3);
if (learned) parts.push('\n### Recent learnings (.joserah/learned.md)\n' + learned);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: parts.join('\n'),
  },
}));
