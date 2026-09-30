'use strict';
/**
 * The narrowest text edit that lands one top-level key of .joserah/config.json
 * at a value and touches nothing else. config.json is a file the owner
 * hand-edits — inline arrays, unusual indentation, whatever they chose — and a
 * round-trip through JSON.stringify would reflow every one of those choices
 * just to stamp one key: the same class of harm note-format's ensureFrontmatter
 * refuses to do to a note, applied to JSON instead of a frontmatter block.
 *
 * Malformed JSON is not ours to repair — splicing text into a syntax error
 * risks compounding it into real corruption, and doctor.js already surfaces an
 * unparsable config as its own failing check — so it is returned unchanged.
 * `value` is a number or a string (rendered with JSON.stringify).
 */
function stampKey(text, key, value) {
  let cfg;
  try {
    cfg = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { text, changed: false };
  }
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
    return { text, changed: false };
  }
  if (cfg[key] === value) return { text, changed: false };

  const rendered = `${JSON.stringify(key)}: ${JSON.stringify(value)}`;

  // The key may already exist (just stale) — replace only its value, in
  // place, rather than treating "already present" the same as "missing".
  const escaped = JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`${escaped}\\s*:\\s*[^,}\\r\\n]*`);
  if (keyRe.test(text)) {
    return { text: text.replace(keyRe, rendered), changed: true };
  }

  // No existing key: insert one as the object's first property. The eol and
  // indent are read off the line the first existing key already sits on, so
  // a CRLF, tab-indented, or 4-space file gets a line in its own style
  // rather than an assumed one; an empty object falls back to a bare `\n`
  // with no indent, since there is no sibling line to match.
  const braceIdx = text.indexOf('{');
  const afterBrace = text.slice(braceIdx + 1);
  const lineMatch = /^(\r?\n)([ \t]*)/.exec(afterBrace);
  const trimmed = afterBrace.replace(/^\s+/, '');
  const hasSibling = trimmed.length > 0 && trimmed[0] !== '}';
  const eol = lineMatch ? lineMatch[1] : '\n';
  const indent = lineMatch ? lineMatch[2] : '';
  const insertion = lineMatch
    ? `${eol}${indent}${rendered}${hasSibling ? ',' : ''}`
    : `${rendered}${hasSibling ? ', ' : ''}`;
  return { text: text.slice(0, braceIdx + 1) + insertion + text.slice(braceIdx + 1), changed: true };
}

/**
 * The opposite edit: drop one top-level key (scalar value) and one adjoining
 * comma, nothing else. The result must parse and lack the key, or the text is
 * returned unchanged — same refusal as stampKey for anything it cannot account for.
 */
function removeKey(text, key) {
  let cfg;
  try { cfg = JSON.parse(text.replace(/^﻿/, '')); } catch { return { text, changed: false }; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || !(key in cfg)) return { text, changed: false };
  const k = JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const val = `${k}\\s*:\\s*[^,{}\\[\\]\\r\\n]*?`;
  for (const re of [
    new RegExp(`\\r?\\n[ \\t]*${val}\\s*,(?=\\s*\\r?\\n)`),   // own line, a key follows
    new RegExp(`${val}\\s*,\\s*`),                          // inline, a key follows
    new RegExp(`\\s*,\\s*${val}(?=\\s*\\})`),                // last key
    new RegExp(`${val}(?=\\s*\\})`),                         // the only key
  ]) {
    const out = text.replace(re, '');
    try {
      const c = JSON.parse(out.replace(/^﻿/, ''));
      if (out !== text && !(key in c)) return { text: out, changed: true };
    } catch { /* try the next shape */ }
  }
  return { text, changed: false };
}

module.exports = { stampKey, removeKey };
