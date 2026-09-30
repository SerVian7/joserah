'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = path.join('.joserah', 'config.json');

/** Walk up from startDir looking for the workspace marker. */
function findWorkspace(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, MARKER), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function stubText(day) { return `# ${day}\n\n## Top of mind\n-\n\n## Done today\n-\n\n## Notes\n`; }
// 0.13.4: the stub session-brief writes, still untouched — whitespace aside, so
// an editor that re-saves it with CRLF or a trailing newline does not make it news.
function isStub(text, day) { return text.replace(/\s/g, '') === stubText(day).replace(/\s/g, ''); }

// 0.15.1 (owner, 2026-09-30): a sweep is due after a week, or once five days
// of journal have piled up since the last one — whichever comes first.
// Measured from lastSweep, or from `created` when there has never been one.
// null: nothing to say; { invalid }: the stamp is not a date.
const SWEEP_DUE_DAYS = 7;
const SWEEP_DUE_JOURNAL_DAYS = 5;
function sweepDue(root, cfg, now = new Date()) {
  if (!fs.existsSync(path.join(root, '.joserah', 'knowledge'))) return null;
  const since = cfg && (cfg.lastSweep || cfg.created);
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return { invalid: since };
  const days = Math.floor((now.getTime() - t) / 86400000);
  const from = new Date(t).toISOString().slice(0, 10);
  let journalDays = 0;
  const daily = path.join(root, '.joserah', 'desk', 'daily');
  let years = [];
  try { years = fs.readdirSync(daily); } catch { /* no journal yet */ }
  for (const y of years) {
    let files = [];
    try { files = fs.readdirSync(path.join(daily, y)); } catch { continue; }
    for (const f of files) {
      const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(f);
      if (!m || m[1] <= from) continue;
      let text = '';
      try { text = fs.readFileSync(path.join(daily, y, f), 'utf8'); } catch { continue; }
      if (text.trim() && !isStub(text, m[1])) journalDays++;
    }
  }
  return { days, journalDays, never: !cfg.lastSweep,
    due: days >= SWEEP_DUE_DAYS || journalDays >= SWEEP_DUE_JOURNAL_DAYS };
}

module.exports = { findWorkspace, readConfig, MARKER, stubText, isStub, sweepDue, SWEEP_DUE_DAYS, SWEEP_DUE_JOURNAL_DAYS };
