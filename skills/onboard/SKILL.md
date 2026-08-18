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

1. **Identity** — who they are, what they do, where. → `personal/profile.md`
2. **Current work** — what is actually on their plate right now. → `desk/tasks/now.md`, `projects/`
3. **People** — who they work with and who matters. One file each. → `knowledge/people/`
4. **Routines** — how their week runs, recurring commitments. → `.joserah/conventions.md`, `desk/tasks/next.md`
5. **Preferences** — how they want you to behave: tone, when to ask, what to
   never do. → `.joserah/learned.md`
6. **Integrations** — what tools they want connected later. → AGENTS.md §7

## How to ask

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

When topics 1-6 are Covered or Declined, set `Status: complete`, run
`node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js"`, and show the owner what their
workspace now holds — file counts per folder, not a recital of contents.

## Rules

- **Never invent a fact.** If you inferred something, ask before writing it.
- Quote the owner's own words for anything that goes into `.joserah/learned.md`.
- Nothing goes in `keys/` and no credential is ever written into markdown.
- If the owner shares something sensitive, put it in `personal/` and say so.
