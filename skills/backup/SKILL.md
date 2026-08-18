---
name: backup
description: Use when someone wants to back up, archive, export, mirror, or restore a Joserah workspace, move it to another machine, sync it across machines, or asks how to get their data out.
---

# Back up a workspace

The workspace is files the owner owns, so getting them out — to a single
file, or to a second machine — has to be reliable. This is one skill with two
destinations: a ZIP any tool can open, or a private git repository. Pick one
before doing anything else.

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

## 1. Ask first, always

Two questions, before touching anything:

1. **Zip, or a private repository?** A zip is a one-time, local snapshot.
   A repository keeps two or more machines in sync going forward, and is
   opt-in and consequential — it puts the owner's journal, their notes about
   the people around them, and everything in `.joserah/personal/` on a third
   party's server, even a private one they control. If they only want a
   safety copy, the zip is the smaller, safer answer — say so if they seem
   unsure.
2. **What to include?**
   - *(a)* **The workspace only** — the default, and what the exclusions
     below already do.
   - *(b)* **Workspace plus a description of the projects** — names,
     remotes, one-line summaries, but never their contents.

   Never offer to archive project contents themselves, in either scope:
   `projects/` and `docker-stack/` carry their own git history (or none at
   all), and the owner has said they are not to be backed up here. Scope
   *(b)* only ever adds a *description* of what was left out — see the
   manifest below, which is written on every backup regardless of scope.

Never produce an artifact before both answers are in.

## 2. Write the skipped-work manifest

Every backup — zip or repository — writes `.joserah/backup-manifest.md` into
the workspace before the snapshot is taken, so the archive is self-describing
about what it did **not** take. Head it plainly: these directories were not
backed up, and where they live instead.

```markdown
# Backup manifest — <YYYY-MM-DD>

Route: zip | repository
Files: <count> (<size>)

## Not included in this backup

`projects/` and `docker-stack/` are excluded by standing rule: a real
checkout carries its own git history, and runtime state is not knowledge.
Each is listed below by name, with its git remote if it has one and a
one-line description if one could be found — never invented.

### projects/
- <name> — <remote or "no remote"> — <description, or omit the dash-phrase entirely if none was found>
### docker-stack/
- <name> — <remote or "no remote">
```

For each directory one level directly under `projects/` and one level
directly under `docker-stack/`:

- **Remote:** `git -C <dir> remote get-url origin`. If that fails (not a
  repo, no `origin`, git itself missing), write "no remote" — never treat the
  failure as an error, just an absent fact.
- **Description:** read `<dir>/README.md` first, then `<dir>/AGENTS.md` if
  there is no README, and take the first Markdown H1 (`# …`) if either file
  exists and has one. If neither file exists, or neither has a heading, write
  nothing for that directory rather than a guess — **never invent a
  description**.
- If a directory yields neither a remote nor a description, still list it by
  name and say plainly that nothing else is known about it. A directory that
  is silently absent from the manifest is the one failure mode this exists to
  prevent.

Fill in the date, the route, and the file count and size from whichever
route follows — write the manifest last, right before the snapshot step, once
those numbers are known.

## 3a. Zip route

1. Ask where the archive should go. Default: the owner's home directory,
   named `joserah-<workspace>-<YYYY-MM-DD>.zip`. Never write it *inside* the
   workspace — a backup that lives in the thing it backs up is not a backup.
   Resolve `~` yourself — do not pass a literal `~` to the archive script;
   Node does not expand it.
2. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" create <workspace> <out.zip>`
3. Show the owner what went in:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" list <out.zip>` — report the
   file count and the top-level folders, not the full listing.
4. Say plainly what was **excluded**: `.joserah/keys/`, every environment file
   (`.env`, `.env.local`, `.env.production`, `.envrc` and anything matching
   `*.env` or `*.env.*`, except `.env.example` files), everything under
   `projects/` and `docker-stack/`, and `.superpowers/` scratch. Credentials
   are deliberately left behind. Point at the manifest (step 2) for exactly
   what the `projects/`/`docker-stack/` exclusion left out by name.

### If they ask for credentials to be included

`--include-keys` exists, **zip only** — never for the repository route, where
credentials would then sit in git history on someone else's server forever.
Before using it, say once and clearly: the archive will then contain live
credentials, so it must be stored somewhere they would be willing to store a
password file, and it must never be committed, synced, emailed or uploaded.
If they still want it, do it.

