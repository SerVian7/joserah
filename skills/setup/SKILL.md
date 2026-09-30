---
name: setup
description: Use when someone asks to install Joserah or set it up — "Install Joserah from <path> and set it up for me", "Joserah'ı kur", "set me up" — to create a new workspace, or to continue, resume or finish getting set up. Only on that request, never because of what a workspace holds or lacks.
---

# Install and set up Joserah

One journey: notice which assistant this is, make Joserah load in it, create the workspace, then
fill it by a short interview, a few questions at a time, across as many sessions as the owner
likes. Ask only what a newcomer can answer; everything else has a default.

`<clone>` below is the Joserah checkout: the path the owner gave ("Install Joserah from <path>"),
or, when the plugin is already loaded, `${CLAUDE_PLUGIN_ROOT}` with the link resolved. In bash
`${CLAUDE_PLUGIN_ROOT}` expands; in PowerShell it expands to nothing — verify a path before relying
on it: `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" "<path>"`. A command
that failed because a path was empty is a failure: say so rather than reporting the step as done.

## 0. Which assistant is this

```
node "<clone>/tools/detect-harness.js"
```

It prints `{ harness, evidence }` from documented markers only; you know which tool you are, so
confirm it against that. Then take one path:

- **`claude-code`** — link the checkout so Claude Code loads it in every session, in place, as
  `joserah@skills-dir`:

  ```
  node -e "const fs=require('fs'),p=require('path'),l=p.join(require('os').homedir(),'.claude','skills','joserah');fs.mkdirSync(p.dirname(l),{recursive:true});fs.symlinkSync(p.resolve(process.argv[1]),l,'junction')" "<clone>"
  ```

  (a directory junction on Windows, a symlink elsewhere; the README has the `mklink /J` and `ln -s`
  forms). If `~/.claude/skills/joserah` already exists, say what it points at and ask before
  touching it. If Joserah was installed from a marketplace before, it is uninstalled first
  (README, "Upgrading from 0.13.x"). The hooks start with the next session: the owner restarts
  Claude Code once, at the end of this skill.
- **`antigravity`** or **`unknown`** — **AGENTS.md-only mode**. Nothing is linked. Antigravity
  reads the workspace-root `AGENTS.md` as an always-on rule; after step 3, also write
  `<workspace>/.agents/rules/joserah.md` so the role and the owner's rules reach it too:

  ```
  ---
  trigger: always_on
  description: "Joserah standing layers"
  ---
  @[Role](../../JOSERAH-ROLE.md)
  @[Directives](../../.joserah/directives.md)
  ```

  Tell the owner plainly, in one short list, what does not run in this mode and what replaces it
  (README, "AGENTS.md-only mode"): no session briefing — you open `.joserah/desk/tasks/now.md` and
  today's journal at session start; no capture hook — you write captures yourself; no vault or
  tool-call guard — the rules in `AGENTS.md` still apply, unenforced; no `/joserah:*` skills.

## 1. Prerequisites

- Node.js ≥ 18: `node --version`. Missing or older → stop and say so.
- Claude Code on Windows only: `bash --version`. The hooks are declared with `"shell": "bash"`;
  without Git for Windows they never fire. Missing → stop and say so.

## 2. Where it goes, and four answers

Open with one line of notice, in the owner's language — no gate, nothing stored: what they write
here is sent to the provider of the model this assistant runs on, and other people's personal
details belong here only with a reason to hold them.

- **Location.** The current folder, when it is empty or the owner says so. Otherwise one question:
  where? Resolve `~` yourself. If the chosen folder is not empty, say what is in it and ask before
  continuing. The workspace name is the folder's name unless they give another.
- **The owner's name.**
- **The assistant's name** — optional, one line: "Shall I have a name here?" Empty is correct;
  never invent one.
- **The language** is not a question: take it from how they write, and confirm it inside another
  question's line ("Türkçe devam edelim — adınız ne?").

Nothing else is asked. Trust is `owner`, kind is `home`, feedback is off.

**Hosting — developers only.** Setting a workspace up for someone else on this machine happens
only on an explicit request such as `/joserah:setup --hosted`, never as a question: ask for the
host workspace root and add `--kind hosted --trust guest --host-path <host root>` below.

## 3. Create it

```
node "<clone>/tools/scaffold.js" --target <path> --workspace <name> --git \
  --owner <name> --assistant <NAME> --language <LANG>
```

The scaffold refuses, writing nothing and exiting 1, if any file it would write already exists,
and prints those paths. Show the owner that list and say what `--force` would do (overwrite them in
place, no backup — their own `AGENTS.md`, `.gitignore` or `.claude/settings.json` would be gone).
Offer an empty folder, or moving the files aside. **Never add `--force` on your own initiative.**

## 4. Verify

```
node "<clone>/tools/doctor.js" <path>
```

Every check `ok` or `warn` — fix any `FAIL` and re-run before going on. In AGENTS.md-only mode,
`plugin loaded from the skills dir` warns by design.

## 5. Hand off

Tell the owner, in their language:

- Where the workspace is. With Claude Code: restart it once — from then on today's journal and open
  tasks arrive by themselves and words like "remind me" file themselves; if they do not,
  `/joserah:doctor` says why (on Windows, usually a missing Git Bash). In AGENTS.md-only mode: the
  short list from step 0.
- The drop folder's **absolute path**, `<path>/.joserah/user/` — anything dropped there (a CV, a
  project brief) is picked up with `/joserah:import` and can be deleted once absorbed.
- Next: the short interview below, now or in any later session.

## Rules

- Never create content the user did not give you. Empty values are correct until the owner
  supplies something.
- Never write into `keys/` except through `node .joserah/tools/secret.js --set`, which is how a
  credential the owner hands over is saved.
- Do not configure MCP servers — that is the user's own later step, proposed by `/joserah:project`
  and recorded in AGENTS.md §7.

---

# Filling it in — the interview

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

1. **Identity** — what they do, and where. Their name, the assistant's name and the language are
   already known from setup: never ask them again. One open question, ending: "…or drop any files
   you want me to know about into the `imports/` folder and I will read them." →
   `.joserah/personal/profile.md`
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
- Ask in the language already agreed for this dialogue, from `.joserah/config.json`.
- **Write as you go.** When an answer produces a fact, put it in its file in
  that same turn and say where it went in one short line.
- Follow the thread they open rather than your list. If a project comes up
  while discussing people, go there — then come back.
- When a topic yields nothing, mark it Declined and move on. Not everyone has
  a team, projects, or routines worth recording.
- Stop and offer to continue later once a topic completes. Long interviews get
  abandoned; short ones get finished.

## Finishing

> The command below uses `${CLAUDE_PLUGIN_ROOT}`; the note at the top of this skill says how to
> verify it, and where the checkout is when it is empty.

When topics 1-6 are Covered or Declined, set `Status: complete`, run
`node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>` (pass the workspace
path explicitly — cwd may be anywhere), and show the owner what their
workspace now holds — file counts per folder, not a recital of contents.

## Rules

- **Never invent a fact.** If you inferred something, ask before writing it.
- Quote the owner's own words for anything that goes into `.joserah/learned.md`.
- No credential is ever written into markdown: one the owner shares is saved at once with
  `node .joserah/tools/secret.js --set <name>`, and notes carry only the name.
- If the owner shares something sensitive, put it in `.joserah/personal/` and say so.
