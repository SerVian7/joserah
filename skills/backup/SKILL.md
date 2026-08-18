---
name: backup
description: Use when someone wants to back up, archive, export, or restore a Joserah workspace, move it to another machine, or asks how to get their data out.
---

# Back up and restore a workspace

The workspace is files the owner owns, so it has to be movable. This produces a
single ZIP any tool can open, and puts one back on a new machine.

## Backing up

1. Ask where the archive should go. Default: the owner's home directory, named
   `joserah-<workspace>-<YYYY-MM-DD>.zip`. Never write it *inside* the
   workspace — a backup that lives in the thing it backs up is not a backup.
2. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" create <workspace> <out.zip>`
3. Show the owner what went in:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" list <out.zip>` — report the
   file count and the top-level folders, not the full listing.
4. Say plainly what was **excluded**: `keys/`, every `.env`, and everything
   under `projects/` and `docker-stack/`. Projects carry their own git history;
   credentials are deliberately left behind.

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
4. If `.claude/settings.json` is missing from the archive (older backup), write
   the permission rules again — `install` has the exact set.

## Rules

- Never write the archive inside the workspace.
- Never restore over an existing workspace without explicit confirmation.
- Report in the owner's dialogue language, from `.joserah/config.json`.
- If the owner wants the backup to live on another machine automatically, that
  is `/joserah:sync`, not this skill.
