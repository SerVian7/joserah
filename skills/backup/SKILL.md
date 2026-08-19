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
   **The two mechanisms do not behave the same way toward `.env`-family
   files inside `keys/`, and that difference must be said out loud too:**
   - Zip: `archive.js` strips `.env`-family files unconditionally, even
     inside `keys/`, even with `--include-keys`. Storing a credential as
     `keys/.env` is completely ordinary — check for one and say plainly if
     it was left out of the zip despite the yes.
   - Repository: `git add -f keys/` has no filename filter and **does**
     stage a `keys/.env`, unlike the zip route. The gate's step 3 is where
     this gets handled — see there for the "leave it in or `git rm --cached`
     it" decision. Say plainly which one happened.

   Their data, their call — but the consequences, and this route-specific
   difference, are said out loud first, every time.

Never produce an artifact before all three answers are in.

## 2. Write the skipped-work manifest

Every backup — zip or repository — writes `.joserah/backup-manifest.md` into
the workspace before the final snapshot is taken, so the archive is
self-describing about what it did **not** take. Head it plainly: these
directories were not backed up, and where they live instead.

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

### Skipped (symlinks, files that vanished mid-run)
- <workspace-relative path, one per line — omit this heading entirely if the create command's `skipped` list was empty>
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
produced in two passes — never invent the numbers, and never compute a
number the tool would otherwise print for you:

**Zip route** (see section 3a's create step, which points back here):

1. Run the create command once. Its JSON output gives `files`; `ls -l` /
   `Get-Item` on the zip gives the size. If the output lists `skipped`
   entries (symlinks, files deleted mid-run), copy them into the manifest
   under the "Skipped" heading above.
2. Write the manifest with those real numbers.
3. Run the create command again (same arguments) so the manifest is inside
   the archive. Report the `files` value **the second run's JSON prints** —
   do not add 1 to the first run's count. A repeat backup's manifest already
   existed and was counted in the first pass, so the file the second `create`
   adds is the *replacement*, not a new file, and the two runs can legitimately
   report the same number.

**Repository route** — the same problem, solved the same way, because the
manifest must be *inside* the commit and the numbers are only real *after*
one:

1. Stage and commit once: `git -C <workspace> add -A`, then
   `git -C <workspace> commit -m "workspace snapshot"`. On a repeat backup
   where nothing changed except what the manifest is about to record, this
   can genuinely have nothing to commit — that is not a failure, it just
   changes step 3 below.
2. Read the real numbers: `git -C <workspace> ls-files | wc -l` (PowerShell:
   `(git -C <workspace> ls-files | Measure-Object -Line).Lines`) for the file
   count, and `git -C <workspace> count-objects -vH` for the size — **cite
   both the `size` and `size-pack` fields it prints** (or their sum), never
   just one. Git packs objects opportunistically (a manual or auto `gc` can
   run at any time), so whichever field is empty at a given moment is
   `0 bytes` while the other holds the real number — citing only `size`
   looks safe on a fresh commit and is just as wrong as `size-pack` alone
   once the repository has been packed.
3. Write the manifest with those real numbers and `git -C <workspace> add`
   it, then commit it the way the state you're actually in calls for:
   - If step 1 made a **new** commit in this same run,
     `git -C <workspace> commit --amend --no-edit` folds the manifest into
     it — safe here because that commit is guaranteed not pushed yet.
   - If step 1 found nothing to commit, or the commit is one the owner may
     already have pushed earlier in this session, commit the manifest on
     its own instead: `git -C <workspace> commit -m "backup manifest"`.
     **Never amend a commit that might already be on the remote** — that
     turns the next push into a non-fast-forward, which invites a
     `--force` the owner never asked for.
   - If *that* commit also finds nothing to commit — the manifest's
     content (today's date, the same counts) came out byte-identical to
     what's already recorded — the workspace is genuinely unchanged since
     the last backup. This is a legitimate outcome, not a failure: say so
     plainly ("nothing has changed since the last backup"). That is a
     statement about *content* only — whether anything still needs
     **pushing** is a separate question, and it is answered by reading
     git's actual state, never by inferring it from the commits just now
     being empty (verified: an empty commit here is fully consistent with
     an earlier commit — from a backup whose push was declined, or one
     never attempted — still sitting unpushed):
     `git -C <workspace> log --oneline @{u}..HEAD`.
     - If this fails with `fatal: no upstream configured for branch
       '<name>'`, that failure **is** the answer: no upstream means this
       branch has never been pushed at all, so a push is still needed —
       treat the error as information, not as a broken command.
     - If it lists one or more commits, say so plainly: earlier snapshots
       — this run's included — have never reached the remote, and pushing
       still has to happen even though nothing new was just committed.
     - Only an empty list with an upstream configured means there is
       truly nothing left to push.

## 3a. Zip route

1. Ask where the archive should go. Default: the owner's home directory,
   named `joserah-<workspace>-<YYYY-MM-DD>.zip`. Never write it *inside* the
   workspace — a backup that lives in the thing it backs up is not a backup.
   Resolve `~` yourself — do not pass a literal `~` to the archive script;
   Node does not expand it.
2. Run the create command, write the manifest, then run create again —
   this is the zip-route two-pass from section 2, followed exactly; do not
   run create only once and improvise a file count:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" create <workspace> <out.zip>`
   (add `--include-keys` **only** when question 3 was answered yes). Report
   the `files` value the *second* run's JSON prints — never a computed
   number.
3. Verify the archive before calling it a backup:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" verify <out.zip>` — exit 0
   or the backup did not happen; say so and stop.
4. Show the owner what went in:
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" list <out.zip>` — report the
   file count and the top-level folders, not the full listing.
5. Say plainly what was **excluded**: `keys/` (except `keys/AGENTS.md` — that
   one file is always carried through because it is the plugin's own
   documentation explaining that the folder must never be read, not a
   credential; if the listing in step 4 shows a `keys/AGENTS.md` entry, say
   so and say why, so the owner isn't left wondering what from `keys/` made
   it in), every environment file (`.env`, `.env.local`, `.env.production`,
   `.envrc` and anything matching `*.env`, `*.env.*` or `*.envrc`, except
   `.env.example` files), everything under `projects/` and `docker-stack/`,
   and `.superpowers/` scratch, unless the owner chose to include keys in
   question 3, in which case say plainly that they are IN — **and check
   separately for any `.env`-family file inside `keys/`**, because
   `--include-keys` never takes those; name it if one was left behind. Point
   at the manifest (section 2) for exactly what the `projects/`/`docker-stack/`
   exclusion left out by name.

## 3b. Repository route

### The safety gate

Runs in full **before every repository backup, not only the first** —
`git init` is a no-op on a repo that already exists, and the content checks
in steps 2 and 4 must never be skipped just because an earlier backup
already passed them: new content goes in on every backup, so it needs
checking on every backup. Nothing here relies on anything being *remembered*
from an earlier session — every check either reads git's actual current
state (which naturally degrades to a no-op when there's nothing to do, the
same way `git init` does) or asks the owner fresh. Step 2.4 is the **only**
place a remote gets added, and it only has anything to ask or add when no
remote is configured yet; step 6 never adds one — it only confirms the
actual remote, fresh, every single time regardless. There is no branch rename
anywhere in this flow — see the command block below for why, and for what
replaced it. "Later use" below layers `pull --rebase` and conflict handling
around this same gate — it does not replace it.

Order matters: the repository must exist before git can be asked about it.
And a check that inspects *content* — the one thing `.gitignore` can never
cover — only means something once the content it is checking is actually
staged. A freshly staged tree (first backup or the fifth) proves nothing
until it's actually checked: running the content-sensitive checks before
staging only tests the previous backup's leftovers, so the flow below runs
them twice — once cheaply before staging, and once for real, after.

1. `git -C <workspace> init` — a no-op if it is already a repository.
2. Run the checks below that do not need anything staged. If any fails, stop
   and fix it first; do not proceed and warn. These use git's own pathspec
   matching — no external tool, so they behave identically everywhere,
   including plain PowerShell where `grep` does not exist. Empty output
   means pass. If a check cannot be run at all (git missing, command
   errors), that counts as a **failed** check — never treat a check that did
   not run as a pass.
   1. `git -C <workspace> ls-files -- "keys/" ":(exclude)keys/AGENTS.md"`
      → must print nothing, **unless the owner answered yes to question
      3** — in that case tracked files under `keys/` are the expected
      state; confirm with the owner that the decision still stands rather
      than treating it as a violation to fix. `keys/AGENTS.md` is tracked
      on purpose either way — it is the documentation file. Run the same
      check for the pre-0.3.0 location, which has **no such exemption** —
      nothing should ever be tracked there, consent or not:
      `git -C <workspace> ls-files -- ".joserah/keys/" ":(exclude).joserah/keys/AGENTS.md"`.
   2. `git -C <workspace> ls-files -- "*.env" "*.env.*" "*.envrc" ":(exclude)*.env.example" ":(exclude)keys/**"`
      → must print nothing, no exception, ever. An `.env`-family file
      **outside** `keys/` is always a violation, consent or not. An `.env`
      -family file **inside** `keys/` is a different, narrower question
      that this check deliberately does not answer — step 3 below is where
      it gets surfaced and decided, every time `keys/` is staged, including
      on a repeat backup where one is already tracked from an earlier,
      informed decision.
   3. `.gitignore` contains `keys/*`, `.env`, `.env.*`, `*.env`, `*.env.*`,
      `.envrc`, `*.envrc`, `projects/*` and `docker-stack/*`.
   4. If no remote is configured yet
      (`git -C <workspace> remote get-url origin` prints nothing), ask the
      owner which private remote to use, confirm directly that it is
      **private** — do not guess from the URL — and add it right here:
      `git -C <workspace> remote add origin <private-remote>`. This is the
      only step that ever adds a remote. If a remote is already configured,
      there is nothing to ask or add here: this step is naturally moot on a
      repeat backup, not skipped by any remembered flag. Step 6 below still
      confirms the actual remote, fresh, on every run — but by the time it
      runs, a remote is always already configured, either from an earlier
      backup or from this step just now, so it never needs to add one
      itself (this is step 2.4, referenced there by that name).
3. Stage: `git -C <workspace> add -A`, then, only if the owner answered yes
   to question 3, `git -C <workspace> add -f keys/` — that is why `keys/`
   needs the explicit `-f`, since `add -A` alone never reaches a gitignored
   path. `add -f keys/` has no filename filter, unlike the zip route's
   `--include-keys`, so it stages whatever is actually in `keys/`.
   **Read what got staged instead of guessing at it with a filename
   pattern** — a hand-written pathspec missed a plain `keys/.envrc` in
   testing, and the fix is to stop predicting and just ask git:
   `git -C <workspace> diff --cached --name-only -- keys/`. This lists
   every path under `keys/` now staged, whatever it's named, so no pattern
   anyone forgot to write can let something through silently. Name the
   whole list to the owner. `keys/AGENTS.md` is the one entry that's always
   expected and never worth a second look. For anything in that list
   shaped like the `.env` family (`.env`, `.env.*`, `*.env`, `*.env.*`,
   `.envrc`, `*.envrc`) — call it out specifically and ask: leave it in, or
   run `git -C <workspace> rm --cached <path>` for each one the owner wants
   kept out (the file stays on disk in `keys/`, only unstaged). Do this
   every time `keys/` is staged, not only the first backup: a new file can
   land in `keys/` at any point, while a file already accepted and
   unchanged since an earlier, informed yes produces no entry in this list
   at all — `git diff --cached` only shows what actually changed.
4. Re-check what is now actually staged. This is the only moment the real
   content about to leave the machine is known, so it is not optional and
   not a repeat for form's sake:
   1. Re-run step 2.1 (the `keys/` check). A tracked `keys/` file is expected
      only if question 3 was answered yes; anything newly tracked beyond
      that must be investigated before continuing.
   2. Re-run step 2.2 (the `.env` family check outside `keys/`) — must
      still print nothing. What's inside `keys/` was already read
      completely, by name, in step 3 — there is no second pattern to guess
      at here.
   3. `node "${CLAUDE_PLUGIN_ROOT}/tools/secret-scan.js" <workspace>` → exit
      0. **A non-zero exit here means do not push.** Exit 1 lists
      file:line locations of credential-shaped text pasted into notes — move
      each into `keys/` (or have the owner confirm out loud it is a false
      positive), then unstage and re-run this step from `git add -A`. Exit 2
      means the scan could not be completed at all (an unreadable file) —
      that is a failed check to fix and re-run, not a hit to remedy by
      moving anything into `keys/`.
5. Commit, then fold in the manifest exactly as section 2's repository-route
   two-pass describes — including which of its two closing moves applies:
   `git -C <workspace> commit -m "workspace snapshot"` (note if there was
   nothing to commit), read the real numbers, write the manifest,
   `git -C <workspace> add .joserah/backup-manifest.md`, then either amend
   or commit separately, per section 2's rule for the state you're actually
   in. Never amend a commit that might already be on the remote.
6. Confirm the remote before touching it: `git -C <workspace> remote
   get-url origin`. Step 2.4 above already added one if none existed, so
   this always prints a URL by the time you reach it here — this step only
   confirms, it never adds. Show the URL to the owner and get a fresh yes,
   right now, that it is their private remote — never rely on what was
   said earlier in this session or a previous one. A value they don't
   recognize, or any hesitation, means stop, never push there silently.
7. Say once more, plainly, and get an explicit yes right before the push:
   this puts the owner's journal, their notes about the people around them,
   and everything in `.joserah/personal/` on that remote, for good. Question
   1 in section 1 was the route choice; this is the consent that belongs to
   the actual moment the data leaves the machine.
8. Push **the branch that actually holds the commit you just made** — do
   not assume its name. Ask git, don't predict:

   ```
   BRANCH=$(git -C <workspace> rev-parse --abbrev-ref HEAD)
   git -C <workspace> push -u origin "$BRANCH"
   ```
   (PowerShell: `$branch = git -C <workspace> rev-parse --abbrev-ref HEAD; git -C <workspace> push -u origin $branch`)

   **This document does not rename branches, and never runs
   `git branch -M main`.** A rename-then-push can silently push the wrong
   content: verified — on a repo where `master` holds a brand-new snapshot
   commit and an older, unrelated `main` branch already exists, a guard
   that only renames "if `main` doesn't already exist" correctly declines
   to rename, but the *next* line still pushes `origin main` — which is
   the stale branch, not the one just committed to. The owner is told the
   backup succeeded while the actual snapshot never left the machine.
   Determining and pushing the current branch by name has no such failure
   mode: whatever `git init` produced — `main` on current git, `master` on
   older git, or a name from `init.defaultBranch` — is what holds the
   commit, so it's what gets pushed, every time, first backup or
   thousandth.

**Pushing is the owner's decision every time.** Show the command and let them
run it, or ask before running it yourself. Never push unprompted.

### Second machine

```
git clone <private-remote> <target>
```

Verify this actually checked out files before trusting it. Step 8's push
sets up local tracking only — it never changes which branch a bare remote
treats as its default, and that default keeps pointing at whatever `git
init` picked on the remote side until something explicitly changes it. When
that default names a branch the backup never pushed, a plain clone prints
`warning: remote HEAD refers to nonexistent ref, unable to checkout` and
leaves `<target>` holding only a `.git` directory, no files (verified
against a real bare remote). Do not read an empty `<target>` as an empty
workspace. Fix it by reading which branch the remote actually holds, never
by guessing a name:

```
git ls-remote --heads <private-remote>
```

Exactly one line listed: re-clone naming that branch —
`git clone -b <branch-name> <private-remote> <target>`. More than one line:
ask the owner which branch the backup pushes to before re-cloning.

Then `node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <target>`.

### Later use

Report what changed since `lastBackup` with:
`git -C <workspace> status --porcelain | wc -l` (uncommitted; PowerShell:
`(git -C <workspace> status --porcelain | Measure-Object -Line).Lines`) and
`git -C <workspace> log --oneline --since="<lastBackup>" | wc -l` (commits;
PowerShell: `(git -C <workspace> log --oneline --since="<lastBackup>" |
Measure-Object -Line).Lines`), or on the zip route
`node -e "const fs=require('fs'),p=require('path');const since=new Date(process.argv[2]).getTime();let n=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){if(!['.git','node_modules','projects','docker-stack','keys'].includes(e.name))w(f)}else if(fs.statSync(f).mtimeMs>since)n++}})(process.argv[1]);console.log(n)" <workspace> <lastBackup-ISO>`.

- Before working: `git -C <workspace> pull --rebase`
- After working: show the diff summary, then run **every step of the
  safety gate above** before committing and offering to push — the whole
  numbered sequence, not a subset. Step 2.4 naturally has nothing to ask
  once a remote is configured (it isn't skipped by a remembered flag, it's
  just moot). Everything else — the `keys/` listing in step 3, the
  secret-scan re-check in step 4, step 6's fresh remote confirmation, step
  8's push-the-current-branch — runs the same way on every backup: whatever
  changed since `lastBackup` is content the owner has not had scanned,
  listed, or confirmed before.
- On conflict: markdown conflicts are resolved by reading both sides, never
  by taking one wholesale. Journal entries for the same day append; task
  lists merge line by line. Never resolve a conflict in `.joserah/personal/`
  without showing the owner both versions.

## 4. Restore

1. The target directory must be empty or non-existent. If it already holds a
   workspace, stop and ask — restoring over live files destroys work.
2. Zip: check the archive before you unpack it —
   `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" verify <in.zip>`. Exit 0
   means every entry's checksum matches. A non-zero exit names the first
   corrupt entry — stop there and say so; extracting a corrupt archive writes
   files up to the bad entry and then fails, leaving a half-restored tree.
   Repository: there is no separate verify step — `git clone` fails outright
   on a corrupt remote, so skip to step 3.
3. Zip: `node "${CLAUDE_PLUGIN_ROOT}/tools/archive.js" extract <in.zip> <target>`.
   Repository: the same clone procedure as "Second machine" above — a plain
   `git clone <private-remote> <target>` can silently produce an empty
   working tree, so verify it and, if needed, re-clone with `-b <branch>`
   exactly as described there. `extract` refuses to overwrite existing
   files; that refusal is the tool backing up step 1 above — never add
   `--force` to a restore without the owner's explicit say-so. If a corrupt
   archive somehow reaches this step despite step 2's `verify` — or `extract`
   otherwise fails partway — the target directory now holds a partial tree
   from the entries written before the failure. Re-running `extract` on that
   same target then hits the overwrite-refusal above and looks like it wants
   `--force`; it does not. **Delete the target directory and start over**
   from step 1 instead — `--force` on a half-written target papers over the
   failure rather than fixing it, and this section elsewhere warns against
   reaching for it.
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

A repository backup counts as successful only when the **push** succeeded —
or the owner explicitly declined it and accepted that the snapshot is
local-only (say what that means for the staleness line). When the owner ran
the push themselves rather than letting you run it, you have no exit code to
read: **ask** whether it succeeded before writing `lastBackup` — never
record it on the assumption that showing them the command counts as done.

After a successful backup by either route, update `lastBackup` in
`.joserah/config.json` to the current ISO timestamp — this is what the
session-start hook compares new content against:

```
node -e "const fs=require('fs');const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p,'utf8'));c.lastBackup=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n');" "<workspace>/.joserah/config.json"
```

## Rules

- Never write a zip inside the workspace it backs up.
- Never restore over an existing workspace without explicit confirmation.
- Never add or push to a repository remote the owner did not name — confirm
  what `origin` already points at before every push, not just the first
  one, and never push without their agreement in that session.
- Never include `keys/` (other than `keys/AGENTS.md`) in a repository route
  unless the owner explicitly said yes to question 3 — and even then, only
  after the safety gate has otherwise passed and the consequences were said
  out loud. The `.env` family inside `keys/` is not automatically covered
  by that yes: the zip route's `--include-keys` never takes it regardless;
  the repository route's `git add -f keys/` does, and gate step 3 is where
  that gets surfaced and decided every time — never assume either way.
- Excluded by default, both routes: `keys/` (old and new location), the
  `.env` family, `projects/`, `docker-stack/`, `.superpowers/`. `keys/` can
  be included only by the owner's explicit answer to question 3, never by
  default. The `.env` family stays excluded even then on the zip route; on
  the repository route it rides along inside `keys/` unless the owner asks
  for it to be stripped out (gate step 3) — never silently either way.
- Never invent a project description or remote in the manifest — absence is
  reported, not papered over.
- Report in the owner's dialogue language, from `.joserah/config.json`.
- When a session opens with a "[backup] N file(s) changed" line, offering a
  backup is the correct reflex — that line exists to be acted on.
