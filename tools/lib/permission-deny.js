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

// Machine-control rules for a `guest` workspace: someone else's memory hosted
// on this machine, whose work stops at its own folder.
//
// IMPORTANT, and it must be said wherever this is documented: this is a
// GUARDRAIL, NOT A SANDBOX. Deny-by-enumeration cannot make Bash access
// impossible — absolute paths and unlisted tools bypass string matching. The
// load-bearing layers are the workspace's AGENTS.md/directives.md contract
// first, these rules second, and OS-level isolation (separate user account or
// container) third — only the third is an actual sandbox.
const GUEST_MACHINE_DENY = [
  'Bash(shutdown:*)', 'Bash(reboot:*)', 'Bash(halt:*)', 'Bash(poweroff:*)',
  'Bash(taskkill:*)', 'Bash(kill:*)', 'Bash(pkill:*)', 'Bash(killall:*)',
  'Bash(systemctl:*)', 'Bash(service:*)', 'Bash(sc:*)',
  'Bash(docker:*)', 'Bash(podman:*)', 'Bash(docker-compose:*)',
  'Bash(npm install -g:*)', 'Bash(pip install:*)', 'Bash(apt:*)',
  'Bash(apt-get:*)', 'Bash(choco:*)', 'Bash(winget:*)',
  // On Windows, these shells are the general-purpose escape hatch that makes the
  // individually-named machine-control rules above moot; without them, a guest can
  // bypass every one via powershell -Command "Stop-Computer" or other shell incantations.
  'Bash(powershell:*)', 'Bash(pwsh:*)', 'Bash(cmd:*)', 'Bash(wmic:*)',
];

// Claude Code accepts an absolute path rule as `//<drive>/<path>/**`; a
// Windows `d:/atay` therefore becomes `//d/atay/**`.
function toRulePath(p) {
  const norm = String(p).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1').replace(/\/+$/, '');
  return `//${norm.replace(/^\/+/, '')}/**`;
}

function denyFor(trust, opts = {}) {
  if (trust === 'owner') return PERMISSION_DENY.slice();
  if (trust !== 'guest') throw new Error(`unknown trust level: ${trust}`);
  const rules = PERMISSION_DENY.concat(GUEST_MACHINE_DENY);
  for (const p of opts.hostPaths || []) {
    const target = toRulePath(p);
    rules.push(`Read(${target})`, `Edit(${target})`, `Write(${target})`);
  }
  return rules;
}

module.exports = { PERMISSION_DENY, GUEST_MACHINE_DENY, denyFor };
