---
name: setup
description: Use when someone wants to create a new Joserah workspace or set one up for the first time, when a workspace is empty or half-filled and its owner should be interviewed to populate it, or when they ask to continue, resume or finish getting set up.
---

# Set up a Joserah workspace

Two halves of one journey: create the workspace, then fill it by interview.
The interview runs a few questions at a time, and they are one skill because
whoever is setting up never asks for them by two separate names — they say
"set me up" once and expect to be carried through, across as many sessions
as they like.

Create a new workspace where the user picks, get it verified, and only then record who they are.
Location and creation first, verification second, identity submission last — a working, checked
workspace beats an interrogation.

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
- On Windows only — bash: run `bash --version` (any shell). The plugin's
  hooks are declared with `"shell": "bash"`; without Git for Windows they
  will never fire and every automatic feature (journal injection, capture)
  is silently dead. If it is missing, stop and say so.

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
own `AGENTS.md`, `.gitignore` or `.claude/settings.json` would be gone, and a
lost `.gitignore` can expose what it was hiding). Then offer the alternatives:
pick an empty directory, or move the conflicting files aside first. **Never
add `--force` on your own initiative** — only when the user, having seen the
list, asks for exactly that.

## 3. Ask before creating: language, name, reach, the assistant's definition, and whether it keeps itself up to date

Ask these five in this order, each in the language the user is writing in. Four go straight into
the next step's command — language, reach, the assistant's name, and the keep-up-to-date answer.
Only the owner's name is held, for step 7, once the workspace exists and consent has been given —
it must not wait on consent: a "no" in step 6 must never cost the owner an answer already given.
The one-or-two-sentence definition is never a flag at all — it goes straight into a file, in step 4.

**Ask first: which dialogue language should it use with you?** → `--language LANG`, passed now.
Ask this before anything else, then use it for everything that follows — in this skill and beyond.

**Ask for the owner name.** Hold the answer; it is not passed until step 7.

**Ask: may the assistant act on this machine, or only inside this folder?** Ask it in exactly
those words — about consequence, never about a trust level or a flag name.

> "Bu asistan bilgisayarınızın tamamında hareket edebilsin mi, yoksa yalnızca bu klasörle mi
> sınırlı kalsın?"

- The whole machine → `--trust owner` (the default).
- Only inside this folder → `--trust guest`, plus `--host-path <host workspace root>` so the host
  tree is walled off.

Say plainly, once, when guest is chosen: the deny rules are a guardrail, not a sandbox. If the
guest must be genuinely unable to reach the rest of the machine, the answer is a separate OS user
account or a container — offer that rather than implying the rules are airtight.

Whether this workspace serves one person or a team is **not** asked here, or anywhere in this
interview: it is data that arrives later, from use, never a proxy for privilege. `--kind` keeps
its default; nobody is asked to name it.

**Ask the assistant's definition: what should it be called, and — in one or two plain sentences —
what it is for here?** The name is `--assistant NAME`, passed now; leave it empty rather than
invent one if they decline. The sentences are not a flag: once the workspace exists (step 4),
write them, in the owner's own words, below the marker line in `.joserah/agent.md`.

**Ask whether that definition should keep itself up to date.** Offer three answers: **automatic**
(the assistant proposes amendments to `agent.md` as it learns how it is actually used, and applies
them), **ask first** (it proposes, the owner decides), or **off**. Passed now, at creation, as
`--identity-mode auto|manual|off` — do not hold it for step 7: that step only runs if consent is
given in step 6, and an owner who answers this and then declines consent must not have the answer
thrown away. If they do not answer, pass nothing — absent means never asked.

## 4. Create it

```
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --target <path> --workspace <name> --git \
  --trust <owner|guest> --assistant <NAME> --language <LANG> \
  --identity-mode <auto|manual|off>
```

If the answer from step 3 was "only inside this folder", add `--host-path <host workspace root>`
to the command so the host tree is walled off. Omit `--identity-mode` entirely if that question
went unanswered — never pass a guessed default.

This deliberately runs without `--owner`, `--role`, `--consent-model` or `--feedback` — the
owner's name was asked in step 3 but, along with role, consent and feedback, is submitted in step
7, once consent has been given. `--trust`, `--assistant`, `--language` and `--identity-mode`, all
known from step 3, are passed now: unlike the four deferred to step 7, none of these depend on
what the owner decides in step 6, so none of them wait on it. Empty assistant name is correct if
the owner declined to answer; do not pass a placeholder guess.

If the owner gave the one-or-two-sentence definition in step 3, write it now, verbatim, below the
marker line in `<path>/.joserah/agent.md` (`<!-- joserah:agent-overlay-below -->`) — nothing above
that line is ever read, and nothing else in the file changes. If they declined, leave the file
exactly as scaffolded.

## 5. Verify before moving on

```
node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>
```

