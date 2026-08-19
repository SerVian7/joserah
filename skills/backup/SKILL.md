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

Three questions, before touching anything:

1. **Zip, or a private repository?** A zip is a one-time, local snapshot.
   A repository keeps two or more machines in sync going forward, and is
   opt-in and consequential — it puts the owner's journal, their notes about
   the people around them, and everything in `.joserah/personal/` on a third
   party's server, even a private one they control. If they only want a
   safety copy, the zip is the smaller, safer answer — say so if they seem
   unsure.
2. **What to include?**
   - *(a)* **The workspace only** — the default.
   - *(b)* **Workspace plus a description of the projects** — names,
     remotes, one-line summaries, but never their contents. The manifest
     below is written on every backup regardless, scope *(b)* only means you
     put extra care into filling its description lines.

   Never offer to archive project contents themselves: `projects/` and
   `docker-stack/` carry their own git history (or none at all) and are
   excluded by standing rule.
3. **Should `keys/` go in?** Default is **no** — the archive then contains no
   credentials and can be stored anywhere. If the owner says yes, say once,
   plainly: the backup will contain live credentials, so it must be treated
   like a password file — and on the repository route they will sit in git
   history on a third-party server for good. If they still want everything,
   take everything: zip route adds `--include-keys`; repository route stages
   them with `git add -f keys/` after the gate below has otherwise passed.
   Their data, their call — but the consequences are said out loud first,
   every time.

Never produce an artifact before all three answers are in.

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

The count and size cannot be known before the tool runs, so the manifest is
produced in two passes — never invent the numbers:

1. Run the create command once. Its JSON output gives `files`; `ls -l` /
   `Get-Item` on the zip gives the size. If the output lists `skipped`
   entries (symlinks, files deleted mid-run), copy them into the manifest
   under "Not included".
2. Write the manifest with those real numbers.
3. Run the create command again (same arguments) so the manifest is inside
   the archive. The final archive holds manifest-count + 1 files; report the
   final number.

For the repository route the numbers are `git ls-files | wc -l` and
`git count-objects -vH` (`size-pack`) after the commit — cite the commands
you ran.

## 3a. Zip route

1. Ask where the archive should go. Default: the owner's home directory,
   named `joserah-<workspace>-<YYYY-MM-DD>.zip`. Never write it *inside* the
   workspace — a backup that lives in the thing it backs up is not a backup.
   Resolve `~` yourself — do not pass a literal `~` to the archive script;
   Node does not expand it.
2. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" create <workspace> <out.zip>`
   (add `--include-keys` **only** when question 3 was answered yes).
3. Verify the archive before calling it a backup:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" verify <out.zip>` — exit 0
   or the backup did not happen; say so and stop.
4. Show the owner what went in:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" list <out.zip>` — report the
   file count and the top-level folders, not the full listing.
5. Say plainly what was **excluded**: `keys/`, every environment file
   (`.env`, `.env.local`, `.env.production`, `.envrc` and anything matching
   `*.env` or `*.env.*`, except `.env.example` files), everything under
   `projects/` and `docker-stack/`, and `.superpowers/` scratch, unless the
   owner chose to include keys in question 3, in which case say plainly that
   they are IN. Point at the manifest (step 2) for exactly what the
   `projects/`/`docker-stack/` exclusion left out by name.

## 3b. Repository route

### First use — the safety gate

Order matters: the repository must exist before git can be asked about it.

1. `git -C <workspace> init` — a no-op if it is already a repository.
2. Run every check below. If any fails, stop and fix it first; do not
   proceed and warn. Empty output means pass. If a check cannot be run at
   all (git missing, command errors), that counts as a **failed** check —
   never treat a check that did not run as a pass.
   1. `git -C <workspace> ls-files -- "keys/" ":(exclude)keys/AGENTS.md"`
      → must print nothing (`keys/AGENTS.md` is tracked on purpose — it is
      the documentation file). Anything else is a credential in history.
      Run the same check for the pre-0.3.0 location:
      `git -C <workspace> ls-files -- ".joserah/keys/" ":(exclude).joserah/keys/AGENTS.md"`.
   2. `git -C <workspace> ls-files -- "*.env" "*.env.*" "*.envrc" ":(exclude)*.env.example"`
      → must print nothing.
   3. `.gitignore` contains `keys/*`, `.env`, `.env.*`, `*.env`, `*.env.*`,
      `.envrc`, `*.envrc`, `projects/*` and `docker-stack/*`.
   4. `node "${CLAUDE_PLUGIN_ROOT}/tools/secret-scan.js" <workspace>` → exit 0.
      Exit 1 lists file:line locations of credential-shaped text pasted into
      notes — each must be moved into `keys/` (or confirmed as a false
      positive by the owner, out loud) before anything is pushed.
   5. The remote the owner names is **private**. Ask directly; if they are
      not sure, have them check before continuing. Do not guess from the URL.
