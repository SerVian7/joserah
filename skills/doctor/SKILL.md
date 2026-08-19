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
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>
```

Pass the workspace path explicitly — cwd may be anywhere. It verifies: the marker is present and readable, Node is ≥ 18, the core files
exist, no `{{placeholder}}` survives, and every internal link resolves.

## 2. Check the hooks are actually firing

Look at the current session's context for a `## Joserah session context`
block. If it is absent in a workspace that doctor says is healthy:

- Ask the user to run `/plugin` and read you the result — slash commands
  are theirs to run, not yours.
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
| Missing core file (other than `keys/AGENTS.md`) | Recreate it from the plugin's `templates/`. Templates carry `{{OWNER_ROLE_LINE}}`, which config.json does not store — ask the owner for it; if they decline, substitute an empty string. Never invent it. |
| `exists: keys/AGENTS.md` FAIL | **Do not read-then-write this one.** The workspace's `Read(./keys/**)` deny rule matches a `keys/` directory at any depth — including the plugin's own `templates/keys/`, per the README's Security section — so a normal read of the template fails with a confusing denial. Copy the file instead, without ever reading its content into the conversation: `cp "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" <workspace>/keys/AGENTS.md` (PowerShell: `Copy-Item "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" "<workspace>/keys/AGENTS.md"`). |
| Unfilled placeholder | Ask for the value, then substitute it |
| Broken link | Find the moved target and repoint the link |
| `no legacy .joserah/keys directory` FAIL | Run the Migrate section below. |
| `local verify-links.js current` FAIL | Copy the plugin's `tools/verify-links.js` over `.joserah/tools/verify-links.js`, then re-run doctor. |

Re-run doctor after any repair. Do not claim it is fixed until it exits 0.

## Migrate a pre-0.3.0 workspace

Doctor's `no legacy .joserah/keys directory` check fails on workspaces
created before 0.3.0. The move, in order, with the owner watching:

1. `mkdir <workspace>/keys` (skip if it exists).
2. Move the contents without reading them:
   `git -C <workspace> mv .joserah/keys/AGENTS.md keys/AGENTS.md` if that
   file is tracked, then move the rest with a plain rename (`mv`/`Move-Item`)
   and remove the empty `.joserah/keys/`.
3. Update `.gitignore`: replace `.joserah/keys/*` and `!.joserah/keys/AGENTS.md`
   with `keys/*` and `!keys/AGENTS.md`; make sure the env family
   (`.env`, `.env.*`, `*.env`, `*.env.*`, `.envrc`, `*.envrc`) is present.
4. Re-write the deny rules: `node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js"
   --settings-only --target <workspace> --force` — with `--force` because a
   settings.json with the OLD paths exists; show the owner the diff first.
5. Refresh the local link checker: copy the plugin's `tools/verify-links.js`
   over `.joserah/tools/verify-links.js`.
6. Anything else in the workspace that names `.joserah/keys` (its AGENTS.md,
   an `.mcp.json` mount, notes) — find with a grep scoped to markdown/config
   files, never `keys/` or an env file, so it can never surface a credential's
   contents — and update each with the owner, since some of those files are
   theirs, not the plugin's.
7. Re-run doctor with the path; every check `ok` or the migration is not done.
