'use strict';
// INTERIM (2026-10-05): the shared Theme still lives in the Tracker — its token block in
// templates/tracker/index.html, its console rules and clamp script in tools/tracker.js. Until the
// Theme moves here (spec 2026-10-05-trail-design.md, "Theme", option A), this module reads those
// bits from where they are, without changing them.
const fs = require('fs');
const path = require('path');
const { CONSOLE_CSS, CLIP_JS } = require('../tracker');

const TOKENS_RE = /:root\{color-scheme[^\n]*\n@media \(prefers-color-scheme: dark\)[^\n]*\n:root\[data-theme="dark"\][^\n]*/;

function tokens() {
  const tpl = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'tracker', 'index.html'), 'utf8');
  const m = tpl.match(TOKENS_RE);
  if (!m) throw new Error('theme: token block not found in templates/tracker/index.html');
  return m[0];
}

// the console rules any page shares: the mono font, no radius or shadow, group heads, the clamp
const BASE_CSS = CONSOLE_CSS.split('\n')
  .filter((l) => /^(:root\{--mono|\*,\*::before|\.hd|summary\.hd|\.clip|@media \(prefers-reduced-motion: no-preference\)|\.fade|\.more)/.test(l))
  .join('\n');

const css = () => `${tokens()}\n${BASE_CSS}`;

module.exports = { css, CLIP_JS };
