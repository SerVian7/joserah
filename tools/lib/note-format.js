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

// Feedback notes are about the plugin's own prompts and structure — never
// about the owner's work. `structure` covers anything about the shape of the
// workspace or its files; `prompt` covers anything about what an agent was
// told. An unknown area is refused rather than guessed, same discipline as
// `roleFor`/`kind` above: the caller must say which, not have one invented.
const FEEDBACK_AREAS = ['prompt', 'structure'];

// Turkish letters the owner's own names actually use (ş, ğ, ı, İ) sit outside
// the Latin-1 ranges (À-Þ / ß-ÿ) a Western-only draft of this regex would
// reach for. Ç, Ö, Ü are already inside those ranges; only these three pairs
// needed adding. Leaving them out would mean a name written in the owner's
// own working language could slip past the scan that a Western name could not.
const TR_UPPER = 'ĞİŞ';
const TR_LOWER = 'ğış';
const CAP = `A-ZÀ-Þ${TR_UPPER}`;
const LOW = `a-zß-ÿ${TR_LOWER}`;

// `\b` is defined against ASCII `\w` only: it never fires next to a
// non-ASCII letter (İrem, Şahin, ...), and it never fires between two
// non-word characters either (the trailing edge of "c++" sits between '+'
// and a space — both non-word to `\b`, so no boundary exists there at all).
// One shared boundary, used everywhere below a hand-written `\b` used to be,
// closes both gaps at once: it only checks the character actually adjacent
// to the match, in either direction, against this extended "is a letter"
// set — never the ASCII-only, transition-based logic `\b` relies on.
const WORD_CHARS = `0-9A-Za-zÀ-ÿ${TR_UPPER}${TR_LOWER}_`;
const NOT_BEFORE = `(?<![${WORD_CHARS}])`;
const NOT_AFTER = `(?![${WORD_CHARS}])`;

// A name-shaped word is either TitleCase (one capital, then lowercase) or
// ALL CAPS with no lowercase at all — a shouted name in a quoted subject
// line or a signature block has no lowercase run for a TitleCase-only
// pattern to find. The ALL-CAPS alternative alone (`{2,}`) also matched any
// two adjacent acronyms — "API URL", "HTML CSS", "TODO LIST" — because
// acronyms are the native vocabulary of a note type that is feedback about a
// piece of software's prompts and structure. Tried and measured: real given
// names/surnames (Sevgi, Akkaya, Durmuş, Kabak — and Turkish ones tend to
// run long) are reliably 5+ letters, while the common short acronyms this
// note type actually needs to say out loud (API, URL, CSS, TODO, LIST,
// JSON, YAML, HTTP, FAQ) are almost universally ≤4. A length floor of 5 on
// the ALL-CAPS alternative separates the two required sets cleanly (see the
// round-2 report for the full checked list) without a hardcoded acronym
// list that would need maintaining forever. It does not separate them
// perfectly — a genuinely long acronym pair ("GRAPHQL SCHEMA", "OAUTH
// TOKEN") still reads as a name, and a short all-caps name in this or any
// language still slips through — both are disclosed, deliberate residual
// gaps, not oversights.
const NAME_WORD = `(?:[${CAP}][${LOW}]+|[${CAP}]{5,})`;