3. If the owner answered **yes** to the keys question, stage them now with
   `git add -f keys/` — and only now, after checks 1-5 passed, so the
   decision is deliberate rather than a side effect.

```
git -C <workspace> add -A
git -C <workspace> commit -m "workspace snapshot"
git -C <workspace> remote get-url origin 2>/dev/null || git -C <workspace> remote add origin <private-remote>
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

Report what changed since `lastBackup` with:
`git -C <workspace> status --porcelain | wc -l` (uncommitted) and
`git -C <workspace> log --oneline --since="<lastBackup>" | wc -l` (commits),
or on the zip route
`node -e "const fs=require('fs'),p=require('path');const since=new Date(process.argv[2]).getTime();let n=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){if(!['.git','node_modules','projects','docker-stack','keys'].includes(e.name))w(f)}else if(fs.statSync(f).mtimeMs>since)n++}})(process.argv[1]);console.log(n)" <workspace> <lastBackup-ISO>`.
Then ask before pushing:

- Before working: `git -C <workspace> pull --rebase`
- After working: show the diff summary, then commit and offer to push.
- On conflict: markdown conflicts are resolved by reading both sides, never
  by taking one wholesale. Journal entries for the same day append; task
  lists merge line by line. Never resolve a conflict in `.joserah/personal/`
  without showing the owner both versions.

## 4. Restore

1. The target directory must be empty or non-existent. If it already holds a
   workspace, stop and ask — restoring over live files destroys work.
2. Check the archive before you unpack it:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" verify <in.zip>`. Exit 0
   means every entry's checksum matches. A non-zero exit names the first
   corrupt entry — stop there and say so; extracting a corrupt archive writes
   files up to the bad entry and then fails, leaving a half-restored tree.
3. Zip: `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" extract <in.zip> <target>`.
   Repository: `git clone <private-remote> <target>`. `extract` refuses to
   overwrite existing files; that refusal is the tool backing up rule 1 —
   never add `--force` to a restore without the owner's explicit say-so.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <target>` and report the
   result. A restored workspace that fails doctor is not restored.
5. If `.claude/settings.json` is missing from the restore (older backup), do
   not write the permission rules by hand and do not copy them out of another
   workspace — re-run the scaffold's own settings step, which is where the
   rules actually live (`tools/scaffold.js`, `PERMISSION_DENY`):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --settings-only --target <target>
   ```

   It writes nothing else, and refuses if a `settings.json` is already there.
   The command exits 1 if it could not write — that is a failure to report,
   not to paper over. Then re-run doctor and confirm the check named
   `.claude/settings.json (present)` says `ok — present with the full deny
   set`. These rules are one layer of the keys/ protection (the others are
   the workspace's AGENTS.md instruction and the owner's own caution — Bash
   access can never be fully denied by pattern rules).

## 5. Record the backup

A repository backup counts as successful only when the **push** succeeded
(or the owner explicitly declined the push and accepted that the snapshot is
local-only — say what that means for the staleness line).

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
- Never include `keys/` (other than `keys/AGENTS.md`) or any environment
  file in a repository route unless the owner explicitly said yes to
  question 3 — and even then, only after the safety gate has otherwise
  passed and the consequences were said out loud.
- Excluded by default, both routes: `keys/` (old and new location), the
  `.env` family, `projects/`, `docker-stack/`, `.superpowers/`. `keys/` can
  be included only by the owner's explicit answer to question 3, never by
  default.
- Never invent a project description or remote in the manifest — absence is
  reported, not papered over.
- Report in the owner's dialogue language, from `.joserah/config.json`.
- When a session opens with a "[backup] N file(s) changed" line, offering a
  backup is the correct reflex — that line exists to be acted on.
