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

// captures.md is tracked by git, included in backups and pushed by sync, and
// this hook runs before any agent can look at the text. So credential-shaped
// substrings are masked here, mechanically. Best-effort, not a guarantee: a
// secret that does not look like one still gets through, which is why the
// entry is flagged when a redaction fired.
const REDACTIONS = [
  // key = value / key: value assignments
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    '$1$2[redacted]'],
  // Authorization headers
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  // vendor-prefixed keys
  [/\b(?:sk|pk)[-_][A-Za-z0-9_-]{8,}/gi, '[redacted]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{8,}/g, '[redacted]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/gi, '[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\bAIza[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  // anything long and random-looking that survived the rules above
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]'],
];

function redact(text) {
  let out = text;
  for (const [re, replacement] of REDACTIONS) out = out.replace(re, replacement);
  return { text: out, redacted: out !== text };
}

function maybeCapture(prompt, now) {
  const low = prompt.toLowerCase();
  const hit = TRIGGERS.find((t) => low.includes(t));
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
