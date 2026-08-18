---
name: install
description: Use when someone wants to create a new Joserah knowledge-base workspace, set up Joserah for the first time, or asks where their notes/journal/knowledge base should live.
---

# Install a Joserah workspace

Create a new workspace at a location the user picks, then hand off to onboarding.

## 1. Check prerequisites

- Node.js ≥ 18: run `node --version`. If it is missing or older, stop and say
  so — the hooks will not run without it.
- Superpowers: it is declared as a dependency, but dependency resolution across
  marketplaces is not guaranteed. If you cannot see skills named
  `superpowers:brainstorming` or `superpowers:writing-plans`, tell the user to
  run these two commands and come back:
  `/plugin marketplace add anthropics/claude-plugins-official`
  `/plugin install superpowers@claude-plugins-official`

## 2. Ask where it goes

Offer these options and let the user pick one:

| Option | Path |
|---|---|
| Under Documents (recommended) | Windows `%USERPROFILE%\Documents\<name>` · macOS/Linux `~/Documents/<name>` |
| Home directory | `~/<name>` |
| Right here | the current working directory |
| Somewhere else | ask for the absolute path |

Detect the platform with `node -p "process.platform"` before showing paths, so
what you show is what the user will actually get. Resolve `~` yourself — do not
pass a literal `~` to the scaffold script.

If the chosen directory already exists and is not empty, say what is in it and
ask before continuing. The scaffold refuses to overwrite an existing workspace.

## 3. Ask the four questions the scaffold needs

Workspace name · owner name · dialogue language · one line about who they are.
Ask in whatever language the user is writing to you in. If they decline the
role line, pass an empty string — do not invent one.

## 4. Create it

```
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --target <path> --owner <name> \
  --workspace <name> --language <lang> --role <line> --git
```

## 5. Verify before declaring success

```
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>
```

Every check must print `ok`. If any fails, fix it and re-run — do not report
success on a failing doctor.

## 6. Hand off

Tell the user, in their language: where the workspace is, that today's journal
and open tasks are injected into every session automatically, that capture
words like "remind me" file themselves, and that their next two moves are
`/joserah:onboard` to fill it in and `/joserah:import` if they already have
notes to bring across.

## Rules

- Never create content the user did not give you. Empty files are correct.
- Never write anything into `keys/`.
- Do not configure MCP servers — that is the user's own later step, recorded in
  AGENTS.md §7.
