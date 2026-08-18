#!/usr/bin/env node
/**
 * UserPromptSubmit hook. Silent outside a Joserah workspace.
 * 1. Appends prompts containing a capture trigger to desk/inbox/captures.md.
 * 2. Injects the current date/time on rollover or after 90 minutes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findWorkspace, readConfig } = require('./lib/workspace');

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
const INBOX = path.join(ROOT, 'desk', 'inbox', 'captures.md');

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function weekday(d) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { raw += c; });
    process.stdin.on('end', () => resolve(raw));
    setTimeout(() => resolve(raw), 200);
  });
}

function maybeCapture(prompt, now) {
  const low = prompt.toLowerCase();
  const hit = TRIGGERS.find((t) => low.includes(t));
  if (!hit) return null;
  fs.mkdirSync(path.dirname(INBOX), { recursive: true });
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  const text = oneLine.length > 500 ? oneLine.slice(0, 497) + '...' : oneLine;
  const entry = `- [ ] [${stamp(now)}] (trigger: ${hit}) ${text}\n`;
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
  if (captured) parts.push(`[capture] Appended to desk/inbox/captures.md:\n${captured}`);

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
