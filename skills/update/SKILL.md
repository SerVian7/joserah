---
name: update
description: Use when a Joserah workspace should be brought current — the owner asks to update, the session briefing carries an `[update]` line, doctor reports the prompt behind or hand-edited, or the plugin was just updated and the workspace has to follow.
---

# Update a workspace

Two things update on different schedules, and the owner should never have to know which is which:

- **The standing instructions** (`AGENTS.md`, plus `directives.md`, `JOSERAH-ROLE.md`,
  `.joserah/agent.md`, `.joserah/tools/verify-links.js`) travel **without a plugin release** — they
  come from the marketplace clone and take effect in a **new conversation**. No restart.
- **The plugin's code** (hooks, tools, skills) needs a plugin update and a restart afterwards. That
  is the owner's to run. You report it in one line and never do it for them.

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

## 1. Refresh the source

The marketplace clone is a plain git checkout. Bring it current from a shell:

```
claude plugin marketplace update joserah
```

If that command is unavailable or fails, try the clone directly —
`git -C "<clone>" pull --ff-only`, where `<clone>` is `installLocation` for `joserah` in
`~/.claude/plugins/known_marketplaces.json` (Windows: `%USERPROFILE%\.claude\plugins\…`). If
neither works, say so in one line and continue: the tools then fall back to the installed
plugin's own copy, which may be older.

## 2. See what is behind

```
node "${CLAUDE_PLUGIN_ROOT}/tools/check-update.js" <workspace-root>
```

- `prompt.behind` true → the standing instructions are behind. Fixed below, no restart.
- `newer` true → the plugin's code is behind (`available` vs `installed`). Tell the owner in
  **one line**, in their language — "Joserah'ın yeni sürümü var; güncellemeyi siz yapmanız gerekiyor,
  sonra bir kez yeniden başlatmalı." — and nothing more unless asked. Carry on with the rest.
- `behind` true → this workspace was built by an older plugin than the one installed: `migrate.js`
  below brings it up.
- `null` anywhere → could not tell; say nothing about that one and do not retry.

## 3. Migrate

```
node "${CLAUDE_PLUGIN_ROOT}/tools/migrate.js" <workspace-root> --dry-run
```

Show the owner the counts in plain words — notes that gain frontmatter, files that will be created
(`created`: `directives.md`, `JOSERAH-ROLE.md`, `.joserah/agent.md`, `AGENTS.md`), files removed
(`CLAUDE.md`) — and what `prompt` says. On yes, run it again without `--dry-run`. Migrate is
additive and idempotent: it never edits prose and never touches an existing `directives.md`.

`prompt.action`:

- `install` / `record` — done; `AGENTS.md` is current and recorded.
- `none` — already current.
- `refused` — the workspace's `AGENTS.md` differs from anything the plugin ever installed
  (hand-edited, or from before prompt versioning). Go to step 4.

## 4. The prompt, when migrate refused

Do not overwrite. Show the owner what differs:

```
git -C <workspace-root> diff --no-index -- AGENTS.md "${CLAUDE_PLUGIN_ROOT}/templates/AGENTS.md"
```

(or read both files). Ask which of *their* lines should survive; move those into
`.joserah/directives.md` — the file that overrides `AGENTS.md` and survives every update. Then,
on their yes only:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/refresh-prompt.js" <workspace-root> --force
```

The displaced text is kept beside the file as `AGENTS.md.replaced-<date>`. Delete it only when the
owner says so.

## 5. The other plugin-owned files

Run doctor and act on these lines only:

- `local verify-links.js current` FAIL → copy the plugin's `tools/verify-links.js` over
  `.joserah/tools/verify-links.js`.
- `exists: JOSERAH-ROLE.md` FAIL with "does not match the role template" → delete it and run
  `migrate.js` again; it reinstalls the right one for the workspace's `kind`.

## 6. Verify and report

```
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <workspace-root>
```

Every check `ok` or the update is not done — report what is still red, in the owner's language,
one line each. When it is clean, tell the owner in one or two lines: what changed, and that a
**new conversation** picks up the new instructions. Mention a restart only if `newer` was true in
step 2, and only as the owner's own step.
