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
exist, no `{{placeholder}}` survives, every internal link resolves, and `AGENTS.md` is the current
prompt — neither behind the newest available copy nor hand-edited.

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
what fixes it. Report every `warn` line the same way, not just every FAIL —
`warn` only means the check does not fail doctor's exit code, never that the
finding is optional to say out loud. The legacy-raw and unbacked-project
warns below are exactly the case this matters for: doctor's summary line
names how many warnings exist so this step is never reached with warnings
present and nothing to say. Only once every FAIL and every `warn` has been
reported, if there were none of either, say so in one sentence and stop.

## 4. Fix, with permission

Propose the specific repair for each failure and wait for a yes:

<!-- joserah:remedy-table-start -->
| Failure | Repair |
|---|---|
| Missing core file (other than `keys/AGENTS.md`) | Recreate it from the plugin's `templates/`. Templates carry `{{OWNER_ROLE_LINE}}`, which config.json does not store — ask the owner for it; if they decline, substitute an empty string. Never invent it. |
| `exists: keys/AGENTS.md` FAIL | **Do not read-then-write this one.** The workspace's `Read(./keys/**)` deny rule matches a `keys/` directory at any depth — including the plugin's own `templates/keys/`, per the README's Security section — so a normal read of the template fails with a confusing denial. Copy the file instead, without ever reading its content into the conversation: `cp "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" <workspace>/keys/AGENTS.md` (PowerShell: `Copy-Item "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" "<workspace>/keys/AGENTS.md"`). |
| `exists: .joserah/directives.md` FAIL | Run `node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace>` — it creates the file from the template with the workspace name filled in and never touches an existing one. |
| `no legacy .joserah/keys directory` FAIL | Run the Migrate section below. |
| `legacy .joserah/knowledge/raw present` warn | Run `node "${CLAUDE_PLUGIN_ROOT}/tools/relocate.js" <workspace>` — one command carries the source material from whichever historical location the workspace is frozen at all the way to `imports/` at the workspace root, rewriting the links that cited the old locations. Doctor's own `run:` text for this warn is plugin-relative (`node tools/relocate.js ...`) and only resolves from inside the plugin's own directory; use the `${CLAUDE_PLUGIN_ROOT}` form above instead. |
| `legacy raw/ at the workspace root` warn | Run `node "${CLAUDE_PLUGIN_ROOT}/tools/relocate.js" <workspace>` — the same one command: from a root `raw/` it moves the source material to `imports/`, flattening `raw/imports/`, and rewrites citations. |
| `CLAUDE.md imports the standing layers` FAIL | Run `node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace>` — it writes the plugin's CLAUDE.md, or refreshes it, and never touches one the owner wrote. Until then the session-start hook still carries the layers, cut to its budget. |
| `CLAUDE.md imports the standing layers` warn | The workspace's CLAUDE.md is the owner's own, so nothing rewrites it. Tell the owner in one line and offer to add the `@` lines doctor names to it, on their yes. Nothing is lost meanwhile: the session-start hook carries every layer the file does not import, cut to its budget. |
| `standing context size` warn | Nothing is broken: it means every session now starts by reading more than it comfortably should, before a word of the actual work. Say the number in plain words and offer to prune `.joserah/directives.md` — keep the rules that must hold in *every* session, move the detail into `.joserah/knowledge/` notes that can be read when they are needed, and delete what stopped being true. Never edit that file without the owner: it is theirs. Left alone it eventually passes the injector's per-file cap, and a file over that cap arrives cut short (with a `[cut]` line saying so). |
| `prompt (AGENTS.md) current` FAIL — *behind* | Run `node "${CLAUDE_PLUGIN_ROOT}/tools/refresh-prompt.js" <workspace>`. Then tell the owner a **new conversation** is enough — no restart. |
| `prompt (AGENTS.md) current` FAIL — *hand-edited* or *no install record and differs* | Do not overwrite. Follow `/joserah:update` step 4: show the owner what differs, move their lines to `.joserah/directives.md`, then `refresh-prompt.js <workspace> --force` on their yes — the displaced text is kept as `AGENTS.md.replaced-<date>` beside it. |
| `prompt (AGENTS.md) current` warn — *matches but nothing recorded it* | Run `refresh-prompt.js <workspace>` — it only writes the record. |
| `prompt source drift` warn | A developer's slip, not the owner's: the prompt text changed without its version line. Report it via `/joserah:feedback`; nothing to do in the workspace. |
| `local verify-links.js current` FAIL | Copy **both** plugin files over the workspace's copies — `tools/verify-links.js` → `.joserah/tools/verify-links.js` and `tools/lib/untouchable.js` → `.joserah/tools/lib/untouchable.js` (the checker requires the library, so it only works if both travel) — then re-run doctor. |
| `local secret.js current` FAIL | Copy the plugin's `tools/secret.js` over `.joserah/tools/secret.js` — the vault tool the prompt calls by that path. It creates `keys/secrets.json` on its first `--set`; never read that file. Re-run doctor. |
| Unfilled placeholder | Ask for the value, then substitute it |
| Broken link | Find the moved target and repoint the link |
| `typed claims consistent` FAIL | Open the named file and line. A measurement gets its `condition:` (hardware, engine, settings, date); a struck line gets `superseded:` naming its successor; a calculation beside a measurement of the same subject is struck and pointed at it. Re-run doctor. |
| `structure migrations applied` warn | The plugin ships one note per release that changes what a workspace should look like, in its own `docs/migrations/`. Read every note newer than `migratedTo` in config.json, oldest first, and do what each one says — some steps are a tool, some are the owner's decision — then stamp `migratedTo` at the installed version. `/joserah:update` step 3b walks this. |
| `knowledge sweep` warn | Run `/joserah:sweep`. Nothing is broken — the content is behind the format: `update` deliberately never reads prose, so numbers stay as sentences until a sweep turns them into claims. A regular sweep reads only what changed since the last one and is small; a long-deferred first one is not. |
| `projects/<Owner>/<Project>` warn (no repository of its own / no remote / N commit(s) not pushed) | Not something doctor can fix by itself — it means no copy of that work exists anywhere else, or its history is incomplete everywhere but this machine. Say so plainly and ask the owner whether to `git init`, add a remote, or push, from inside that project's own directory — never proceed as if the workspace were fully backed up while one of these is open. |
| `marketplace clone diverged from its remote` warn | The plugin's own repository had its history rewritten and force-pushed, so this machine's marketplace clone can no longer fast-forward: the `git pull --ff-only` that refreshes it fails every time and the owner silently stops receiving updates. Say so plainly, then offer either `git -C <clone> fetch origin` followed by `git -C <clone> reset --hard origin/main` — which discards any local change in the clone, so say that too — or removing and re-adding the marketplace in Claude Code. |
<!-- joserah:remedy-table-end -->

