---
name: doctor
description: Use when a Joserah workspace misbehaves — hooks not firing, journal not created, links broken, placeholders still showing — or when the user asks to check, verify, or repair their workspace.
---

# Check a workspace

Diagnose, report, then offer to fix. Never repair silently.

> **Running the plugin's tools.** The commands here use
> `${CLAUDE_PLUGIN_ROOT}`. That expands in bash; in PowerShell it is variable
> syntax, not an environment lookup, and expands to nothing — leaving you
> running `node "/tools/…"`. Verify the path before relying on it:
> `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" "<path>"`.
> If it is empty or missing, locate the plugin under the user's Claude plugin
> cache — `~/.claude/plugins/cache/<marketplace>/joserah/<version>/`, on
> Windows `%USERPROFILE%\.claude\plugins\cache\…` — and use that absolute
> path. A command that failed because the path was empty is a failure: say so
> rather than reporting the step as done.

## 1. Run the checks

```
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js"
```

It verifies: the marker is present and readable, Node is ≥ 18, the core files
exist, no `{{placeholder}}` survives, and every internal link resolves.

## 2. Check the hooks are actually firing

Look at the current session's context for a `## Joserah session context`
block. If it is absent in a workspace that doctor says is healthy:

- Confirm the plugin is enabled: `/plugin`
- Confirm Node is on PATH *for the hook*, not just the shell: `node --version`
- Windows only: hooks are run through **bash**, which on Windows comes from Git
  for Windows. If `bash --version` fails, that is the cause — install Git for
  Windows and restart Claude Code. Check Node second.

## 3. Report

One line per failed check, in the owner's language, saying what is broken and
what fixes it. If everything passes, say so in one sentence and stop.

## 4. Fix, with permission

Propose the specific repair for each failure and wait for a yes:

| Failure | Repair |
|---|---|
| Missing core file | Recreate it from the plugin's `templates/` |
| Unfilled placeholder | Ask for the value, then substitute it |
| Broken link | Find the moved target and repoint the link |
| Stale workspace version | Say which plugin version created it; nothing to do unless something is broken |

Re-run doctor after any repair. Do not claim it is fixed until it exits 0.
