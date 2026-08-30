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

// Line ending of the first line break found in `text`. Used only to pick the
// eol for a brand-new frontmatter block on a document that has none yet, so a
// CRLF document doesn't end up with an LF block glued onto CRLF content.
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

module.exports = { parseFrontmatter, ensureFrontmatter };
