<img src="assets/logo.png" alt="Joserah" width="120">

# Joserah

**A memory for your AI assistant, made of files you own.**

*Pronounced "Yosera."*

Claude forgets you between sessions. Joserah is the folder that remembers —
a daily journal, your open work, the people around it, and the preferences
Claude picks up about how you like to work. Plain markdown, on your disk, in
your language. No database, no account, no lock-in: if you stop using this
tomorrow, you still have every file.

---

## Install

```
/plugin marketplace add SerVian7/joserah
/plugin install joserah@joserah
```

Then create your workspace:

```
/joserah:install
```

It asks where to put it and what language to speak to you in, sets everything
up, and hands you to `/joserah:onboard` — an interview that fills the
workspace in a few questions at a time, across as many sessions as you like.

Already have years of notes lying around? `/joserah:import` takes the pile.

## What you get

| | |
|---|---|
| **A journal that writes itself** | Today's entry is created and read into every session. You never open it on purpose. |
| **Capture without commands** | Say "remind me" or "kaydet" mid-sentence and it lands in your inbox, timestamped. |
| **Context that arrives on its own** | Open tasks and recent decisions are in the session before you type. |
| **A workspace that explains itself** | Its `AGENTS.md` tells any assistant how to behave in it — routines included. Works with Claude Code today; the format is model-agnostic on purpose. |
| **A graph, not just files** | Notes carry typed `[[relations]]`, so the knowledge is a graph you can also open in Obsidian — no database, no service. |

## The six skills

| | |
|---|---|
| `/joserah:install` | Create a workspace where you want it |
| `/joserah:onboard` | Get interviewed; the workspace fills in. Stop and resume freely |
| `/joserah:import` | Bring in existing notes, exports, document piles |
| `/joserah:project` | Start new work: plans first, then a project folder, a drop folder, and optional containers or MCP servers |
| `/joserah:doctor` | Check a workspace is healthy, and repair it |
| `/joserah:update` | Bring a workspace current: refresh the standing instructions and the other plugin-owned files, run the migration, report when the plugin's own code needs an update |
| `/joserah:backup` | Write the workspace to a ZIP, or mirror it to a **private** git repository so two machines share it. A ZIP stays on your disk; a repository puts your journal and notes about people on a third party's server, so it asks first |

## How it works