// What a leak out of a real workspace actually looks like. This is a
// guardrail, not a redactor: it refuses text that looks like it carries
// someone's data, and it is deliberately noisy — a false positive costs one
// rewrite, a false negative sends a stranger's name to a public issue
// tracker. Given that asymmetry, every check below is written to fail toward
// "flag it", never toward "let it through".
function scanForIdentifiers(text, forbidden) {
  const found = [];
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text)) found.push('an address');
  // A bare @handle (a social or GitHub mention, no dotted domain after it)
  // identifies a person as surely as an email does, and the address check
  // above never fires for one — it needs its own. The lookbehind excludes
  // the local-part case ("user@example.com") so a real email isn't also
  // double-tagged as a handle; that's cosmetic, not a correctness issue.
  if (/(?<![A-Za-z0-9._%+-])@[A-Za-z0-9_-]{2,}\b/.test(text)) found.push('a handle');
  // Scheme-less links, in addition to http(s)://: either a www.-prefixed
  // host, or a dotted host immediately followed by a path. The bare-domain
  // alternative is deliberately narrower than "any dotted.word" — that would
  // also flag ordinary filenames like note-format.js or SKILL.md, which are
  // exactly the kind of thing structure feedback needs to be able to name.
  if (/\bhttps?:\/\/\S+/.test(text)
    || /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\S*/i.test(text)
    || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S+/i.test(text)) found.push('a link');
  // Fix round 2 (Task 19 review): a same-line-only separator (`[ \t]+`)
  // closed the heading+paragraph false positive (previous comment, kept
  // below in spirit) but reopened a real gap — a hard-wrapped signature or
  // an 80-column copy-paste ("Kindest regards,\nSevgi\nAkkaya", "written by
  // Sevgi\nAkkaya during review.") splits a real name across exactly one
  // line break with no blank line in between, and that used to scan clean.
  // NAME_SEP now allows same-line whitespace, OR same-line whitespace plus
  // exactly one line break plus more same-line whitespace — never two, so a
  // heading followed by a blank line and then a paragraph
  // (`## Symptom\n\nThe assistant...`) still fails to match: after the one
  // required `\n` is consumed, the second NAME_WORD must start immediately,
  // but a blank line puts another line break there instead of a letter.
  const NAME_SEP = '(?:[ \\t]+|[ \\t]*\\r?\\n[ \\t]*)';
  if (new RegExp(NOT_BEFORE + NAME_WORD + NAME_SEP + NAME_WORD + NOT_AFTER).test(text)) {
    found.push('a personal name');
  }
  // Matched per quote family (straight ", curly “...”, straight ', curly
  // '...') rather than one class that excludes all delimiter characters
  // from the content: the original draft excluded the straight apostrophe
  // from *content* too, so a quoted sentence with a contraction ("don't",
  // "it's" — nearly all of them) broke the 120-char run and slipped through
  // unflagged. Matching each family on its own keeps that false negative
  // from happening for the quote kinds that don't also serve double duty as
  // an apostrophe.
  if (/"[^"]{120,}"|“[^”]{120,}”|'[^']{120,}'|‘[^’]{120,}’/.test(text)) found.push('a long quotation');
  for (const w of forbidden || []) {
    if (!w) continue;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(NOT_BEFORE + escaped + NOT_AFTER, 'i').test(text)) {
      found.push('a workspace word (' + w + ')');
    }
  }
  return found;
}

// A pure function that refuses to render rather than one that promises to
// redact: the guarantee lives in code that throws, not in an agent's good
// behaviour. The five sections below are fixed and exhaustive — there is no
// free-form region for real-world data to leak into.
function renderFeedbackNote(fields, forbidden) {
  const { area, created, symptom, cause, suggestion } = fields || {};
  if (!FEEDBACK_AREAS.includes(area)) {
    throw new Error('unknown feedback area: ' + area + ' (expected ' + FEEDBACK_AREAS.join(' or ') + ')');
  }
  for (const [k, v] of Object.entries({ created, symptom, cause, suggestion })) {
    if (typeof v !== 'string' || !v.trim()) throw new Error('empty feedback field: ' + k);
  }
  const found = scanForIdentifiers([symptom, cause, suggestion].join('\n'), forbidden);
  if (found.length) {
    throw new Error('refusing to render: needs redaction — found ' + found.join(', '));
  }
  return [
    '---',
    'type: feedback',
    'area: ' + area,
    'formatVersion: ' + FORMAT_VERSION,
    'created: ' + created,
    'reported: null',
    '---',
    '',
    '## Symptom',
    '',
    symptom.trim(),
    '',
    '## Suspected cause',
    '',
    cause.trim(),
    '',
    '## Suggestion',
    '',
    suggestion.trim(),
    '',
    '## Redaction check',
    '',
    'Scanned for: names, addresses, links, quotations, workspace words. Nothing found.',
    '',
  ].join('\n');
}

module.exports = {
  parseFrontmatter, ensureFrontmatter, parseObservations, parseRelations,
  extractWikilinks, renderRelations, FORMAT_VERSION, stripCode, detectEol,
  roleFor, FEEDBACK_AREAS, scanForIdentifiers, renderFeedbackNote,
};
