#!/usr/bin/env node
/**
 * UserPromptSubmit hook. Silent outside a Joserah workspace.
 * 1. Appends prompts containing a capture trigger to .joserah/desk/inbox/captures.md.
 * 2. Injects the current date/time on rollover or after 90 minutes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');
const { redact } = require('./lib/redactions');

const ROOT = findWorkspace(process.cwd());
if (!ROOT) process.exit(0);

const DEFAULT_TRIGGERS = [
  'yapılacaklara ekle', 'yapilacaklara ekle', 'kaydet', 'not düş', 'not dus',
  'hatırlat', 'hatirlat', 'unutmayalım', 'unutmayalim',
  'todo:', 'remind me', 'save this', 'remember to', 'add to my todos',
];

const cfg = readConfig(ROOT) || {};
const TRIGGERS = Array.isArray(cfg.captureTriggers) && cfg.captureTriggers.length
  ? cfg.captureTriggers
  : DEFAULT_TRIGGERS;

const STATE_FILE = path.join(ROOT, '.joserah', 'last-time-inject');
const INBOX = path.join(ROOT, '.joserah', 'desk', 'inbox', 'captures.md');

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function weekday(d) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
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

// Trigger matching is boundary-aware: a trigger must not be embedded inside a
// longer word (e.g. Turkish "kaydettim" must not fire the "kaydet" trigger).
// \u0300-\u036f (combining diacritics) is included because JS's locale-blind
// toLowerCase() turns Turkish "İ" (U+0130, capital dotted I) into "i" plus a
// COMBINING DOT ABOVE (U+0307), not a single precomposed "i" — without this
// range, that leftover combining mark reads as a non-word boundary and a
// trigger glued to an "İ"-prefixed word (e.g. "İkaydet") would wrongly fire.
const WORD_CHAR = /[a-z0-9çğıöşü\u0300-\u036f]/i;
function findTrigger(low) {
  for (const t of TRIGGERS) {
    let i = low.indexOf(t);
    while (i !== -1) {
      const before = low[i - 1], after = low[i + t.length];
      if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) return t;
      i = low.indexOf(t, i + 1);
    }
  }
  return null;
}

function maybeCapture(prompt, now) {
  const low = prompt.toLowerCase();
  const hit = findTrigger(low);
  if (!hit) return null;
  fs.mkdirSync(path.dirname(INBOX), { recursive: true });
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  // Redact before truncating, so the whole prompt is examined.
  const safe = redact(oneLine);
  const text = safe.text.length > 500 ? safe.text.slice(0, 497) + '...' : safe.text;
  const flag = safe.redacted ? `${hit}, redacted` : hit;
  const entry = `- [ ] [${stamp(now)}] (trigger: ${flag}) ${text}\n`;
  fs.appendFileSync(INBOX, entry, 'utf8');
  return entry.trim();
}

function shouldInjectTime(now) {
  try {
    const last = new Date(fs.readFileSync(STATE_FILE, 'utf8').trim());
    if (isNaN(last.valueOf())) return true;
    if (last.toDateString() !== now.toDateString()) return true;
    return (now - last) >= 90 * 60 * 1000;
  } catch { return true; }
}

(async () => {
  let prompt = '';
  try {
    const raw = await readStdin();
    if (raw) prompt = String(JSON.parse(raw).prompt || '');
  } catch { /* ignore malformed input */ }

  const now = new Date();
  const parts = [];

  const captured = maybeCapture(prompt, now);
  if (captured) parts.push(`[capture] Appended to .joserah/desk/inbox/captures.md:\n${captured}`);

  if (shouldInjectTime(now)) {
    parts.push(`[time] Current: ${stamp(now)} ${weekday(now)}`);
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, now.toISOString(), 'utf8');
  }

  if (parts.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: parts.join('\n\n'),
      },
    }));
  }
})();
