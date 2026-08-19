'use strict';
// Credential-shaped substrings, masked mechanically before any text lands in
// a tracked file. Best-effort, not a guarantee.
const SPECIFIC = [
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]'],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b(?:sk|pk)[-_][A-Za-z0-9_-]{8,}/gi, '[redacted]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{8,}/g, '[redacted]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/gi, '[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]'],
  [/\bAIza[A-Za-z0-9_-]{16,}/g, '[redacted]'],
];
// Anything long and random-looking that survived the rules above. Git SHAs
// (40 hex chars) are the one common long token that is NOT a secret — keep
// them legible in captures.
const CATCH_ALL = /\b[A-Za-z0-9_-]{32,}\b/g;

function redact(text) {
  let out = text;
  for (const [re, replacement] of SPECIFIC) out = out.replace(re, replacement);
  out = out.replace(CATCH_ALL, (m) => (/^[0-9a-f]{40}$/i.test(m) ? m : '[redacted]'));
  return { text: out, redacted: out !== text };
}

module.exports = { SPECIFIC, CATCH_ALL, redact };
