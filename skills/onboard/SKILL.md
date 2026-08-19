---
name: onboard
description: Use when a Joserah workspace is empty or half-filled and its owner should be interviewed to populate it — profile, people, projects, routines — or when the user asks to continue, resume, or finish onboarding.
---

# Onboard the workspace owner

Fill an empty workspace by interviewing its owner. This is a conversation held
across as many sessions as it takes, not a form to complete in one sitting.

## State

`.joserah/onboarding.md` is the record. Create it on first run:

```markdown
# Onboarding

Status: in progress
Last session: YYYY-MM-DD

## Covered
## Open questions
## Declined
```

Read it first every time. Never re-ask something under **Covered** or
**Declined**. Append what you learn as you go, not at the end — a session can
be interrupted.

## Topics, in this order

1. **Identity** — who they are, what they do, where. → `.joserah/personal/profile.md`
2. **Current work** — what is actually on their plate right now. → `.joserah/desk/tasks/now.md`, `projects/`
3. **People** — who they work with and who matters. One file each. → `.joserah/knowledge/people/`
4. **Routines** — how their week runs, recurring commitments. → `.joserah/conventions.md`, `.joserah/desk/tasks/next.md`
5. **Preferences** — how they want you to behave: tone, when to ask, what to
   never do. → `.joserah/learned.md`
6. **Integrations** — what tools they want connected later. → AGENTS.md §7

## How to ask

- **Offer the drop folder as an alternative to answering.** Give its absolute
  path — `<workspace>/.joserah/user/` — since a hidden folder is awkward to
  drag files onto. A CV, a project brief, an org chart, a "who's who" export
  can stand in for a whole topic of questions; if something is sitting there
  already, read it before asking the topic's questions at all, and only ask
  what it left out. Say the file can be deleted once it has been absorbed.
- **Two or three questions at a time, never a wall.** Wait for the answer.
- Ask in their dialogue language, from `.joserah/config.json`.
- **Write as you go.** When an answer produces a fact, put it in its file in
  that same turn and say where it went in one short line.
- Follow the thread they open rather than your list. If a project comes up
  while discussing people, go there — then come back.
- When a topic yields nothing, mark it Declined and move on. Not everyone has
  a team, projects, or routines worth recording.
- Stop and offer to continue later once a topic completes. Long interviews get
  abandoned; short ones get finished.

## Finishing

> **Running the plugin's tools.** The command below uses
> `${CLAUDE_PLUGIN_ROOT}`. That expands in bash; in PowerShell it is variable
> syntax, not an environment lookup, and expands to nothing — leaving you
> running `node "/tools/…"`. Verify the path before relying on it:
> `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" "<path>"`.
> If it is empty or missing, locate the plugin under the user's Claude plugin
> cache — `~/.claude/plugins/cache/<marketplace>/joserah/<version>/`, on
> Windows `%USERPROFILE%\.claude\plugins\cache\…` — and use that absolute
> path. A command that failed because the path was empty is a failure: say so
> rather than reporting the step as done.

When topics 1-6 are Covered or Declined, set `Status: complete`, run
`node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>` (pass the workspace
path explicitly — cwd may be anywhere), and show the owner what their
workspace now holds — file counts per folder, not a recital of contents.

## Rules

- **Never invent a fact.** If you inferred something, ask before writing it.
- Quote the owner's own words for anything that goes into `.joserah/learned.md`.
- Nothing goes in `keys/` and no credential is ever written into markdown.
- If the owner shares something sensitive, put it in `.joserah/personal/` and say so.
