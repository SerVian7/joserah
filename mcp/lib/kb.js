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

module.exports = { notes, listNotes, MAX_CHARS, NOTICE_RESERVE, FM_RE, titleOf };