Every check must print `ok`. If any fails, fix it and re-run — do not move on
to consent or identity questions on a failing doctor.

## 6. Ask for consent

Ask once, now that the workspace exists but before anything real goes into it — in the language
chosen in step 3, and say it plainly, not as a document to read:

1. Name the model that is actually running right now, and who provides it. Read this from your own
   running environment; **do not guess a model name.** If you cannot determine it, say so plainly
   and ask them to check, rather than naming one.
2. Say that what they write here is sent to that provider to be processed, which means it leaves
   this machine and may be handled in another country.
3. Say that if they put other people's personal information in here — colleagues, clients, family —
   they are responsible for it, and in some countries doing that without a lawful basis is an
   offence, not just a policy breach.

Then ask whether to continue. That is the whole question — three sentences and a yes/no. This is a
first pass, deliberately short: it is not a privacy policy and must not be presented as legal advice.
If they ask a real legal question, say you cannot answer it.

Hold on to their answer and the exact model name you gave — it becomes `--consent-model NAME` in
step 7's command. On no: stop here entirely. Do not ask who they are, do not offer feedback, do
not start the interview below, and do not run `/joserah:import`, and say plainly that nothing was recorded.

## 7. Ask who they are, then offer feedback

Only reached if step 6 ended in yes. Ask one more question, now that the workspace itself is
proven to work and consent has been given: **one line about who they are** (their role). The
owner's name and language were already collected in step 3 — do not ask either again.

Offer the alternative to answering out loud: they can instead drop a document — a CV, a short bio,
an "about me" note — into the drop folder, and let Joserah read it from there. Give them the drop
folder's absolute path — `<path>/.joserah/user/`. Either way works; do not insist on the interview
if they would rather hand over a file.

If they decline the role line, or want to skip identity for now, pass an empty string — do not
invent one; they can fill it in later — the interview below picks it up.

**Then offer feedback, once, without pressure:**

Say plainly: Joserah is improved from how it goes wrong in real use. If they turn feedback on, the
assistant will write short notes about *this software* — what misfired and what would fix it — with
no names, no companies and no examples from their work, and open them as public issues on the
project's repository. Say that this needs a GitHub account and the `gh` command already signed in
on this machine, and that without it nothing is sent and nothing breaks.

Offer three answers and take whichever they give: **automatic** (write and file, then show them
what was sent), **ask me** (mention it once when something comes up), **off**.

Pass the answer through `--feedback auto|manual|off` and, when they give one, `--github <user>`.
If they do not answer, pass nothing — an absent block means never asked, and the assistant then
says nothing about feedback ever again. (Step 3's keeps-up-to-date answer already went in at
creation, in step 4 — do not ask it again here, and do not pass `--identity-mode` on this call.)

```
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold.js" --identity-only --target <path> \
  --owner <name> --language <LANG> --role <line> --consent-model "<model name>" \
  [--feedback auto|manual|off] [--github <user>]
```

Pass the `--owner` from step 3 and the `--language <LANG>` from step 3 as-is — do not ask either
again. Pass `--consent-model` with the exact model name you gave in step 6 — that is what makes the
yes in step 6 count; never pass this flag on a no, and never pass a guessed or placeholder name.

This rewrites `.joserah/personal/profile.md` and `.joserah/conventions.md` with the real values,
and updates `.joserah/config.json`, including the feedback block when it was answered. Run it once,
immediately after this step — running it again later, after the owner or an assistant has
hand-edited any of those files, would overwrite that editing. Re-run
`node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" <path>` once more to confirm nothing broke.

## 8. Hand off

Tell the user, in their language:

- Where the workspace is, and that **from the next session on** today's
  journal and open tasks are injected automatically and capture words like
  "remind me" file themselves — and that if none of that appears next
  session, `/joserah:doctor` diagnoses it (the usual Windows cause is
  missing Git Bash).
- The drop folder's **absolute path** — `<path>/.joserah/user/` — a hidden
  folder is awkward to drag files onto, so give the real, pasteable path, not
  the relative one. Anything dropped there can be picked up with
  `/joserah:import`, and deleted once it has been absorbed.
- Their next two moves: the interview below to fill the workspace in further,
  and `/joserah:import` for anything already sitting in the drop folder or
  anywhere else.

## Rules

- Never create content the user did not give you. Empty values are correct
  until the owner supplies something.
- Never write into `keys/` except through `node .joserah/tools/secret.js --set`, which is how a
  credential the owner hands over is saved.
- Do not configure MCP servers — that is the user's own later step, proposed
  by `/joserah:project` and recorded in AGENTS.md §7.

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
- No credential is ever written into markdown: one the owner shares is saved at once with
  `node .joserah/tools/secret.js --set <name>`, and notes carry only the name.
- If the owner shares something sensitive, put it in `.joserah/personal/` and say so.
