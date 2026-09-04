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
**verbatim** into `raw/` at the workspace root — outside `.joserah/`, so a
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
├── raw/                source material, verbatim — outside .joserah/, excluded from repo backups
│
└── .joserah/
    ├── config.json          workspace marker
    ├── conventions.md · learned.md · skill-candidates.md
    ├── tools/               verify-links.js
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
