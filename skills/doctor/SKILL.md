---
name: doctor
description: Use when a Joserah workspace misbehaves — hooks not firing, journal not created, links broken, placeholders still showing — or when the user asks to check, verify, or repair their workspace.
---

# Check a workspace

Diagnose, report, then offer to fix. Never repair silently.

> **Running the plugin's tools.** The commands in the Joserah skills use
> `${CLAUDE_PLUGIN_ROOT}`. That expands in bash; in PowerShell it is variable
> syntax, not an environment lookup, and expands to nothing — leaving you
> running `node "/tools/…"`. Verify the path before relying on it:
> `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" "<path>"`.
> If it is empty or missing, use `~/.claude/skills/joserah` (Windows
> `%USERPROFILE%\.claude\skills\joserah`), the linked checkout. A command that failed because the
> path was empty is a failure: say so rather than reporting the step as done.

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

- Ask the owner to run `/plugin` and read you the result (to read the
  plugin list only, never to update) — slash commands are theirs to run, not yours.
- Confirm Node is on PATH *for the hook*, not just the shell: `node --version`
- Windows only: hooks are run through **bash**, which on Windows comes from Git
  for Windows. If `bash --version` fails, that is the cause — install Git for
  Windows and restart Claude Code. Check Node second.

## 3. Report

One line per FAIL and per warn, in the owner's language: what is broken and what fixes it. A warn
does not fail the exit code but is still said. If there are neither, say so in one sentence and stop.

## 4. Fix, with permission

Propose the specific repair for each failure and wait for a yes:

<!-- joserah:remedy-table-start -->
| Failure | Repair |
|---|---|
| Missing core file (other than `keys/AGENTS.md`) | Recreate it from the plugin's `templates/`. Templates carry `{{OWNER_ROLE_LINE}}`, which config.json does not store — ask the owner for it; if they decline, substitute an empty string. Never invent it. |
| `exists: keys/AGENTS.md` FAIL | **Do not read-then-write this one.** The workspace's `Read(./keys/**)` deny rule matches a `keys/` directory at any depth — including the plugin's own `templates/keys/`, per the README's Security section — so a normal read of the template fails with a confusing denial. Copy the file instead, without ever reading its content into the conversation: `cp "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" <workspace>/keys/AGENTS.md` (PowerShell: `Copy-Item "${CLAUDE_PLUGIN_ROOT}/templates/keys/AGENTS.md" "<workspace>/keys/AGENTS.md"`). |
| `exists: .joserah/directives.md` FAIL | Run `node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace>` — it creates the file from the template with the workspace name filled in and never touches an existing one. |
| `no legacy .joserah/keys directory` FAIL | Run the Migrate section below. |
| `legacy .joserah/knowledge/raw present` warn | Run `node "${CLAUDE_PLUGIN_ROOT}/tools/relocate.js" <workspace>` — one command carries the source material from whichever historical location the workspace is frozen at all the way to `imports/` at the workspace root, rewriting the links that cited the old locations. |
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
| `vault index current` warn | Run `node .joserah/tools/secret.js --index`; it rewrites `.joserah/vault-index.md` from the store, names only. If it says the store is not in the standard shape, run `/joserah:update` — the migration imports it. Doctor compares counts only and never reads a value. |
| `crew definitions current` FAIL | *missing* or *stale*: run `node "${CLAUDE_PLUGIN_ROOT}/tools/crew.js" <workspace>` — it rewrites the stamped definitions in `.claude/agents/` from config. *crew config*: the `crew` block in `.joserah/config.json` has a typo the line names; fix that key with the owner, then run `crew.js`. If `.claude/agents/` did not exist when the session started, a restart is needed once, told in one line. |
| `crew definitions current` warn | A file the owner wrote sits under a crew role's name in `.claude/agents/`, so that role runs on the owner's file, not the generated one. Never overwrite it: say so in one line and let the owner rename or remove it, then run `crew.js`. |
| Unfilled placeholder | Ask for the value, then substitute it |
| `shared memory <name>` warn | The workspace names a shared memory (`shared` in config.json) that is missing or unhealthy. Missing: ask the owner for the repository link and run `node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --join-memory <url> --target <workspace>` after removing the stale entry, or remove the entry on their yes. Unhealthy: run doctor on the memory's own path and act on what it says there. |
| Broken link | Find the moved target and repoint the link |
| `typed claims consistent` FAIL | Open the named file and line. A measurement gets its `condition:` (hardware, engine, settings, date); a struck line gets `superseded:` naming its successor; a calculation beside a measurement of the same subject is struck and pointed at it. Re-run doctor. |
| `structure migrations applied` warn | The plugin ships one note per release that changes what a workspace should look like, in its own `docs/migrations/`. Read every note newer than `migratedTo` in config.json, oldest first, and do what each one says — some steps are a tool, some are the owner's decision — then stamp `migratedTo` at the installed version. `/joserah:update` step 3b walks this. |
| `knowledge sweep` warn | Run `/joserah:sweep`. Nothing is broken — the content is behind the format: `update` deliberately never reads prose, so numbers stay as sentences until a sweep turns them into claims. A regular sweep reads only what changed since the last one and is small; a long-deferred first one is not. |
| `projects/<Owner>/<Project>` warn (no repository of its own / no remote / N commit(s) not pushed) | Not something doctor can fix by itself — it means no copy of that work exists anywhere else, or its history is incomplete everywhere but this machine. Say so plainly and ask the owner whether to `git init`, add a remote, or push, from inside that project's own directory — never proceed as if the workspace were fully backed up while one of these is open. |
| `marketplace clone diverged from its remote` warn | The plugin's own repository had its history rewritten and force-pushed, so this machine's marketplace clone can no longer fast-forward: the `git pull --ff-only` that refreshes it fails every time and the owner silently stops receiving updates. Say so plainly, then offer to repair the clone (it discards any local change there, so say that too), or removing and re-adding the marketplace in Claude Code. |
<!-- joserah:remedy-table-end -->

Re-run doctor after any repair. Do not claim it is fixed until it exits 0.

## Update notice

Run `node "${CLAUDE_PLUGIN_ROOT}/tools/check-update.js" <workspace-root>`. Three things can be
behind, and they are fixed differently. Say nothing about any whose value is `null` — the check
could not tell; carry on and do not retry.

**`prompt.behind` is `true` — the standing instructions are behind.** Tell the owner in **one
line**, in their language (e.g., in Turkish: "Joserah'ın talimat metni yenilenmiş, alayım mı?") and
nothing more. On yes, follow `/joserah:update`: it pulls the checkout, runs `migrate.js` and
`refresh-prompt.js`, and ends with a **new conversation** — no restart. (The
session-start hook already does the safe part of this by itself; you usually land here only when
the file was hand-edited.)

**`newer` is `true`: the plugin's code is behind.** Tell the owner in one line, in their language,
that a new version is ready, and offer to install it. On yes, follow `/joserah:update`. Do not
explain plugins or versions unless asked.

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

Follow `docs/migrations/0.3.0.md` in the plugin, with the owner watching; re-run doctor until every
check is ok.
