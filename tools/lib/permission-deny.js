'use strict';
// The single source of truth for the keys deny rules. scaffold.js writes them;
// doctor.js verifies them. Deny-by-enumeration cannot make Bash access
// impossible (absolute paths and unlisted tools bypass string matching) — the
// load-bearing layers are the Read() rule plus the workspace AGENTS.md
// instruction. These Bash rules only catch the most common accidental reads.
const PERMISSION_DENY = [
  'Read(./keys/**)',
  'Bash(cat ./keys/**)', 'Bash(less ./keys/**)', 'Bash(head ./keys/**)',
  'Bash(tail ./keys/**)', 'Bash(strings ./keys/**)',
  'Bash(type ./keys/**)', 'Bash(Get-Content ./keys/**)', 'Bash(gc ./keys/**)',
];
module.exports = { PERMISSION_DENY };
