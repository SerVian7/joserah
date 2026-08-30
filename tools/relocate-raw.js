#!/usr/bin/env node
/**
 * relocate-raw.js — move a workspace's immutable source material from the
 * pre-2026-08-31 location (.joserah/knowledge/raw/) to raw/ at the workspace
 * root, and rewrite every markdown link that cited the old location.
 *
 * Deliberately NOT part of migrate.js: migrate's contract forbids editing the
 * owner's prose, and a link rewrite edits lines. This tool is opt-in, run
 * once, and mechanical — it changes link *paths* only, never link text.
 * The files inside raw/ itself are moved, never modified (immutability).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { scanWorkspace } = require('./lib/workspace-scan');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());

if (!fs.existsSync(path.join(root, '.joserah', 'config.json'))) {
  console.error(`relocate-raw: ${root} is not a Joserah workspace`);
  process.exit(1);
}

const oldRaw = path.join(root, '.joserah', 'knowledge', 'raw');
const newRaw = path.join(root, 'raw');

if (!fs.existsSync(oldRaw)) {
  console.log(JSON.stringify({ moved: false, linksRewritten: 0, notesTouched: 0 }));
  process.exit(0);
}
// scaffold.js (Tasks 1-3) already creates raw/README.md at the root of every
// new workspace, so newRaw existing with exactly that plugin-owned template
// file is the expected steady state going into a migration, not a conflict.
// Only owner content there (anything else) is a genuine collision. This
// guard is deliberately never loosened into a "resume" mode: a raw/ holding
// real content after a prior partial move looks identical, on disk, to a
// raw/ holding someone else's real content, and this tool must never guess
// which one it is looking at.
if (fs.existsSync(newRaw) && fs.readdirSync(newRaw).some((e) => e !== 'README.md')) {
  console.error('relocate-raw: raw/ already exists at the root and is not empty — resolve by hand first.');
  process.exit(1);
}

// Rewrite links first (against the still-existing old tree), then move.
// A markdown link is rewritten when its target resolves inside oldRaw. This
// is pure path-string arithmetic (path.resolve/relative), so it does not
// depend on oldRaw or newRaw actually existing on disk yet — only the note
// files themselves need to be readable.
const LINK = /\]\(([^)\s]+)\)/g;
let linksRewritten = 0;
let notesTouched = 0;
const edits = [];
const { files } = scanWorkspace(root);
for (const rel of files) {
  const abs = path.join(root, rel);
  const dir = path.dirname(abs);
  const text = fs.readFileSync(abs, 'utf8');
  const next = text.replace(LINK, (whole, href) => {
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith('#')) return whole;
    const target = path.resolve(dir, href.split('#')[0]);
    if (target !== oldRaw && !target.startsWith(oldRaw + path.sep)) return whole;
    const moved = path.join(newRaw, path.relative(oldRaw, target));
    let out = path.relative(dir, moved).split(path.sep).join('/');
    const hash = href.includes('#') ? '#' + href.split('#').slice(1).join('#') : '';
    linksRewritten++;
    return `](${out}${hash})`;
  });
  if (next !== text) { notesTouched++; edits.push([abs, next]); }
}

function sameContent(a, b) {
  return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
}

if (!dryRun) {
  // Three mutating stages, deliberately ordered so that a failure at each
  // one is either fully recoverable by re-running, or — where it cannot be
  // — says so plainly instead of promising a re-run the tool will refuse.
  //
  //  1. updating-gitignore — writing the raw/ exclusion is harmless and
  //     idempotent whether or not raw/ exists yet, so it goes first: if it
  //     fails, nothing else has happened, and "fix the issue and re-run" is
  //     simply true.
  //  2. writing-notes — pure path-string arithmetic against oldRaw/newRaw
  //     as strings (see above), independent of which one currently exists
  //     on disk. If this fails partway, the directory hasn't moved at all
  //     yet, so re-running is safe: notes already rewritten no longer match
  //     the oldRaw-prefix check and are left untouched the second time.
  //  3. moving-raw — this is the one stage a re-run genuinely cannot
  //     recover: once any entry has landed in newRaw, the guard above
  //     refuses every subsequent run (by design — it cannot tell a partial
  //     move from someone else's real content). A failure here is reported
  //     with exactly what moved, what didn't, and that the fix is a manual
  //     move, not another run of this tool.
  let stage = 'updating-gitignore';
  let notesWritten = 0;
  let preservedReadme = null;
  const movedEntries = [];
  try {
    const giPath = path.join(root, '.gitignore');
    const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
    if (!/^raw\/$/m.test(gi)) {
      fs.writeFileSync(giPath, gi.replace(/\s*$/, '\n') +
        '\n# Source material: originals the owner already holds elsewhere. Never in a repository backup.\nraw/\n');
    }

    stage = 'writing-notes';
    for (const [abs, next] of edits) {
      fs.writeFileSync(abs, next);
      notesWritten++;
    }

    stage = 'moving-raw';
    fs.mkdirSync(newRaw, { recursive: true });
    for (const entry of fs.readdirSync(oldRaw)) {
      const from = path.join(oldRaw, entry);
      const to = path.join(newRaw, entry);
      if (entry === 'README.md' && fs.existsSync(to)) {
        // The old tree may carry its own README.md from the pre-migration
        // template describing the old location — plugin-owned boilerplate,
        // safe to drop once it is byte-identical to the one already at the
        // new root. But .joserah/knowledge/ is otherwise owner-editable
        // prose everywhere else in this codebase, so a README.md that
        // differs (the owner annotated or extended it) is never deleted:
        // it is kept, under a name that cannot collide, and reported.
        if (sameContent(from, to)) {
          fs.rmSync(from);
        } else {
          const altTo = path.join(newRaw, 'README.old.md');
          if (fs.existsSync(altTo)) {
            throw new Error(`cannot preserve old raw/README.md — ${altTo} already exists; resolve by hand`);
          }
          fs.renameSync(from, altTo);
          preservedReadme = path.relative(root, altTo).split(path.sep).join('/');
        }
        movedEntries.push(entry);
        continue;
      }
      fs.renameSync(from, to);
      movedEntries.push(entry);
    }
    fs.rmdirSync(oldRaw);
  } catch (err) {
    console.error(JSON.stringify({
      error: true,
      stage,
      message: err.message,
      notesWritten,
      notesTotal: edits.length,
    }));
    if (stage === 'updating-gitignore') {
      console.error(
        'relocate-raw: failed while updating .gitignore — nothing else was touched. ' +
        'Fix the underlying issue and re-run.'
      );
    } else if (stage === 'writing-notes') {
      console.error(
        `relocate-raw: failed while rewriting note links (${notesWritten}/${edits.length} written) — ` +
        'the raw/ move was not started. Fix the underlying issue and re-run; notes already rewritten ' +
        'are left alone on the next run.'
      );
    } else {
      let remaining = [];
      try { remaining = fs.readdirSync(oldRaw); } catch (e2) { /* oldRaw itself is now unreadable or gone */ }
      console.error(
        'relocate-raw: the citing notes have already been rewritten to point at the new location, but ' +
        'moving raw/ itself failed partway.\n' +
        `  old (source):      ${oldRaw}\n` +
        `  new (destination): ${newRaw}\n` +
        `  already moved:     ${movedEntries.length ? movedEntries.join(', ') : '(none)'}\n` +
        `  still under old:   ${remaining.length ? remaining.join(', ') : '(none)'}\n` +
        'Re-running relocate-raw will be refused by design (the destination raw/ is no longer empty) — ' +
        'move the remaining entries into the destination by hand, then remove the old directory.'
      );
    }
    process.exit(1);
  }
  console.log(JSON.stringify({ moved: true, linksRewritten, notesTouched, preservedReadme }));
  process.exit(0);
}
console.log(JSON.stringify({ moved: false, linksRewritten, notesTouched, preservedReadme: null }));