## 3b. Repository route

### First use — the safety gate

Run every check. If any fails, stop and fix it first; do not proceed and
warn. These use git's own pathspec matching — no external tool, so they
behave identically everywhere, including plain PowerShell where `grep` does
not exist. Empty output means pass. If a check cannot be run at all (git
missing, command errors), that counts as a **failed** check — never treat a
check that did not run as a pass.

1. `git -C <workspace> ls-files -- ".joserah/keys/" ":(exclude).joserah/keys/AGENTS.md"`
   → must print nothing. `.joserah/keys/AGENTS.md` is tracked on purpose — it
   is the documentation file that tells assistants never to read that folder
   — so it is excluded from the check. **Anything else** printed under
   `.joserah/keys/` is a real violation: a credential is in git history.
2. `git -C <workspace> ls-files -- "*.env" "*.env.*" "*.envrc" ":(exclude)*.env.example"`
   → must print nothing. The wildcards match at any depth, so this covers
   `.env`, `.env.local`, `.env.production`, `config/.envrc` and the rest;
   `.env.example` and `*.env.example` are documentation and are allowed.
3. `.gitignore` contains `.joserah/keys/*`, `.env`, `.env.*`, `*.env`,
   `.envrc`, `projects/*` and `docker-stack/*`.
4. The remote the owner names is **private**. Ask directly; if they are not
   sure, have them check before continuing. Do not guess from the URL.

Then say this once, in their language, and get an explicit yes: a private
repository is still a third party storing their journal, their notes about
people, and whatever is in `.joserah/personal/`.

```
git -C <workspace> init            # if not already a repo
git -C <workspace> add -A
git -C <workspace> commit -m "workspace snapshot"
git -C <workspace> remote add origin <private-remote>
git -C <workspace> branch -M main
git -C <workspace> push -u origin main
```

**Pushing is the owner's decision every time.** Show the command and let them
run it, or ask before running it yourself. Never push unprompted.

### Second machine

```
git clone <private-remote> <target>
```
Then `node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <target>`.

### Later use

Report what changed since `lastBackup` (`.joserah/config.json`) with a file
count and a size, then ask before pushing:

- Before working: `git -C <workspace> pull --rebase`
- After working: show the diff summary, then commit and offer to push.
- On conflict: markdown conflicts are resolved by reading both sides, never
  by taking one wholesale. Journal entries for the same day append; task
  lists merge line by line. Never resolve a conflict in `.joserah/personal/`
  without showing the owner both versions.

## 4. Restore

1. The target directory must be empty or non-existent. If it already holds a
   workspace, stop and ask — restoring over live files destroys work.
2. Zip: `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" extract <in.zip> <target>`.
   Repository: `git clone <private-remote> <target>`.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <target>` and report the
   result. A restored workspace that fails doctor is not restored.
4. If `.claude/settings.json` is missing from the restore (older backup), do
   not write the permission rules by hand and do not copy them out of another
   workspace — re-run the scaffold's own settings step, which is where the
   rules actually live (`tools/scaffold.js`, `PERMISSION_DENY`):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --settings-only --target <target>
   ```

   It writes nothing else, and refuses if a `settings.json` is already there.
   Then re-run doctor: `exists: .claude/settings.json` must be `ok`, because
   those rules are what keeps `.joserah/keys/` unreadable.

## 5. Record the backup

After a successful backup by either route, update `lastBackup` in
`.joserah/config.json` to the current ISO timestamp — this is what the
session-start hook compares new content against:

```
node -e "const fs=require('fs');const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p,'utf8'));c.lastBackup=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n');" "<workspace>/.joserah/config.json"
```

## Rules

- Never write a zip inside the workspace it backs up.
- Never restore over an existing workspace without explicit confirmation.
- Never add a repository remote the owner did not name, and never push
  without their agreement in that session.
- Never include `.joserah/keys/` (other than `.joserah/keys/AGENTS.md`) or any
  environment file in a repository route, under any circumstance.
- Always excluded, both routes: `.joserah/keys/`, the `.env` family,
  `projects/`, `docker-stack/`, `.superpowers/`.
- Never invent a project description or remote in the manifest — absence is
  reported, not papered over.
- Report in the owner's dialogue language, from `.joserah/config.json`.
