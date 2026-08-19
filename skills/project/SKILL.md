---
name: project
description: Use when someone wants to start a new project, a new piece of software, or a new idea inside a Joserah workspace — anything that will grow past a single file or a single session.
---

# Start a new project

A project earns a folder once it has a plan, not before. This skill exists to
slow that moment down by exactly one step: think it through, then build.

## 1. Plan before building

Before touching the filesystem, run `superpowers:brainstorming` to shape the
idea — what it actually needs to do, for whom, and what "done" looks like —
then `superpowers:writing-plans` to turn that into a written plan.

**No scaffolding before a plan exists.** Creating the folder first and
figuring out the shape as you go is exactly what this skill is here to
prevent. If the owner is impatient to just start typing, say so plainly and
explain why five minutes of brainstorming saves the rework.

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
3. Run `git -C projects/<name> init` and make the first commit as soon as
   `docs/status.md` exists. This is not optional: the workspace's
   `.gitignore` excludes `projects/*` and every backup route skips it — a
   project folder's own git history is its **only** safety net. Saying
   "tracked in the project's own git history" is a promise this step keeps.

## 3. Offer a drop folder

Offer `.joserah/user/{project}/` for briefs, reference material, exports —
anything the owner would rather hand over as a file than type out. Print its
**absolute path** — `<workspace>/.joserah/user/{project}/` — since the
hidden `.joserah/` folder is awkward to drag files onto otherwise. Create it
only once the owner actually has something to put there; an empty drop
folder nobody asked for is clutter.

## 4. Offer containers, when it would otherwise install a toolchain

If the project needs a language runtime, a database, or a background
service that would otherwise get installed system-wide, offer to containerise
it instead — so the machine does not accumulate every project's dependencies
permanently.

The split, once containers are in play:

- **Code** stays under `projects/{Owner}/{Project}/`, tracked in the
  project's own git history — created in step 3 above, same as any other
  project.
- **Runtime state** — volumes, database files, anything the container
  writes — goes to `docker-stack/{project}/` at the workspace root, **never**
  under `projects/`.
- **Nothing in `docker-stack/` is ever tracked.** No `docker-stack/` folder
  ships in the plugin's templates; it is created on demand, the first time a
  project actually needs it, and only that project's own subfolder is
  created — not a generic scaffold. See "Docker" in
  `.joserah/conventions.md` for the full convention.

Only offer this when it solves a real problem (avoiding a system-wide
install); a project with no runtime dependency worth isolating does not need
a docker-stack entry just because one exists as an option.

## 5. Propose MCP, when the project needs outside data

If the project needs to read or write something outside the workspace — a
cloud service, another app's API, a shared database — propose specific MCP
servers rather than building a custom integration from scratch:

- Name candidate servers and say plainly what each would reach and what
  scopes or credentials it would need.
- Note where the configuration lives: `.mcp.json` at the workspace root.
- If the owner agrees, record the decision in `AGENTS.md` §7 — what it
  reaches, where its config lives, and what must never pass through it — so
  the next session (and the next assistant) knows it is there and why.

**Never configure an MCP server on your own initiative.** Propose; the owner
decides. This skill does not go looking for connectors on its own either — a
skill whose only job is search would duplicate what you already do by
reading the project's needs and proposing accordingly.

## Rules

- Never scaffold a project folder before a plan exists.
- Never decide the owner/client split unilaterally when it is ambiguous — ask.
- Never write anything to `docker-stack/` speculatively; create it only when
  a real project needs it.
- Never configure an MCP server, or edit `.mcp.json`, without the owner's
  explicit go-ahead.
