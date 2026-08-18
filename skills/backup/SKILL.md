---
name: backup
description: Use when someone wants to back up, archive, export, or restore a Joserah workspace, move it to another machine, or asks how to get their data out.
---

# Back up and restore a workspace

The workspace is files the owner owns, so it has to be movable. This produces a
single ZIP any tool can open, and puts one back on a new machine.

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

## Backing up

1. Ask where the archive should go. Default: the owner's home directory, named
   `joserah-<workspace>-<YYYY-MM-DD>.zip`. Never write it *inside* the
   workspace — a backup that lives in the thing it backs up is not a backup.
   Resolve `~` yourself — do not pass a literal `~` to the archive script; Node
   does not expand it.
2. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" create <workspace> <out.zip>`
3. Show the owner what went in:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" list <out.zip>` — report the
   file count and the top-level folders, not the full listing.
4. Say plainly what was **excluded**: `keys/`, every environment file (`.env`,
   `.env.local`, `.env.production`, `.envrc` and anything matching `*.env` or
   `*.env.*`, except `.env.example` files), and everything under `projects/`
   and `docker-stack/`. Credentials are deliberately left behind. Say the
   `projects/` part precisely: a real code checkout there carries its own git
   history, but **notes Joserah itself wrote** under `projects/` — a
   `docs/status.md` from `/joserah:import`, for instance — are in no backup at
   all. If they have any, say so plainly rather than reassuring them.

### If they ask for credentials to be included

`--include-keys` exists. Before using it, say once and clearly: the archive
will then contain live credentials, so it must be stored somewhere they would
be willing to store a password file, and it must never be committed, synced,
emailed or uploaded. If they still want it, do it.

## Restoring

1. The target directory must be empty or non-existent. If it already holds a
   workspace, stop and ask — restoring over live files destroys work.
2. `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" extract <in.zip> <target>`
3. Run `node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <target>` and report the
   result. A restored workspace that fails doctor is not restored.
4. If `.claude/settings.json` is missing from the archive (older backup), do
   not write the permission rules by hand and do not copy them out of another
   workspace — re-run the scaffold's own settings step, which is where the
   rules actually live (`tools/scaffold.js`, `PERMISSION_DENY`):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --settings-only --target <target>
   ```

   It writes nothing else, and refuses if a `settings.json` is already there.
   Then re-run doctor: `exists: .claude/settings.json` must be `ok`, because
   those rules are what keeps `keys/` unreadable.

## Rules

- Never write the archive inside the workspace.
- Never restore over an existing workspace without explicit confirmation.
- Report in the owner's dialogue language, from `.joserah/config.json`.
- If the owner wants the backup to live on another machine automatically, that
  is `/joserah:sync`, not this skill.
