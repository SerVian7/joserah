---
name: sync
description: Use when someone wants their Joserah workspace on more than one machine, asks to sync, mirror, or push their workspace to a private repository, or wants edits made on one computer to show up on another.
---

# Sync a workspace across machines

Git, pointed at a **private** repository the owner controls. This is opt-in and
consequential: it puts personal notes on someone else's server. Treat it that
way.

## Before configuring anything — the safety gate

Run every check. If any fails, stop and fix it first; do not proceed and warn.
These use git's own pathspec matching — no external tool, so they behave
identically everywhere, including plain PowerShell where `grep` does not
exist. Empty output means pass. If a check cannot be run at all (git missing,
command errors), that counts as a **failed** check — never treat a check that
did not run as a pass.

1. `git -C <workspace> ls-files -- "keys/" ":(exclude)keys/AGENTS.md"` → must
   print nothing. `keys/AGENTS.md` is tracked on purpose — it is the
   documentation file that tells assistants never to read that folder — so it
   is excluded from the check. **Anything else** printed under `keys/` is a
   real violation: a credential is in git history.
2. `git -C <workspace> ls-files -- "*.env" "*.env.*" "*.envrc" ":(exclude)*.env.example"`
   → must print nothing. The wildcards match at any depth, so this covers
   `.env`, `.env.local`, `.env.production`, `config/.envrc` and the rest;
   `.env.example` and `*.env.example` are documentation and are allowed.
3. `.gitignore` contains `keys/*`, `.env`, `.env.*`, `*.env`, `.envrc`,
   `projects/*` and `docker-stack/*`
4. The remote the owner names is **private**. Ask directly; if they are not
   sure, have them check before continuing. Do not guess from the URL.

Then say this once, in their language, and get an explicit yes: a private
repository is still a third party storing their journal, their notes about
people, and whatever is in `personal/`. Backups (`/joserah:backup`) keep
everything local; sync does not.

## First machine

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

## Second machine

```
git clone <private-remote> <target>
```
Then `node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <target>`.

## Day to day

- Before working: `git -C <workspace> pull --rebase`
- After working: show the diff summary, then commit and offer to push.
- On conflict: markdown conflicts are resolved by reading both sides, never by
  taking one wholesale. Journal entries for the same day append; task lists
  merge line by line. Never resolve a conflict in `personal/` without showing
  the owner both versions.

## Rules

- Never add a remote the owner did not name.
- Never push without the owner's agreement in that session.
- Never sync a workspace with tracked credentials — anything under `keys/`
  other than `keys/AGENTS.md`, or any environment file (`.env`, `.env.local`,
  `.env.production`, `.envrc`, …).
- If the owner only wants a copy for safety, tell them `/joserah:backup` is the
  smaller, safer answer and let them choose.
