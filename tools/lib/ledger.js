'use strict';
// The Ledger: Lead's append-only record of a conversation's work, one line
// per event, under .joserah/desk/crew/<YYYY-MM-DD>/lead/ledger-<HHMM>.md.
//
//   HH:MM · <kind> · <job> · <text> · <log path or ->
//
// `text` is the only free field: a newline in it becomes a space and the
// separator ` · ` becomes ` - `, so a line is always one line and always
// five fields. `job` is a slug (no spaces); `path` may hold spaces but never
// the separator or a newline. A line is parsed from both ends: time, kind and
// job from the left, path from the right, text whatever lies between.

const fs = require('fs');
const path = require('path');

const SEP = ' · ';
const KINDS = ['open', 'decision', 'start', 'owner', 'end', 'compact', 'session-end'];
const OPEN_KINDS = ['start', 'owner'];
const JOB_KINDS = ['start', 'owner', 'end'];
const LAST_DECISIONS = 5;

const TIME_RE = /^\d{2}:\d{2}$/;
const JOB_RE = /^[^\s·]+$/;

function cleanText(text) {
  const t = String(text ?? '').replace(/\r\n|\r|\n/g, ' ').split(SEP).join(' - ').trim();
  return t || '-';
}

function formatLine({ time, kind, job, text, path: p }) {
  if (!KINDS.includes(kind)) throw new Error(`ledger: unknown kind "${kind}"`);
  if (!TIME_RE.test(String(time))) throw new Error(`ledger: bad time "${time}"`);
  if (!JOB_RE.test(String(job))) throw new Error(`ledger: bad job "${job}" (a slug, no spaces)`);
  const lp = p === undefined || p === null || p === '' ? '-' : String(p);
  if (/[\r\n]/.test(lp) || lp.includes(SEP) || lp !== lp.trim()) throw new Error(`ledger: bad path "${lp}"`);
  return [time, kind, job, cleanText(text), lp].join(SEP);
}

function parseLine(line) {
  const s = String(line).replace(/\r$/, '');
  const parts = [];
  let rest = s;
  for (let i = 0; i < 3; i++) {
    const at = rest.indexOf(SEP);
    if (at < 0) return null;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + SEP.length);
  }
  const last = rest.lastIndexOf(SEP);
  if (last < 0) return null;
  const [time, kind, job] = parts;
  const text = rest.slice(0, last);
  const p = rest.slice(last + SEP.length);
  if (!TIME_RE.test(time) || !KINDS.includes(kind) || !JOB_RE.test(job) || !p) return null;
  return { time, kind, job, text, path: p };
}

const parseAll = (text) => String(text).split(/\r?\n/).map(parseLine).filter(Boolean);

/** Open jobs (last line `start` or `owner`), the last decisions, and the open line's ids. */
function openItems(text) {
  const last = new Map();
  const decisions = [];
  let agentId = null;
  let sessionId = null;
  for (const l of parseAll(text)) {
    if (l.kind === 'open' && sessionId === null) {
      const m = /\bsession (\S+)/.exec(l.text);
      const a = /\bagent (\S+)/.exec(l.text);
      sessionId = m ? m[1] : null;
      agentId = a ? a[1] : null;
    } else if (l.kind === 'decision') {
      decisions.push(l);
    } else if (JOB_KINDS.includes(l.kind) && l.job !== '-') {
      last.delete(l.job); // re-insert so the order follows the latest event
      last.set(l.job, l);
    }
  }
  const jobs = [...last.values()].filter((l) => OPEN_KINDS.includes(l.kind))
    .map(({ job, kind, text: t, path: p, time }) => ({ job, kind, text: t, path: p, time }));
  return { jobs, decisions: decisions.slice(-LAST_DECISIONS), agentId, sessionId };
}

/**
 * The Ledger of `dateStr` whose `open` line names `sessionId`, or null. Never
 * the newest as a fallback: a stamp must not land in another session's Ledger.
 */
function findLedger(root, dateStr, sessionId) {
  if (!sessionId) return null;
  const dir = path.join(root, '.joserah', 'desk', 'crew', String(dateStr), 'lead');
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => /^ledger-.*\.md$/.test(n)).sort();
  } catch {
    return null;
  }
  for (const n of names) {
    const file = path.join(dir, n);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (openItems(text).sessionId === String(sessionId)) return file;
  }
  return null;
}

module.exports = { KINDS, SEP, formatLine, parseLine, openItems, findLedger };
