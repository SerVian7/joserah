#!/usr/bin/env node
/**
 * feedback.js — file a self-improvement note as a GitHub issue, or give up
 * quietly. See tools/lib/note-format.js for the note shape (renderFeedbackNote)
 * and the identifier scan (scanForIdentifiers); this tool never adds an escape
 * hatch around either — a note that would leak stays home.
 *
 *   node feedback.js --list <root>                     list unreported notes
 *   node feedback.js --report <file> --root <root>      file one via `gh`
 *
 * Exit 0 reported, 3 cannot report (no gh, not authenticated, network — the
 * owner said: report it if you can, and if you can't, let it go — no retry,
 * no advice, the local note untouched), 1 bad input (including a note that
 * would leak).
 *
 * Reporting goes through the `gh` CLI, never a stored token: the owner
 * already has to be a GitHub user for any of this to make sense, and Joserah
 * must never hold a credential of its own.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readConfig } = require('../hooks/lib/workspace');
const { parseFrontmatter, scanForIdentifiers, FEEDBACK_AREAS } = require('./lib/note-format');

// The plugin's OWN repository — feedback notes are about Joserah itself and
// are always reported here, never to whatever repository the owner's own
// workspace happens to live in.
const FEEDBACK_REPO = 'SerVian7/joserah';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// A note reached through --list/--report unreported when its `reported`
// frontmatter key is still the literal string the note format writes at
// render time (`reported: null`) — the frontmatter reader has no concept of
// JSON null, only the strings it finds after `key:`.
function isUnreported(data) {
  return !data.reported || data.reported === 'null';
}

function notesIn(root) {
  const out = [];
  for (const area of FEEDBACK_AREAS) {
    const areaDir = path.join(root, '.joserah', 'feedback', area);
    if (!fs.existsSync(areaDir)) continue;
    for (const f of fs.readdirSync(areaDir)) {
      if (!f.endsWith('.md')) continue;
      out.push(path.join(areaDir, f));
    }
  }
  return out;
}

if (args.list !== undefined) {
  const root = path.resolve(args.list);
  const unreported = notesIn(root).filter((p) => {
    const { data } = parseFrontmatter(fs.readFileSync(p, 'utf8'));
    return isUnreported(data);
  });
  if (unreported.length) console.log(unreported.join('\n'));
  process.exit(0);
}

// The exact bytes between one `## Heading` and the next (or end of file),
// trimmed. Feedback notes have a fixed, exhaustive set of headings (see
// renderFeedbackNote) — this is not a general markdown-section parser.
function extractSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^## ' + escaped + '\\s*$', 'm');
  const m = re.exec(body);
  if (!m) return '';
  const rest = body.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

// One line on stderr, no stack, no retry, no advice about installing
// anything: the give-up case is not an error, it is a shrug. The note on
// disk is never touched on this path — every call site below reaches this
// before any write.
function giveUp(why) {
  console.error(`feedback: could not report to ${FEEDBACK_REPO} via gh (${why}) — leaving the note as it is`);
  process.exit(3);
}

function badInput(why) {
  console.error(`feedback: ${why}`);
  process.exit(1);
}

if (args.report !== undefined) {
  if (!args.root) badInput('--report needs --root <workspace-root>');
  const file = path.resolve(args.report);
  if (!fs.existsSync(file)) badInput(`no such note file: ${file}`);
  const root = path.resolve(args.root);

  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  if (!FEEDBACK_AREAS.includes(data.area)) {
    badInput(`${file} has no valid feedback area in its frontmatter`);
  }

  // Re-scan before sending: this note may have reached disk by some route
  // other than renderFeedbackNote (hand-edited, restored, copied in), and it
  // must still never leave the machine carrying the owner's data. Only the
  // three prose sections are scanned — Redaction check is this tool's own
  // fixed boilerplate, not owner-authored content.
  const symptom = extractSection(body, 'Symptom');
  const cause = extractSection(body, 'Suspected cause');
  const suggestion = extractSection(body, 'Suggestion');
  const cfg = readConfig(root) || {};
  const hostsEntries = Array.isArray(cfg.hosts) ? cfg.hosts : [];
  const forbidden = [cfg.ownerName, cfg.workspaceName, cfg.assistantName, ...hostsEntries];
  const found = scanForIdentifiers([symptom, cause, suggestion].join('\n'), forbidden);
  if (found.length) {
    badInput(`refusing to report — needs redaction: found ${found.join(', ')}`);
  }

  const title = `feedback(${data.area}): ${symptom.replace(/\s+/g, ' ').trim().slice(0, 60)}`;
  const result = spawnSync('gh',
    ['issue', 'create', '--repo', FEEDBACK_REPO, '--title', title, '--body-file', file, '--label', 'feedback'],
    { encoding: 'utf8' });

  if (result.error) giveUp(result.error.code === 'ENOENT' ? 'gh not found on PATH' : result.error.message);
  if (result.status !== 0) {
    const line = (result.stderr || '').trim().split(/\r?\n/)[0] || `gh exited with status ${result.status}`;
    giveUp(line);
  }
  const urlMatch = /https:\/\/github\.com\/\S+/.exec(result.stdout || '');
  if (!urlMatch) giveUp('gh did not report an issue URL');

  const url = urlMatch[0];
  fs.writeFileSync(file, raw.replace('reported: null', 'reported: ' + url), 'utf8');
  console.log(url);
  process.exit(0);
}

badInput('usage: feedback.js --list <root> | --report <file> --root <root>');