A workspace is any folder holding a `.joserah/config.json`. The plugin's hooks
look for that marker and stay quiet everywhere else — so you install Joserah
once and keep as many workspaces as you like. The plugin's *code* updates all
of them at once; its *standing instructions* — the `AGENTS.md` every workspace
carries — are versioned apart from the code and brought current per workspace
at session start, with a new conversation and no restart (see "Upgrading to
0.4.1").

Two rules keep the knowledge honest. Source material you bring in is copied
**verbatim** into `imports/` at the workspace root — outside `.joserah/`, so a
repository backup does not carry your bank statements and vendor PDFs along
with your notes — and never edited; anything the assistant writes lives
elsewhere and cites the source it came from. A knowledge base that quotes its
own guesses back at you is worse than no knowledge base.

## Layout

```
<workspace>/
├── AGENTS.md          the router — read this first
├── .gitignore
├── .claude/settings.json   permission deny rules — carries the Read() guard on keys/
├── projects/           {Owner}/{ProjectName}/ — never tracked; each has its own git
├── keys/               SENSITIVE — never read or echoed
├── imports/            source material, verbatim — outside .joserah/, excluded from repo backups
│
└── .joserah/
    ├── config.json          workspace marker
    ├── conventions.md · learned.md · skill-candidates.md
    ├── tools/               verify-links.js, lib/untouchable.js
    ├── desk/                daily/<year>/ · tasks/ · inbox/
    ├── knowledge/           people/ · wiki/ · archive/
    ├── personal/            private — read on demand only
    └── user/                drop folder — files the owner leaves for import
```

Everything Joserah owns lives under the single hidden `.joserah/` folder, so
the workspace root stays uncluttered for whatever else you keep there.

## Security

`keys/` is protected in layers, not by one wall. The deny rules catch common
accidental reads; pattern rules cannot make Bash access impossible. The
layers are: the `Read()` deny rule, the workspace AGENTS.md instruction,
backups excluding keys by default, and the secret scan on the repository
route.

**The `Read(./keys/**)` deny rule matches a `keys/` directory at any depth,
not only the workspace root** — the `./` prefix does not anchor it. If a
project checked out under `projects/` (or anywhere else in the workspace)
happens to contain its own `keys/` directory — a common name — that
project's `keys/` becomes unreadable too, denied the same way, with no
message explaining why. This is a known limitation of Claude Code's
permission-rule matching, not something Joserah's config can turn off; if
you hit it, the fix is to know the cause rather than to expect a syntax that
anchors the rule to the workspace root. It also means the plugin's own
`templates/keys/AGENTS.md` cannot be read by an agent (see the doctor
skill's repair table), which is why that one repair uses a copy command
instead of read-then-write.

## Docker

Joserah does not scaffold containers — a `docker-stack/` folder is
documented, never shipped. When a project actually needs one, the split is:
code stays under `projects/{Owner}/{Project}/`, tracked in that project's own
git history; runtime state (volumes, database files, anything the container
writes) goes to `docker-stack/{project}/` at the **workspace root**, never
under `projects/`. Neither `projects/` nor `docker-stack/` is ever tracked by
the workspace repo. `/joserah:project` offers this only when it would
otherwise mean installing a language runtime, database, or service
system-wide.

## MCP

MCP server configuration lives in `.mcp.json` at the workspace root, outside
`.joserah/` entirely. `/joserah:project` proposes specific servers when a
project needs to reach outside data — naming candidates and what each would
need — but it never configures one on its own initiative; the owner always
decides.

## Upgrading from 0.1.x

0.2.0 moves everything Joserah owns under one hidden folder: `desk/`,
`knowledge/`, `personal/` and `keys/` all move under `.joserah/`. An existing
workspace is migrated by moving those four folders under a new `.joserah/`
directory and repointing the relative links in `AGENTS.md` and anywhere else
that referenced the old paths. Run `/joserah:doctor` afterwards to confirm
the move is complete. **If you're catching up from 0.1.x straight to the
current release, `keys/` does not stay under `.joserah/` for long — the very
next section moves it back out to the workspace root in 0.3.0. Do both moves
in the same sitting rather than the first one alone.**

### Upgrading to 0.3.0

`keys/` moves from `.joserah/keys/` to the workspace root — the owner
populates it by hand, so it now lives where hands can find it. Existing
workspaces keep working, but `/joserah:doctor` will flag the old location
and walk you through the move (its "Migrate a pre-0.3.0 workspace" section).
Backups exclude both locations by default (except `keys/AGENTS.md`, which
carries no credential and is always kept in so a restored workspace still
passes doctor) and now **ask** whether keys should be included.
`archive.js extract` refuses to overwrite existing files without `--force`,
and a new `verify` command checks an archive's integrity.

### Upgrading to 0.4.1

The prompt (`AGENTS.md`) now carries its own version — a
`<!-- joserah:prompt-version N -->` line — separate from the plugin's. A
change to the standing instructions no longer needs a plugin release or an
IDE restart. The session-start hook pulls the marketplace clone once a day
and, when the workspace's `AGENTS.md` is untouched and behind, replaces it on
the spot; the next conversation runs on the new text. `/joserah:update` does
the same by hand, plus the migration and the other plugin-owned files. The
tools record what they installed in `config.json` (`promptVersion`,
`promptSha256`), so `/joserah:doctor` can tell a workspace that is merely
*behind* from one whose `AGENTS.md` was *hand-edited* — the first is
refreshed in place, the second is never overwritten without `--force`, and
`--force` keeps the displaced text beside the file. Hand-edits belong in
`.joserah/directives.md`, which `migrate.js` now creates when it is missing
(it never modifies an existing one) and doctor now requires. Existing
workspaces from 0.3.x–0.4.0 have an unversioned `AGENTS.md`: doctor and the
session briefing will say so; `migrate.js` brings it current when it is
byte-identical to a known prompt, and `/joserah:update` walks the owner
through the rest when it is not. A newer *plugin* is still only announced —
that update, and the restart after it, stay the owner's.

### Upgrading to 0.5.0

Source material now lands in `imports/` instead of `raw/`; doctor flags a
root `raw/` and `tools/relocate-imports.js` moves it and rewrites the links.
`raw/` stays recognised, so older workspaces keep working. Notes now carry
typed claim lines — `measurement`, `calculation`, `decision`, `estimate` —
audited by `tools/check-claims.js` in doctor. The prompt moves to version 2.

### Upgrading to 0.6.0

One library now says which paths a tool may not walk into
(`tools/lib/untouchable.js`), and the workspace's own copy of the link
checker travels with it — `/joserah:doctor` reports it stale if either
file drifts, and `/joserah:update` copies both. One command,
`tools/relocate.js`, carries a workspace from any earlier source-material
layout to `imports/`. The backup skill gets its scope from
`tools/backup-scope.js` instead of restating it. Doctor's checks are a
registry, and a test holds the doctor skill's remedy table to it. The
standing prompt is unchanged, still version 2, so this is a plugin update
and not a `/joserah:update` of the prompt.

### Upgrading to 0.7.0

Two layers that every session was only *told to read* are now put in front of
it: the workspace's role file (`JOSERAH-ROLE.md`) and its own standing rules
(`.joserah/directives.md`) are injected at session start, in full, alongside
the rest of the briefing. They were pointed at before, and a pointed-at file is
usually never opened — which meant a workspace's own written rules were in
force only in the sessions that happened to go and fetch them. Nothing of
yours is rewritten: the directives file is never touched, and an untouched
skeleton, an empty file or a missing one still adds nothing to a session. A
file long enough to be shortened arrives with a `[cut]` line saying exactly how
much was left out, and `/joserah:doctor` now prints `standing context size` on
every run and warns before any file gets that long. The standing instructions
changed with it — prompt **v3**, whose opening no longer sends a session off to
open files it has already been handed — so this is both a plugin update and a
`/joserah:update` of the prompt.

### Upgrading to 0.8.0

The claim audit no longer reports "0 errors" about lines it could not read.
Three ways a claim used to fall out of `check-claims.js` in silence are now
errors: a bracket category that is not one of the four types but carries claim
fields under it (`unknown-claim-type`), a field line whose fields are separated
by something other than ` · `, which makes the first field swallow the rest
(`swallowed-field`), and a line sitting between a claim and its field lines —
usually the claim's own sentence wrapped — which cuts every field off from it
(`severed-claim`). Each one hid a claim, or its fields, from every existing
check while the tool declared the file clean, so each fails `/joserah:doctor`
until it is fixed; nothing is rewritten for you and no line is guessed at. Run
`/joserah:doctor` after updating: a workspace that passed before may now have
claims to repair, which means those facts were never being audited. The
standing prompt is unchanged, still version 3, so this is a plugin update and
not a `/joserah:update` of the prompt — the conventions file gains the two
mechanical rules and travels with the workspace as usual.

### Upgrading to 0.9.0

The standing prompt moves to version 4 and nothing else changes: no code, no
tools, no new files. It takes in the behaviour rules decided on 2026-09-12 —
every turn ends with what was done, the one thing you have to do (or nothing)
and the next step; a finding counts only once you have read it in the
conversation, and nothing is put to you for approval that you have not seen;
questions come in your words with the option and what it costs, never an
internal label; a measurement outranks a calculation and both are read; a
number never travels without its conditions and an unsourced one carries no
weight; a source is cited only after it has been opened and the figure seen; a
struck-through claim is not used again; "done" comes with the output of a
command just run. Four rules the owner considered were deliberately left out,
because they are about spreading work across models and only some setups can do
that — a promise this file cannot keep everywhere does not belong in it. The
file also went back under 200 lines, so the additions cost nothing in length.

Because only the prompt changed, this reaches an existing workspace through
`/joserah:update` — no plugin reinstall is needed. Run it, and your
`AGENTS.md` is replaced with version 4; a hand-edited one is refused rather
than overwritten, and `/joserah:doctor` will tell you so.

### Upgrading to 0.10.0

Three new skills and one new hook. The skills carry the rules from the same
2026-09-12 list that only make sense where work can be handed to another agent
or session, so they load when they are needed instead of sitting in the
standing prompt: `research` (how a fact-gathering job is briefed out, how its
report comes back, and checking what a delivered report deleted before reading
what it added), `dispatch` (effort follows the remaining quota, and a second
local session counts as a lane), and `plan` (whoever executes a plan stops when
plan and reality disagree rather than improvising). The hook runs the link
check after a move or rename and speaks only when something broke — silent
otherwise, and silent outside a workspace.

The standing prompt is unchanged, still version 4, so nothing needs
`/joserah:update`; this is a plugin update and the new hook starts working
after the restart that follows it.

## Requirements

- Claude Code
- Node.js 18 or newer on your `PATH`
- **On Windows: [Git for Windows](https://git-scm.com/download/win)**, which
  provides the `bash` the hooks are executed with. Without it the hooks do not
  run and the automatic parts of Joserah stay silent.
- The [superpowers](https://github.com/obra/superpowers) plugin. Install it
  first — Joserah deliberately does not declare it as a manifest dependency,
  because Claude Code resolves bare dependency names inside the *same*
  marketplace and superpowers lives in another one:
  ```
  /plugin marketplace add anthropics/claude-plugins-official
  /plugin install superpowers@claude-plugins-official
  ```

Windows, macOS and Linux. Claude Code runs every hook command through a shell,
so Joserah's hooks declare `"shell": "bash"` and give Node an absolute script
path — one command string that behaves the same on all three platforms, given
a bash to run it in.

## Brand

Burgundy `#8B0D32`. No vector source exists for this mark — the Drive folder
that holds it has no SVG or AI file, only the PNGs in `assets/`.

## What is coming

A visual layer over the same files — the workspace as something you can look
at, not only talk to. The files stay the source of truth either way; that is
the whole point of keeping them plain.

## Licence

MIT for the code. The Joserah name and logo are not part of that grant.

### Upgrading to 0.11.0

The update stopped pretending it was the whole job. It never reads a note — by
design, so that it stays fast and cannot damage anything — which meant a
workspace could finish an update knowing the claim format and holding no
claims: the format moved on and the content did not. Two things close that.

**Structure notes.** A release that changes what a workspace should *look*
like now ships a note saying so, one file per such release under
`docs/migrations/`, named for its version. `/joserah:update` reads every note
newer than `migratedTo` in `config.json`, oldest first, does what each says —
some steps are a command, some are the owner's decision — and stamps
`migratedTo` only when they are done. A declined step leaves the stamp where it
is, so the question comes back rather than disappearing. Doctor warns when
notes are pending. The first note, `0.11.0`, describes the layout every
workspace should have reached: source material in `imports/`, load-bearing
numbers as claim lines, and the two new config keys.

**`/joserah:sweep`.** The pass that actually reads the pages: it tidies their
structure and turns the numbers in their prose into claim lines, in one reading
rather than two. It works on what changed since `lastSweep`, so a regular sweep
is small; with no stamp it is the first sweep and reads everything, which it
says up front because that one is expensive. It hands the reading out, checks
what comes back by reading the deleted lines in the diff before the added ones,
and stamps `lastSweep` only after the link, claim and doctor checks are clean.
Doctor asks for one when the notes have gone unswept — measured from the last
sweep, or from the day the workspace was created when there has never been one.

Both warnings are warnings, not failures: a workspace whose content is behind
its format is not broken, it is behind.

### Upgrading to 0.11.1

The sweep treated a missing `lastSweep` as proof that nothing had ever been
done, and offered to read every page in the workspace — in front of an owner
whose notes had been harvested the day before by a one-off job that stamped
nothing. The work predates the skill everywhere it is installed, so the stamp
can only ever be evidence that a sweep ran, never that one did not.

It now looks for the work instead of the stamp: a page already carrying claim
lines with their sources has been harvested and is tidied rather than
re-derived, and the recent journal is scanned for a bulk pass whose date the
owner can confirm as the starting point. The page count is quoted after that,
not before.

### Upgrading to 0.11.2

The session briefing took the first three sections of `learned.md` and called
them the newest. That is only true while the file happens to be written
newest-first, and nothing enforces that: in a workspace kept the other way
round, or one where a single entry was appended at the bottom, the newest rules
reached no session at all — while the owner could see them written down and
reasonably assume they were in force. The briefing now picks by the date in each
heading, so the newest three travel wherever they sit in the file, and a section
with no date is not mistaken for a learning.

The sweep also stopped splitting the reading further than the work needs. Every
agent pays the same fixed opening cost whatever it is handed — the claim format,
its own link check, auditing what it wrote — so eight agents over small folders
pay it eight times for the reading three would have done. Small folders are
grouped; a folder gets its own agent when it is big enough to earn one.

### Upgrading to 0.11.3

Every walk the plugin makes — the link check, the migration scan, the claims
audit, the changed-since count, the secret scan, the zip backup and doctor's
placeholder scan — now skips hidden directories other than `.joserah` and
`.claude`. A hidden folder is a tool's, not the owner's: editor servers, model
caches, package caches. A workspace rooted at a home directory holds dozens of
them, and the scans were reading thousands of their markdown files as notes.

`.joserah/config.json` also accepts an optional `scope` list — the root entries
that ARE the workspace. When the key is present, nothing else at the root is
walked, zipped, migrated or link-checked. An ignore list was the wrong way
round: a home directory grows new tool folders without asking, so the list
could never be finished, while the handful of folders that are the owner's own
work can simply be named. The plugin's own shell (`.joserah`, `AGENTS.md`,
`JOSERAH-ROLE.md`, `keys/`, `projects/`, `imports/`) is always in scope and
never needs selecting. Nothing writes the key; a workspace rooted at a home
directory sets it by hand:

```json
"scope": [".claude", "notes"]
```

Entries are matched on their first path segment, so naming a folder takes
everything under it. A workspace without the key, and without hidden tool
folders, scans exactly as it did before.
