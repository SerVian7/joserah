#!/usr/bin/env node
/**
 * SessionStart hook, second command: what is true RIGHT NOW. Silent unless the
 * working directory is inside a Joserah workspace. Injects the date, open
 * tasks, today's journal, recent learnings, a backup-staleness line and the
 * update lines, and creates today's journal stub if missing.
 *
 * It is a separate command from session-start.js on purpose. Claude Code
 * replaces any SINGLE hook command's output over 10,000 characters with a stub
 * holding the first 2,000 — the threshold is per command, so two commands get
 * two budgets. Together they used to be one 12,000-character write that
 * delivered 2,263 characters. See MAX_HOOK_CHARS in lib/standing-context.js.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { withinBudget } = require('./lib/standing-context');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);

// The standing instructions travel apart from the plugin (tools/lib/prompt.js).
// Once a day the marketplace clone is pulled — a plain git checkout, so this
// is the one place a refresh needs no plugin update and no restart — and on
// every session start a pristine-but-behind AGENTS.md is brought current on
// the spot, exactly as refresh-prompt.js would do it: same shared decision,
// so a hand-edited file is never touched here either, only reported. A newer
// *plugin* is only ever reported: that update is the owner's to run.
// Everything here is best-effort — an update check must never break a
// session start, so every failure is swallowed and produces no line.
const CLONE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
function maybeRefreshClone(lib, now) {
  const clone = lib.marketplaceCloneDir();
  if (!clone || !fs.existsSync(path.join(clone, '.git'))) return;
  const stamp = path.join(os.tmpdir(), 'joserah-clone-refresh.stamp');
  try {
    if (now.getTime() - fs.statSync(stamp).mtimeMs < CLONE_REFRESH_INTERVAL_MS) return;
  } catch { /* no stamp yet */ }
  // Stamped before the pull, so an unreachable remote is retried tomorrow,
  // not on every session start today.
  try { fs.writeFileSync(stamp, String(now.getTime()), 'utf8'); } catch { return; }
  spawnSync('git', ['-C', clone, 'pull', '--ff-only', '--quiet'], { stdio: 'ignore', timeout: 8000 });
}
function updateLines(cfg, now) {
  let lib;
  try { lib = require('../tools/lib/prompt'); } catch { return []; }
  const lines = [];
  try {
    maybeRefreshClone(lib, now);
    const source = lib.resolvePromptSource();
    if (source) {
      const st = lib.promptState(ROOT, cfg, source);
      const action = lib.decidePromptAction(st, { force: false });
      if (action === 'install' || action === 'record') {
        lib.installPrompt(ROOT, source, { recordOnly: action === 'record' });
        if (action === 'install') {
          const was = st.version === null ? 'unversioned' : `v${st.version}`;
          lines.push(`[update] The standing instructions were refreshed to prompt v${source.version} (was ${was}) at this session start; they take full effect in a new conversation. Tell the owner in one line, in their language.`);
        }
      } else if (action === 'refused') {
        const why = st.state === 'hand-edited' ? 'was hand-edited' : 'predates prompt versioning and differs';
        lines.push(`[update] Prompt v${source.version} is available but this workspace's AGENTS.md ${why}, so it was left alone. Tell the owner in one line, in their language, and offer /joserah:update.`);
      }
    }
    const v = lib.pluginVersions();
    if (v.installed && v.available && lib.compareVersions(v.available, v.installed) > 0) {
      lines.push(`[update] Joserah plugin ${v.available} is available (installed: ${v.installed}). Tell the owner in one line, in their language. Updating the plugin is theirs to do and needs a restart afterwards; do not explain further unless asked.`);
    }
  } catch { /* best-effort, see above */ }
  return lines;
}

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

// A task is often a wrapped paragraph, not one line — the marker plus its
// indented continuation lines, ending at the next `- [ ]` or a blank line.
// Keeping only the marker line handed the briefing half a sentence; one
// session was told a task concerned "Işılay Gece, Orhan" and nothing
// further. The cap below is a character budget, not a task count: a line
// count has no relationship to how much of the briefing one long task
// consumes, and would either cut a task short again or, for short one-line
// tasks, stop well before the budget is actually used.
function firstNOpenTasks(p, maxChars) {
  const lines = readText(p).split(/\r?\n/);
  const out = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('- [ ]')) continue;
    const block = [lines[i].trim()];
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j])) {
      block.push(lines[j].trim());
      j++;
    }
    const task = block.join(' ');
    // At least one task always goes through, even over budget — an empty
    // briefing is worse than one long task, and this is still whole, never
    // cut mid-sentence.
    if (out.length && used + task.length > maxChars) break;
    out.push(task);
    used += task.length;
    i = j - 1;
  }
  return out;
}

