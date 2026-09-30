---
name: project
description: Use when the owner wants to start a new project or piece of software inside a Joserah workspace, work that will outgrow a single file or session. A passing idea is a capture, not a project.
---

# Start a new project

A project earns a folder once it has a plan, not before. This skill exists to
slow that moment down by exactly one step: think it through, then build.

## 1. Plan before building

Before touching the filesystem, say out loud which of three this is: a
throwaway probe, a bounded change to something that already exists here, or a
new subsystem — and when it is not obvious, take the heavier one. Then put
what you mean to build in front of the owner in the owner's own language and
stop there until they say yes. **Only the third writes a plan file.**

**No scaffolding before a plan exists.** If the owner wants to skip the plan, say in one line
what it would save, then do as they decide.

## 2. Place it

1. Once there is a plan, create `projects/{Owner}/{Project}/`.
2. Name the folder for **who owns and will reuse the software, not who
   asked for it or who it currently serves.** Software the owner wrote once
   and can reuse in other work of theirs lives under their own name; a piece
   of work that only ever serves one client or one context lives under that
   client's name instead. Ask if it is not obvious which applies. Give the
   project its own `docs/status.md` and `docs/tasks.md`, and a tiny
   `AGENTS.md` stub at the project root pointing at `docs/AGENTS.md` if the
   project is big enough to need its own instructions — see
   `projects/AGENTS.md` for the convention in full.
3. Run `git -C projects/{Owner}/{Project} init` and make the first commit as soon as
   `docs/status.md` exists. This is not optional: the workspace's
   `.gitignore` excludes `projects/*` and every backup route skips it — a
   project folder's own git history is its **only** safety net. Saying
   "tracked in the project's own git history" is a promise this step keeps.

## 3. Offer the drop folder

Offer `imports/` for briefs, reference material, exports — anything the owner would rather hand
over as a file than type out. Print its **absolute path**, `<workspace>/imports/`. What lands there
is read, never edited.

## 4. Offer containers, when it would otherwise install a toolchain

Offer it only when it avoids a real system-wide install. The layout is "Docker" in
`.joserah/conventions.md`.

## 5. Propose MCP, when the project needs outside data

If the project needs to read or write something outside the workspace — a
cloud service, another app's API, a shared database — propose specific MCP
servers rather than building a custom integration from scratch:

- Name candidate servers and say plainly what each would reach and what
  scopes or credentials it would need.
- Note where the configuration lives: `.mcp.json` at the workspace root.
- If the owner agrees, record the decision in `.joserah/directives.md` under
  Scope: what it reaches, where its config lives, and what must never pass
  through it.

**Never configure an MCP server on your own initiative.** Propose; the owner
decides.
