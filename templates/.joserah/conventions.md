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

- ISO dates: `YYYY-MM-DD`. Journal entries live under `.joserah/desk/daily/<year>/`.
- Per-project status: `status.md`. Per-project tasks: `docs/tasks.md`.
- Decisions: `docs/decisions/NNNN-short-title.md`.

## Markdown rules

- Internal links are relative paths, never absolute. One H1 per file.
- Code blocks carry a language tag.

## What goes where

| Content | Location |
|---|---|
| Today's plan | `.joserah/desk/daily/<year>/YYYY-MM-DD.md` |
| Active to-dos (3-5 max) | `.joserah/desk/tasks/now.md` |
| Queued / maybe / completed | `.joserah/desk/tasks/next.md` / `.joserah/desk/tasks/someday.md` / `.joserah/desk/tasks/done.md` |
| Quick unsorted capture | `.joserah/desk/inbox/captures.md` |
| Facts about the owner | `.joserah/personal/profile.md` |
| Credentials | `keys/` — never echoed |
| Source material, build inputs, generated artifacts | `imports/` — workspace root, outside `.joserah/`, never in a repository backup |
| The owner's own code, and the small inputs it needs | `.joserah/tools/` — backed up with the rest of `.joserah/`, so a tool still runs after a restore. Grouped into subfolders; no bulk |
| AI-maintained synthesis | `.joserah/knowledge/wiki/` |
| One file per person | `.joserah/knowledge/people/firstname-lastname.md` |
| Learned preferences and corrections | `.joserah/learned.md` |
| Cold storage | `.joserah/knowledge/archive/` |

## Claim lines

A fact that will be relied on — a number read off a system, a figure derived from other numbers,
a decision, a forecast — is written as a **claim line**, so a tool can tell what kind of statement
it is and under what conditions it holds. It lives on the page of its subject.

- **Type**, closed list, English: `measurement` (read from a real system), `calculation` (derived
  from other numbers), `decision` (the owner or someone authorised decided), `estimate` (a forecast,
  no evidence yet).
- **Fields**, on indented lines, `key: value`, several per line separated by ` · `:
  `condition` (mandatory for a measurement: hardware, engine, quantisation, settings), `date`,
  `by` (mandatory for every type), `source` (relative path or URL), `superseded` (what replaced a
  struck line).
- **Two mechanical rules**, both silent when broken: fields sharing a line are separated by ` · `
  and by nothing else — with any other separator the rest of the line is read as the first field's
  value; and nothing may sit between a claim line and its field lines — the block ends at the first
  line that is not a field, so a claim sentence wrapped onto a second line loses every field under it.
- **Supersession**: a refuted claim is never deleted. Its text is wrapped in `~~…~~` and it gets a
  `superseded:` field naming the successor.

```markdown
- [measurement] Model-A VRAM @65536 ctx -> 20009 MiB
  condition: RTX 4090 24564 MiB · LM Studio · Q4_K_M · temperature 0.2
  date: 2026-08-28 · by: owner (manual run) · source: ../imports/<date>-<label>/server.log
- [calculation] ~~Model-A context cost -> ~14x per token vs Model-B~~
  date: 2026-08-25 · by: assistant · superseded: the measurement above — this line held only for another engine at 32768 ctx
```

The audit runs through `/joserah:doctor`, whose `typed claims consistent` line reports a
measurement without conditions, a struck line without a successor, a calculation left beside a
measurement of the same subject, and two live claims that contradict each other under the same
conditions. It also reports the three ways a claim goes unread: a bracket category that is not
one of the four types, a field line separated by something other than ` · `, and a line severing
a claim from its fields. The owner is never handed a command for this; the assistant runs it.

## Learned-preference entries

The format for `.joserah/learned.md`. It lives here, not there: the
session-start hook injects the three most recent `##` sections of that file
into every session, so a format example sitting in it would be read as a real
learning — including from inside a code fence or an HTML comment, since the
hook matches raw lines. Every field below is a placeholder to fill in,
`**Scope:**` included: `workspace` scopes the rule to this workspace,
`universal` means it belongs to the plugin itself and should route to
`/joserah:feedback` rather than staying trapped here.

```markdown
## YYYY-MM-DD — short title
**Rule:** what to do differently.
**Scope:** <workspace | universal>
**Reason:** the feedback that caused it.
**Edge:** where it does not apply.
```

Newest entries on top. Dates are `YYYY-MM-DD`. A rule that supersedes an older
one marks the old entry `(superseded YYYY-MM-DD)` rather than deleting it.

## Docker

`docker-stack/` is absent from a fresh workspace — it is documented, not
scaffolded, and appears only once a project actually needs it.

- **Code** stays under `projects/{Owner}/{Project}/`, in that project's own
  git history.
- **Runtime state** — volumes, database files, anything a container writes —
  goes to `docker-stack/{project}/` at the workspace root, never under
  `projects/`.
- **Nothing under `docker-stack/` is ever tracked.** The workspace
  `.gitignore` ignores its contents by pattern, keeping only the file that
  documents the convention.
- Containers are offered, via `/joserah:project`, when a project would
  otherwise need a language runtime, database, or service installed
  system-wide — the point is a machine that does not accumulate every
  project's dependencies permanently.

## Skill promotion

A pattern that recurs in three or more separate sessions earns a skill at
`.claude/skills/<name>/SKILL.md`. Until then it lives in
[skill-candidates.md](skill-candidates.md) as a counter. A skill description
is a trigger condition ("Use when …"), never a summary of what it does.
