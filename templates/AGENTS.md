# AGENTS.md — {{WORKSPACE_NAME}}

> Source of truth for any AI assistant working in this folder. Model-agnostic.
> **Read this first.** It is a router — it points to detail files.

## 1. What this folder is

{{OWNER_NAME}}'s persistent knowledge base, created with
[Joserah](https://github.com/SerVian7/joserah). Markdown is the source of
truth so the knowledge survives switching LLMs or tools.

- Quick captures land in [.joserah/desk/inbox/captures.md](.joserah/desk/inbox/captures.md).
- Today's focus: [.joserah/desk/tasks/now.md](.joserah/desk/tasks/now.md) and [.joserah/desk/daily/](.joserah/desk/daily/).

Run `/joserah:onboard` to fill this in, `/joserah:import` to bring existing
notes in, `/joserah:doctor` to check everything still works.

## 2. Who the owner is

{{OWNER_ROLE_LINE}}

Details: [.joserah/personal/profile.md](.joserah/personal/profile.md). Read
**only** when the task needs personal context.

## 3. How to talk and write

Two layers, and they never mix:

- **Everything addressed to the owner is in {{DIALOGUE_LANGUAGE}}.** Conversation,
  explanations, summaries, questions, and **every report you produce** — import
  reports, review summaries, weekly sweeps, error messages. If the owner reads
  it, it is in their language.
- **Everything written to disk as structure is in English.** File and folder
  names, code, identifiers, commit messages, and the headings and field names of
  the templates. This is what keeps the workspace portable between tools.

The content the owner dictates stays in whatever language they said it. A task
they gave you in Turkish is recorded in Turkish, under an English heading, in a
file with an English name.

- Direct tone, no filler. Honest about uncertainty.

Full details: [.joserah/conventions.md](.joserah/conventions.md).

## 4. Layout

```
<workspace>/
├── AGENTS.md          this file — the router
├── CLAUDE.md          one line -> AGENTS.md
├── .gitignore
├── projects/          {Owner}/{ProjectName}/ — never tracked; each has its own git
├── keys/              SENSITIVE — never read or echo contents
│
└── .joserah/
    ├── config.json          workspace marker
    ├── conventions.md · learned.md · skill-candidates.md
    ├── tools/               verify-links.js
    ├── desk/                daily/<year>/ · tasks/ · inbox/
    ├── knowledge/           people/ · raw/ · wiki/ · archive/
    ├── personal/            private — read on demand only
    └── user/                drop folder — files the owner leaves for import
```

## 5. Routines — do these without being asked

The owner should never have to name a command. These fire from conversation:

| When | Do this |
|---|---|
| Every session starts | The injected context block is your briefing — open tasks and today's journal. Do not re-read those files. |
| The owner says "kaydet / hatırlat / remind me / add to my todos" | It is already in `.joserah/desk/inbox/captures.md` (the hook did it). Route it to its real home — `.joserah/desk/tasks/now.md`, a project, or a person — and say in one line where it went. |
| The owner mentions something they did or decided today | Append it to today's journal under `## Done today` or `## Notes`. No announcement. |
| A correction or preference surfaces ("hayır, şöyle yap", "bundan sonra…") | Append it to `.joserah/learned.md` in the rule / reason / edge format. Quote their words. |
| A new person comes up by name | Create or update `.joserah/knowledge/people/firstname-lastname.md`. |
| A piece of work grows past a couple of tasks | Propose a folder under `projects/{Owner}/{Project}/` with `docs/status.md`. Ask first. |
| The owner asks "what's on my plate / ne var bugün" | Answer from `.joserah/desk/tasks/now.md` plus today's journal. Flag anything older than two weeks. |
| A week of journal entries has accumulated | Offer a sweep: stale tasks, untriaged captures, project status drift. Offer — do not just do it. |
| Anything is moved or renamed | Run `node .joserah/tools/verify-links.js` and fix every break before finishing. |

## 6. Working method

This workspace runs on the **superpowers** skills. They are not optional
extras — they are how work gets done here:

- Anything creative — a new project, a feature, a change in how something
  works — starts with `superpowers:brainstorming`, before any file is touched.
- A multi-step task gets a written plan first: `superpowers:writing-plans`.
- Code is written test-first: `superpowers:test-driven-development`.
- A bug is diagnosed before it is fixed: `superpowers:systematic-debugging`.
- Nothing is called done without evidence: `superpowers:verification-before-completion`.

If those skills are not available, say so rather than working around them.

## 7. Integrations (MCP, external tools)

None configured yet. MCP servers are how this workspace reaches outside
services — a cloud drive, a calendar, another app's API. Configuration lives
in `.mcp.json` at the workspace root, never inside `.joserah/`.

- **Propose, never configure unasked.** `/joserah:project` proposes specific
  servers when a project needs outside data — naming candidates, what each
  would reach, and what credentials or scopes it needs — and waits for the
  owner's go-ahead before anything is added to `.mcp.json`.
- **Record every decision here**, one entry per server, as it is added:
  `- <server> — reaches <what> — config in .mcp.json — <what must never pass through it>`.
- There is no separate "finder" skill for this — the agent already knows
  what a project needs by reading its plan; a skill whose only job was
  searching for connectors would just duplicate that.

## 8. Task capture

When the owner says "kaydet / hatırlat / remind me / add to my todos" → append
to [.joserah/desk/tasks/now.md](.joserah/desk/tasks/now.md), or
[.joserah/desk/inbox/captures.md](.joserah/desk/inbox/captures.md) if the
scope is unclear, with a `[YYYY-MM-DD HH:MM]` stamp. Just do it and say what
you wrote. If you see a `[capture]` note, the hook already did it — do not
duplicate.

## 9. Self-update protocol

**Do without asking:** append captured tasks; log completions in
`.joserah/desk/tasks/done.md`; add owner facts to `.joserah/personal/profile.md`;
append preferences and corrections to `.joserah/learned.md`; fix typos in
files you wrote.

**Ask before:** creating a top-level folder; moving or deleting files;
restructuring conventions.

## 10. Hard rules

1. Read before writing.
2. No silent deletions or moves — confirm first.
3. No secrets in markdown. If a key or token is pasted, say it belongs in `keys/` and do not repeat it.
4. Never write to `.joserah/knowledge/raw/` — immutable source material. The one exception is `/joserah:import`, which copies the owner's own sources in verbatim.
5. Never read `keys/` content unless explicitly asked.
6. After moving or renaming any file, run `node .joserah/tools/verify-links.js` and fix every break.
7. Surface assumptions. One clarifying question beats a wrong action — but never ask for trivial captures.

---

*Created {{SETUP_DATE}} by the Joserah plugin. Keep this file under ~200 lines.*
