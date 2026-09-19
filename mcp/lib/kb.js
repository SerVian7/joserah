'use strict';
/**
 * The knowledge layer under the MCP tools: enumerate, search, read.
 *
 * It states no scope of its own. scanWorkspace() is the one place that says
 * which paths a Joserah tool may not walk — keys/, imports/, projects/,
 * .joserah/user/, .joserah/feedback/, a nested workspace, .git — and this
 * server reuses it so the MCP's reach can never drift from every other
 * tool's. personal/ IS in scope: native Joserah serves one machine and one
 * caller, its owner. Nothing here reaches the network, starts work of its own,
 * or writes anything.
 */
const fs = require('fs');
const path = require('path');
const { scanWorkspace } = require('../../tools/lib/workspace-scan');
const { parseFrontmatter } = require('../../tools/lib/note-format');

// A result over this size is cut (spec §1.8). The reserve keeps the cut
// notice itself inside the budget — the same shape as the hook layer's
// NOTICE_RESERVE, and for the same reason: a warning that overflows the
// thing it warns about is not a warning.
const MAX_CHARS = 64 * 1024;
const NOTICE_RESERVE = 256;

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---/;

function titleOf(rel, data, body) {
  if (typeof data.title === 'string' && data.title) return data.title;
  const h = /^#\s+(.+)$/m.exec(body);
  return h ? h[1].trim() : path.basename(rel, '.md');
}

/** Every in-scope note, read once, path-ascending (scanWorkspace sorts). */
function notes(root) {
  const out = [];
  for (const rel of scanWorkspace(root).files) {
    const abs = path.join(root, rel);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const { data, body } = parseFrontmatter(text);
    out.push({
      rel, abs, text, data, body,
      title: titleOf(rel, data, body),
      type: typeof data.type === 'string' ? data.type : '',
    });
  }
  return out;
}

/** The cheap orientation call: frontmatter only, never a body. */
function listNotes(root, { prefix = '', type = '' } = {}) {
  return notes(root)
    .filter((n) => n.rel.startsWith(prefix) && (!type || n.type === type))
    .map((n) => ({
      path: n.rel,
      title: n.title,
      type: n.type,
      modified: fs.statSync(n.abs).mtime.toISOString().slice(0, 10),
    }));
}

// How many lines the frontmatter block occupies, so a match inside it can be
// told from a match in the body without parsing twice.
function frontmatterLineCount(text) {
  const m = FM_RE.exec(text);
  return m ? m[0].split(/\r?\n/).length : 0;
}

/**
 * Case-insensitive substring match over title, frontmatter values and body.
 * Deterministic order: score (title hit > frontmatter hit > body hit), then
 * path ascending — so a client cache and a model's prompt cache both hold.
 *
 * ponytail: every in-scope file is read on every call. Add an index when the
 * corpus passes ~2,000 notes or a search exceeds ~300 ms; the index to add
 * then is SQLite FTS5, not embeddings.
 */
function searchNotes(root, { query, type = '', limit = 20 } = {}) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const n of notes(root)) {
    if (type && n.type !== type) continue;
    const lines = n.text.split(/\r?\n/);
    const fmLines = frontmatterLineCount(n.text);
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(q)) continue;
      const key = i < fmLines ? (/^([A-Za-z_][A-Za-z0-9_-]*):/.exec(lines[i]) || [])[1] : null;
      const score = i < fmLines ? (key === 'title' ? 3 : 2) : 1;
      if (!best || score > best.score) best = { score, i };
      if (score === 3) break;
    }
    if (!best) continue;
    hits.push({
      path: n.rel,
      title: n.title,
      type: n.type,
      line: best.i + 1,
      snippet: lines.slice(Math.max(0, best.i - 1), best.i + 2).join('\n'),
      score: best.score,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, Math.max(1, Number(limit) || 20)).map(({ score, ...hit }) => hit);
}

// The two-line header: the path a caller can hand straight back to kb_read,
// then title and type, then whatever else the note's own frontmatter carries,
// in the order the note wrote it. Nothing is invented and nothing is dropped.
function header(n) {
  const rest = Object.keys(n.data)
    .filter((k) => k !== 'title' && k !== 'type')
    .map((k) => ' · ' + k + ': ' + (Array.isArray(n.data[k]) ? n.data[k].join(', ') : n.data[k]))
    .join('');
  return 'path: ' + n.rel + '\n'
    + 'title: ' + n.title + ' · type: ' + (n.type || 'note') + rest + '\n'
    + '---\n';
}

// One heading's block: from that heading down to the next heading of the same
// or higher level. Matched on the heading's text, case-insensitively, because
// that is what the truncation notice hands a caller to retry with.
function sectionOf(body, heading) {
  const lines = body.split(/\r?\n/);
  const want = String(heading).trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m && m[2].toLowerCase() === want) { start = i; level = m[1].length; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

// Cut at a heading when one sits near the limit, otherwise at the last line
// break — a heading far above the limit would throw away most of the note to
// find a tidy edge. The notice names the next heading when there is one, so
// the caller has a usable way to get the rest and not merely the news that
// something is missing.
function truncate(text) {
  if (text.length <= MAX_CHARS) return text;
  const budget = MAX_CHARS - NOTICE_RESERVE;
  let at = text.lastIndexOf('\n#', budget);
  if (at < MAX_CHARS / 2) at = text.lastIndexOf('\n', budget);
  at = at > 0 ? at + 1 : budget;
  const next = (/^#{1,6}\s+(.+?)\s*$/m.exec(text.slice(at)) || [])[1] || '';
  return text.slice(0, at)
    + '\n[truncated — ' + (text.length - at) + ' more characters'
    + (next ? '; call kb_read with section: "' + next + '"]' : ']') + '\n';
}

/**
 * One note. `path` must be a path the scan produced — that single check is
 * also the containment check: a traversal, a secret, a foreign repository and
 * a typo all fail the same way, because none of them is in the scan.
 */
function readNote(root, { path: rel, section = '' } = {}) {
  const n = notes(root).find((x) => x.rel === rel);
  if (!n) return { error: 'no note at ' + rel + ' - call kb_list or kb_search for a path' };
  let body = n.body;
  if (section) {
    const found = sectionOf(n.body, section);
    if (found === null) return { error: 'no heading "' + section + '" in ' + rel };
    body = found;
  }
  return { text: truncate(header(n) + body) };
}

module.exports = { notes, listNotes, searchNotes, readNote, MAX_CHARS, NOTICE_RESERVE, FM_RE, titleOf };
