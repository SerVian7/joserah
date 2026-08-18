---
name: doctor
description: Use when a Joserah workspace misbehaves — hooks not firing, journal not created, links broken, placeholders still showing — or when the user asks to check, verify, or repair their workspace.
---

# Check a workspace

Diagnose, report, then offer to fix. Never repair silently.

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
- Windows only: hooks use exec form and need no shell, so a missing Git Bash
  is not the cause — look at Node instead.

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
