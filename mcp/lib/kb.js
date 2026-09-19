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

module.exports = { notes, listNotes, searchNotes, MAX_CHARS, NOTICE_RESERVE, FM_RE, titleOf };
