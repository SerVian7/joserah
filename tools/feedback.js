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
const { findWorkspace, readConfig } = require('../hooks/lib/workspace');
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

// A note is unreported when its `reported` frontmatter key is still the
// literal string the note format writes at render time (`reported: null`) —
// the frontmatter reader has no concept of JSON null, only the strings it
// finds after `key:`. Shared by --list and --report (fix round 1: --report
// used to skip this check entirely and would happily file a second issue for
// an already-reported note).
function isUnreported(data) {
  return !data.reported || data.reported === 'null';
}

// The exact line carrying the `reported:` key, wherever it sits in the
// frontmatter block, matched instead of a hardcoded `'reported: null'`
// literal so a note whose spacing has drifted from the shipped format still
// gets rewritten rather than silently failing to update. `$` in multiline
// mode stops right before a bare `\r` too, so replacing only what this
// matches (never rebuilding the surrounding text) preserves a CRLF note's
// line endings automatically.
const REPORTED_LINE_RE = /^reported:.*$/m;

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
// trimmed. Used only to build the issue title (the first 60 chars of the
// Symptom section) — NEVER part of the trust path. Fix round 1: the leak
// scan used to run over exactly these three extracted sections, which means
// anything appended to the file outside them (e.g. below the fixed
// Redaction-check heading) went unscanned yet was still uploaded whole via
// --body-file. The scan below runs over the raw file text instead; this
// helper survives only for the cosmetic title.
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

  // Resolved the same way tools/doctor.js finds a workspace — by walking up
  // from the given path — rather than trusting --root points exactly at
  // one. Fix round 1: a mistyped or misresolved --root used to fall through
  // readConfig's `null`-on-failure straight into `|| {}`, silently emptying
  // the forbidden-word vocabulary (no ownerName, no workspaceName, no
  // hosts) while the tool went on to report anyway. An unscannable note is
  // the single most dangerous state this tool can reach, so it is bad input
  // now, not a quiet downgrade.
  const root = findWorkspace(path.resolve(args.root));
  const cfg = root && readConfig(root);
  if (!cfg) badInput(`--root ${args.root} is not a readable Joserah workspace (no .joserah/config.json found)`);

  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  if (!FEEDBACK_AREAS.includes(data.area)) {
    badInput(`${file} has no valid feedback area in its frontmatter`);
  }
  // Fix round 1: re-reporting an already-reported note used to file a
  // second public issue and then silently keep the first URL on disk (the
  // `reported: null` replace was a no-op the second time, so the tool
  // printed the new URL and exited 0 while the file lied about which one it
  // actually held). Refused outright, same predicate --list uses.
  if (!isUnreported(data)) {
    badInput(`${file} is already reported (${data.reported}) — refusing to file a second issue for it`);
  }
  // A note that somehow has no `reported:` line at all (hand-edited, or
  // frontmatter otherwise damaged) must not let a failed rewrite pass as
  // done — checked before gh is ever called, not after.
  if (!REPORTED_LINE_RE.test(raw)) {
    badInput(`${file} has no "reported:" line to update — refusing to report without a way to record it`);
  }

  // `hosts` is a real, populated field in at least one live workspace (an
  // array of relative paths) — a present-but-wrong-typed value must say
  // something rather than silently collapsing to an empty vocabulary. `null`
  // is treated the same as absent, not as wrong-typed: this config file's
  // own idiom uses `null` for "not yet set" (see `lastBackup`), so a future
  // writer following that convention must not break --report for no reason.
  // A string, a number, or anything else that isn't an array is genuinely
  // the wrong shape and is still refused.
  let hostsEntries;
  if (cfg.hosts === undefined || cfg.hosts === null) {
    hostsEntries = [];
  } else if (Array.isArray(cfg.hosts)) {
    hostsEntries = cfg.hosts;
  } else {
    badInput(`config.json's "hosts" field is present but not an array (got ${typeof cfg.hosts}) — refusing to scan with an incomplete vocabulary`);
  }
  const forbidden = [cfg.ownerName, cfg.workspaceName, cfg.assistantName, ...hostsEntries];

  // Re-scan before sending: this note may have reached disk by some route
  // other than renderFeedbackNote (hand-edited, restored, copied in), and it
  // must still never leave the machine carrying the owner's data. Scanned as
  // the raw file text — exactly the bytes --body-file below hands to gh — so
  // "scanned" and "published" are always the same string, frontmatter and
  // headings included.
  const found = scanForIdentifiers(raw, forbidden);
  if (found.length) {
    badInput(`refusing to report — needs redaction: found ${found.join(', ')}`);
  }

  const symptom = extractSection(body, 'Symptom');
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
  fs.writeFileSync(file, raw.replace(REPORTED_LINE_RE, 'reported: ' + url), 'utf8');
  console.log(url);
  process.exit(0);
}

badInput('usage: feedback.js --list <root> | --report <file> --root <root>');
