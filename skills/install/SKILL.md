---
name: install
description: Use when someone wants to create a new Joserah knowledge-base workspace, set up Joserah for the first time, or asks where their notes/journal/knowledge base should live.
---

# Install a Joserah workspace

Create a new workspace where the user picks, get it verified, and only then
ask who they are. Location and creation first, verification second, identity
last — a working, checked workspace beats an interrogation.

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

## 1. Check prerequisites

- Node.js ≥ 18: run `node --version`. If it is missing or older, stop and say
  so — the hooks will not run without it.
- Superpowers: it is declared as a dependency, but dependency resolution across
  marketplaces is not guaranteed. If you cannot see skills named
  `superpowers:brainstorming` or `superpowers:writing-plans`, tell the user to
  run these two commands and come back:
  `/plugin marketplace add anthropics/claude-plugins-official`
  `/plugin install superpowers@claude-plugins-official`

## 2. Ask where it goes, and what to call it

Offer these location options and let the user pick one:

| Option | Path |
|---|---|
| Under Documents (recommended) | Windows `%USERPROFILE%\Documents\<name>` · macOS/Linux `~/Documents/<name>` |
| Home directory | `~/<name>` |
| Right here | the current working directory |
| Somewhere else | ask for the absolute path |

Detect the platform with `node -p "process.platform"` before showing paths, so
what you show is what the user will actually get. Resolve `~` yourself — do
not pass a literal `~` to the scaffold script. The `<name>` in the path is the
workspace name — ask for it here, as part of picking the location, not as a
separate interview question.

If the chosen directory already exists and is not empty, say what is in it
and ask before continuing.

The scaffold checks every file it would write and **refuses, writing nothing
and exiting 1, if any of them already exists** — it prints the conflicting
paths. If that happens: show the user that exact list, in their language, and
say what `--force` would do (overwrite those files in place, no backup — their
own `README.md`, `.gitignore` or `.claude/settings.json` would be gone, and a
lost `.gitignore` can expose what it was hiding). Then offer the alternatives:
pick an empty directory, or move the conflicting files aside first. **Never
add `--force` on your own initiative** — only when the user, having seen the
list, asks for exactly that.

## 3. Create it

```
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --target <path> --workspace <name> --git
```

This deliberately runs without `--owner`, `--language` or `--role` — nothing
about the owner is known yet, and the scaffold does not invent it. Those
tokens are written as empty for now and filled in by step 5, after doctor has
passed. Empty is correct; do not pass a placeholder guess.

## 4. Verify before moving on

```
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>
```

Every check must print `ok`. If any fails, fix it and re-run — do not move on
to identity questions on a failing doctor.

## 5. Now ask who they are

Three questions, once the workspace itself is proven to work: **owner name**,
**dialogue language**, and **one line about who they are**. Ask in whatever
language the user is writing to you in.

Offer the alternative to answering out loud: they can instead drop a document
— a CV, a short bio, an "about me" note — into the drop folder, and let
Joserah read it from there. Either way works; do not insist on the interview
if they would rather hand over a file.

If they decline the role line, or want to skip identity for now, pass an
empty string — do not invent one; they can fill it in later via
`/joserah:onboard`.

```
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --identity-only --target <path> \
  --owner <name> --language <lang> --role <line>
```

This rewrites `AGENTS.md`, `.joserah/personal/profile.md` and
`.joserah/conventions.md` with the real values, and updates
`.joserah/config.json`. Run it once, immediately after this step — running it
again later, after the owner or an assistant has hand-edited any of those
three files, would overwrite that editing. Re-run
`node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>` once more to confirm
nothing broke.

## 6. Hand off

Tell the user, in their language:

- Where the workspace is, that today's journal and open tasks are injected
  into every session automatically, and that capture words like "remind me"
  file themselves.
- The drop folder's **absolute path** — `<path>/.joserah/user/` — a hidden
  folder is awkward to drag files onto, so give the real, pasteable path, not
  the relative one. Anything dropped there can be picked up with
  `/joserah:import`, and deleted once it has been absorbed.
- Their next two moves: `/joserah:onboard` to fill the workspace in further,
  and `/joserah:import` for anything already sitting in the drop folder or
  anywhere else.

## Rules

- Never create content the user did not give you. Empty values are correct
  until the owner supplies something.
- Never write anything into `.joserah/keys/`.
- Do not configure MCP servers — that is the user's own later step, proposed
  by `/joserah:project` and recorded in AGENTS.md §7.