function lastLearnedEntries(p, n, indexChars) {
  const sections = [];
  let current = null;
  for (const line of readText(p).split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current.join('\n').trimEnd());
      current = [line];
    } else if (current) current.push(line);
  }
  if (current) sections.push(current.join('\n').trimEnd());
  // `slice(0, n)` was "the newest" only while the file happened to be written
  // newest-first, and nothing enforces that: an entry appended at the bottom —
  // or a whole file kept oldest-first — silently never reaches a session, which
  // is the worst failure this hook has, because the owner sees their rule
  // written down and assumes it is in force. So pick by the date in the
  // heading, not by position. Sections whose heading carries no date (a
  // `## Relations` or `## Claims` block at the end of the file) are not
  // learnings and are never candidates.
  const dated = [];
  for (const s of sections) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) dated.push({ date: m[1], text: s });
  }
  // Stable within the same date: whichever came first in the file stays first,
  // so a day's entries keep the order their author wrote them in.
  const newestFirst = dated
    .map((d, i) => ({ ...d, i }))
    .sort((a, b) => (a.date === b.date ? a.i - b.i : (a.date < b.date ? 1 : -1)));
  const full = newestFirst.slice(0, n).map((d) => d.text).join('\n\n');
  // `n` in full was itself a silent cap: a fourth rule the owner wrote down was
  // invisible to every session, and nothing said so. The rest are named — one
  // heading per line — so a session at least knows the rule exists and can open
  // the file. Only the index is bounded: with hundreds of rules it is the index
  // that gets cut, never a full entry, and the cut says how many were left out
  // so "no more rules" and "no more room" can never look the same.
  const rest = newestFirst.slice(n).map((d) => `- ${d.text.split('\n')[0].replace(/^##\s+/, '')}`);
  if (!rest.length) return full;
  const budget = indexChars || 800;
  let used = 0;
  const shown = [];
  for (const line of rest) {
    if (used + line.length + 1 > budget) break;
    shown.push(line);
    used += line.length + 1;
  }
  const missing = rest.length - shown.length;
  if (missing) shown.push(`- …and ${missing} more, all in .joserah/learned.md`);
  return `${full}\n\nAlso on record, in full in .joserah/learned.md:\n${shown.join('\n')}`;
}

// Local-only staleness signal: no git, no network, modification times only.
// Every file's mtime under desk/, knowledge/ and personal/ is compared
// against `lastBackup`. When there is no `lastBackup` yet, the workspace's
// own `.joserah/config.json` mtime stands in for it — every template file
// scaffold.js writes predates that file (it is written last in the initial
// run), so a freshly scaffolded, untouched workspace naturally reports
// nothing; only files touched after that point count as "changed". This
// depends on the caller computing staleness BEFORE calling ensureDailyStub:
// that call creates a new file under desk/, and if it ran first its own
// stub would be walked and counted as a change the hook just invented.
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
  // This scope (`.joserah/desk`, `knowledge`, `personal`) matches what the
  // repository backup route actually carries — `imports/` (formerly `raw/`)
  // is excluded from it by construction. It does NOT match the zip route,
  // which does carry `imports/` (archive.js has no such exclusion): a change
  // under `imports/` alone
  // will never trip this staleness counter, even right after a zip backup,
  // and a change there right before one will not clear it either. Accepted
  // as a low-consequence gap for now — `imports/` holds immutable source
  // material, which changes far less often than the notes above it — but a
  // future change to either route's scope should double check this still
  // matches whichever route the owner actually uses.
  const dirs = ['desk', 'knowledge', 'personal'].map((d) => path.join(root, '.joserah', d));
  const changed = allFileMtimes(dirs).filter((m) => m > sinceMs);
  if (!changed.length) return null;
  const agoLabel = neverBackedUp ? 'no backup taken yet' : `${formatAgo(now.getTime() - sinceMs)} ago`;
  return `[backup] ${changed.length} file(s) changed since last backup (${agoLabel}).`;
}

const now = new Date();
const today = isoDate(now);
const cfg = readConfig(ROOT) || {};
// Staleness is computed BEFORE the daily stub is written, so the file this
// hook itself creates never counts as "changed since last backup".
const staleness = backupStalenessLine(ROOT, cfg, now);
const dailyPath = ensureDailyStub(today);

// This is layer 6 — what happens to be true of this moment and of no other. It
// arrives as its own hook command, and nothing guarantees the order two
// commands are delivered in, so the block says out loud where it belongs
// instead of relying on being last in the file.
const parts = [
  '## Right now (computed for this session)',
  'This block is computed for this session and is read last, after the standing layers.',
  `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}, ${weekday(now)}.`,
  `Workspace: ${cfg.workspaceName || path.basename(ROOT)} (${ROOT})`,
];

const tasks = firstNOpenTasks(path.join(ROOT, '.joserah', 'desk', 'tasks', 'now.md'), 1500);
if (tasks.length) parts.push('\n### Current focus (.joserah/desk/tasks/now.md)\n' + tasks.join('\n'));

const dailyText = readText(dailyPath);
if (dailyText.split(/\r?\n/).length > 5) {
  parts.push(`\n### Today's journal (.joserah/desk/daily/${today.slice(0, 4)}/${today}.md)\n${dailyText}`);
}

const learned = lastLearnedEntries(path.join(ROOT, '.joserah', 'learned.md'), 3);
if (learned) parts.push('\n### Recent learnings (.joserah/learned.md)\n' + learned);

if (staleness) parts.push('\n' + staleness);

for (const line of updateLines(cfg, now)) parts.push('\n' + line);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: withinBudget(parts.join('\n')),
  },
}));
