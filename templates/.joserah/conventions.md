# Conventions

The detail behind [../AGENTS.md](../AGENTS.md). Read on demand.

## Language

- **To the owner:** {{DIALOGUE_LANGUAGE}} — conversation, summaries, and every
  report.
- **To disk:** English — file and folder names, code, commits, template
  headings and field names.
- **Dictated content** keeps the language it was said in.
- Folder names use kebab-case.

## File naming

- ISO dates: `YYYY-MM-DD`. Journal entries live under `desk/daily/<year>/`.
- Per-project status: `status.md`. Per-project tasks: `docs/tasks.md`.
- Decisions: `docs/decisions/NNNN-short-title.md`.

## Markdown rules

- Internal links are relative paths, never absolute. One H1 per file.
- Code blocks carry a language tag.

## What goes where

| Content | Location |
|---|---|
| Today's plan | `desk/daily/<year>/YYYY-MM-DD.md` |
| Active to-dos (3-5 max) | `desk/tasks/now.md` |
| Queued / maybe / completed | `desk/tasks/next.md` / `desk/tasks/someday.md` / `desk/tasks/done.md` |
| Quick unsorted capture | `desk/inbox/captures.md` |
| Facts about the owner | `personal/profile.md` |
| Credentials | `keys/` — never echoed |
| Immutable source material | `knowledge/raw/` |
| AI-maintained synthesis | `knowledge/wiki/` |
| One file per person | `knowledge/people/firstname-lastname.md` |
| Learned preferences and corrections | `.joserah/learned.md` |
| Cold storage | `knowledge/archive/` |

## Learned-preference entries

The format for `.joserah/learned.md`. It lives here, not there: the
session-start hook injects the three most recent `##` sections of that file
into every session, so a format example sitting in it would be read as a real
learning — including from inside a code fence or an HTML comment, since the
hook matches raw lines.

```markdown
## YYYY-MM-DD — short title
**Rule:** what to do differently.
**Reason:** the feedback that caused it.
**Edge:** where it does not apply.
```

Newest entries on top. Dates are `YYYY-MM-DD`. A rule that supersedes an older
one marks the old entry `(superseded YYYY-MM-DD)` rather than deleting it.

## Skill promotion

A pattern that recurs in three or more separate sessions earns a skill at
`.claude/skills/<name>/SKILL.md`. Until then it lives in
[skill-candidates.md](skill-candidates.md) as a counter. A skill description
is a trigger condition ("Use when …"), never a summary of what it does.