Re-run doctor after any repair. Do not claim it is fixed until it exits 0.

## Update notice

Run `node "${CLAUDE_PLUGIN_ROOT}/tools/check-update.js" <workspace-root>`. Three things can be
behind, and they are fixed differently. Say nothing about any whose value is `null` — the check
could not tell; carry on and do not retry.

**`prompt.behind` is `true` — the standing instructions are behind.** Tell the owner in **one
line**, in their language — "Joserah'ın talimat metni yenilenmiş, alayım mı?" — and nothing more.
On yes, follow `/joserah:update`: it refreshes the marketplace clone, runs `migrate.js` and
`refresh-prompt.js`, and ends with a **new conversation** — no plugin update, no restart. (The
session-start hook already does the safe part of this by itself; you usually land here only when
the file was hand-edited.)

**`newer` is `true` — the plugin's code is behind.** Tell the owner in **one line** — "Joserah'ın
yeni sürümü var; güncellemeyi siz yapmanız gerekiyor, sonra bir kez yeniden başlatmalı." — and
nothing more. Do not explain plugins, marketplaces or versions unless asked. The update is theirs
to run; once it is done, run `migrate.js` so the workspace matches the new version. Never require
`npx`; if the only available path needs it, say plainly that the update has to wait and report it
to the developer instead.

**`behind` is `true` — this workspace was built by an older plugin than the one installed.** Run
`migrate.js` (dry-run first, see "Format version" below).

## Format version

`doctor` reports the workspace's `formatVersion`. If it is behind, run:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace-root> --dry-run
```

The output is a JSON object with `scanned` (note count), `changed` (notes that gained frontmatter or relations),
`boundaries` (nested workspaces that were refused — each migrates on its own update), `created` and `refreshed`
(plugin files it installs, `CLAUDE.md` among them) and `skipped` (files it refused to touch — an owner-written
`CLAUDE.md` is one: it is never rewritten or deleted). Show the owner these counts and lists. Once they agree, run it again without `--dry-run`. Migration is additive and idempotent: it adds
frontmatter and a `## Relations` block, and never edits prose.

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
   over `.joserah/tools/verify-links.js`, and the plugin's
   `tools/lib/untouchable.js` over `.joserah/tools/lib/untouchable.js` — the
   checker requires that library, so both files have to be current.
6. Anything else in the workspace that names `.joserah/keys` (its AGENTS.md,
   an `.mcp.json` mount, notes) — find with a grep scoped to markdown/config
   files, never `keys/` or an env file, so it can never surface a credential's
   contents — and update each with the owner, since some of those files are
   theirs, not the plugin's.
7. Re-run doctor with the path; every check `ok` or the migration is not done.
