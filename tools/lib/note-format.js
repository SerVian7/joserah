'use strict';
/**
 * The Joserah v2 note format. Pure functions only — no fs, no process.
 *
 * A note is: optional YAML frontmatter, then a markdown body containing
 * observations (`- [category] text`) and relations (`- relation_type [[Target]]`).
 *
 * The frontmatter reader is deliberately minimal: it understands `key: value`
 * and `key: [a, b]`, which is all the format uses. Anything it does not
 * understand is preserved verbatim rather than reformatted — a note may carry
 * arbitrary keys and this library must never mangle them. That includes line
 * endings: a CRLF source's pre-existing bytes are never rewritten to LF.
 */

// Group 1: the eol right after the opening fence. Group 2: the raw block
// content (no surrounding eol). Group 3: the eol right before the closing
// fence. Group 4: the (optional) eol right after the closing fence. Capturing
// these separately — instead of normalizing everything with a bare `\r?\n` —
// lets ensureFrontmatter splice new lines in using the exact eol already in
// use, rather than silently rewriting CRLF content to LF.
const FM_RE = /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n)?/;
const FM_START_RE = /^---\r?\n/;

// The note format version this library implements. doctor.js and migrate.js
// read this to decide whether a workspace's notes need migrating.
const FORMAT_VERSION = 2;

function parseScalar(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
  }
  return v.replace(/^["']|["']$/g, '');
}

function parseFrontmatter(text) {
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text, hasFrontmatter: false, rawBlock: null };
  const data = {};
  for (const line of m[2].split(/\r?\n/)) {
    const km = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (km) data[km[1]] = parseScalar(km[2]);
  }
  return { data, body: text.slice(m[0].length), hasFrontmatter: true, rawBlock: m[2] };
}

const MANAGED = ['title', 'type'];

function formatValue(v) {
  return Array.isArray(v) ? `[${v.join(', ')}]` : String(v);
}

// Line ending of the first line break found in `text`. Used to pick the eol
// for a brand-new frontmatter block on a document that has none yet, and by
// callers (e.g. migrate.js, before calling renderRelations) that append a new
// block onto an existing document — either way, so a CRLF document doesn't
// end up with an LF block glued onto CRLF content.
function detectEol(text) {
  const idx = text.indexOf('\n');
  return idx > 0 && text[idx - 1] === '\r' ? '\r\n' : '\n';
}

// A document that opens with a `---` fence line but never closes it is
// malformed. Rather than guess at a repair, ensureFrontmatter leaves it
// completely untouched — prepending a second, well-formed block on top of an
// unterminated one would only make the file worse (two stacked fences).
function isUnterminatedFrontmatter(text) {
  return FM_START_RE.test(text) && !FM_RE.test(text);
}

function ensureFrontmatter(text, defaults) {
  if (isUnterminatedFrontmatter(text)) return { text, changed: false };

  const m = FM_RE.exec(text);
  const parsed = parseFrontmatter(text);
  const missing = MANAGED.filter((k) => defaults[k] != null && !(k in parsed.data));
  if (!missing.length) return { text, changed: false };

  const added = missing.map((k) => `${k}: ${formatValue(defaults[k])}`);

  if (!m) {
    const eol = detectEol(text);
    return { text: `---${eol}${added.join(eol)}${eol}---${eol}${eol}${text}`, changed: true };
  }

  // Existing block: every original byte (opening fence, existing keys,
  // closing fence, body) is reused as-is from the source text. The missing
  // lines are spliced in right before the closing fence, joined with the
  // same eol the block itself already uses (group 1).
  const eol = m[1];
  const trailingEol = m[4] || '';
  return {
    text: `---${m[1]}${m[2]}${eol}${added.join(eol)}${m[3]}---${trailingEol}${parsed.body}`,
    changed: true,
  };
}

// Blank out fenced blocks and inline code, preserving line count, so a
// `[[Name]]` or link example inside backticks is never read as a real
// mention. Duplicated verbatim in tools/verify-links.js — see the comment
// there for why that copy cannot require this module.
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

const OBS_RE = /^\s*-\s+\[([A-Za-z][A-Za-z0-9_-]*)\]\s+(.+)$/;
const REL_RE = /^\s*-\s+(?:([A-Za-z][A-Za-z0-9_-]*)\s+)?\[\[([^\]]+)\]\]\s*(?:\(([^)]*)\))?\s*$/;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function splitContext(text) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(text);
  return m ? { content: m[1].trim(), context: m[2] } : { content: text.trim(), context: null };
}

function parseObservations(body) {
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const m = OBS_RE.exec(line);
    if (!m) continue;
    const { content, context } = splitContext(m[2]);
    const tags = (content.match(/#([A-Za-z0-9_-]+)/g) || []).map((t) => t.slice(1));
    out.push({ category: m[1], content, tags, context });
  }
  return out;
}

function parseRelations(body) {
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const m = REL_RE.exec(line);
    if (!m) continue;
    out.push({ type: m[1] || 'links_to', target: m[2].trim(), context: m[3] != null ? m[3] : null });
  }
  return out;
}

function extractWikilinks(text) {
  const seen = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const t = m[1].trim();
    if (!seen.includes(t)) seen.push(t);
  }
  return seen;
}

// `eol` defaults to '\n' so every existing caller and test — none of which
// pass a third argument — is unaffected. A caller appending this block onto
// an existing note passes that note's own eol (see detectEol) so a CRLF file
// does not end up with an LF-joined block glued onto CRLF content.
function renderRelations(relations, eol = '\n') {
  const lines = relations.map((r) =>
    `- ${r.type} [[${r.target}]]${r.context ? ` (${r.context})` : ''}`);
  return `${eol}## Relations${eol}${eol}${lines.join(eol)}${eol}`;
}

// A shared workspace is reached by several people over an access-controlled
// connection; every other kind has one owner at the keyboard. The role is
// derived, never asked separately — a second flag could contradict `kind`.
function roleFor(kind) {
  return kind === 'shared' ? 'server' : 'client';
}

module.exports = {
  parseFrontmatter, ensureFrontmatter, parseObservations, parseRelations,
  extractWikilinks, renderRelations, FORMAT_VERSION, stripCode, detectEol,
  roleFor,
};
