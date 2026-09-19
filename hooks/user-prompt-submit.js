#!/usr/bin/env node
/**
 * UserPromptSubmit hook. Silent outside a Joserah workspace.
 * 1. Appends prompts containing a capture trigger to .joserah/desk/inbox/captures.md.
 * 2. Tells the model to move a secret-looking value into the vault.
 * 3. Injects the current date/time on rollover or after 90 minutes.
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

// Claude Code resumes a session by feeding synthetic blocks through this hook
// as if they were the owner's next message: a <task-notification> when a
// background agent stops, and the harness's own <system-reminder>s and command
// echoes. They are machine text. Everything this hook does asks "what did the
// owner just say", so the answer must not include text the owner never wrote —
// three task-notifications are sitting in one workspace's captures.md as notes
// because the word "kaydet" appears in the notification's own boilerplate, and
// a tool-use id matches looksSecret()'s 16+ mixed-case token rule. One strip at
// the point the prompt is parsed fixes both consumers, and any future one.
const SYNTHETIC = ['task-notification', 'system-reminder', 'local-command-stdout',
  'command-message', 'command-name', 'command-args'];
const SYNTHETIC_BLOCK = new RegExp(`<(${SYNTHETIC.join('|')})\\b[\\s\\S]*?<\\/\\1>`, 'gi');
// A block cut off by a size limit never closes, so an unterminated opener takes
// everything after it too — half a notification is no more owner text than all
// of one.
const SYNTHETIC_TAIL = new RegExp(`<(${SYNTHETIC.join('|')})\\b[\\s\\S]*$`, 'i');
function ownerText(prompt) {
  return prompt.replace(SYNTHETIC_BLOCK, ' ').replace(SYNTHETIC_TAIL, ' ').trim();
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

// A keyword followed by a value, or a 16+ character token mixing upper case
// and digits. A hint, not a detector: a false positive costs one line.
function looksSecret(p) {
  return /(?<![\p{L}\d])(şifre|parola|password|passwd|token|api[ _-]?key|secret|pin)\s*[:=]?\s*\S+/iu.test(p)
    || /\b(?=[A-Za-z0-9_\-[\]@!#$%^&*()]{16,}\b)(?=\S*[A-Z])(?=\S*\d)\S+/.test(p);
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
    if (raw) prompt = ownerText(String(JSON.parse(raw).prompt || ''));
  } catch { /* ignore malformed input */ }

  const now = new Date();
  const parts = [];

  const captured = maybeCapture(prompt, now);
  if (captured) parts.push(`[capture] Appended to .joserah/desk/inbox/captures.md:\n${captured}`);

  if (looksSecret(prompt)) {
    parts.push("[vault] This message may carry a password or token. If it does, save it first, without asking: `printf %s '<value>' | node .joserah/tools/secret.js --set <scope>.<system>.<field>`; then use it only as `$(node .joserah/tools/secret.js <name>)`, never write the value into a note or an answer, and tell the owner in one line which name it was saved under."
      + (captured ? ' The capture line above may hold the value too: replace it there with the name.' : ''));
  }

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
