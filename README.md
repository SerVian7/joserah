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

Clone this repository, open your assistant in the folder where you want your memory, and paste:

```
Install Joserah from <path-to-clone> and set it up for me.
```

*(For the assistant: the steps are in `skills/setup/SKILL.md` inside that clone — follow them.)*

It notices which assistant it is running in, makes Joserah load there, creates the workspace, and
asks a few short questions: where, your name, a name for the assistant if you want one. It speaks
the language you write in.

**Antigravity or another assistant:** Joserah runs in *AGENTS.md-only mode* there — your files and
the standing instructions work, the automatic parts do not. See below.

## Where Joserah runs

**Claude Code.** Setup links the clone as `~/.claude/skills/joserah`. The Claude Code docs:
"Your personal skills directory is `~/.claude/skills/`. Claude Code loads any folder there that
contains a `.claude-plugin/plugin.json` as a plugin in every session, with no flag and no install
step" ([Create plugins](https://code.claude.com/docs/en/plugins/create#scaffold-a-plugin-that-loads-every-session)),
and such a plugin "loads in place and is never copied"
([Plugin loading](https://code.claude.com/docs/en/plugins/loading#in-place-and-copied-plugins)).
It appears as `joserah@skills-dir`. The docs do not say whether a link in that folder is followed;
Joserah relies on it. By hand, with `<clone>` the absolute path:

```
Windows (cmd):         mklink /J "%USERPROFILE%\.claude\skills\joserah" "<clone>"
Windows (PowerShell):  New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\joserah" -Target "<clone>"
macOS / Linux:         mkdir -p ~/.claude/skills && ln -s "<clone>" ~/.claude/skills/joserah
```

Then restart Claude Code once. `/joserah:update` pulls the clone (`git pull --ff-only`), brings the
workspace along, and `/reload-plugins` loads the new code; the session briefing says when the clone
has new commits upstream.

**Antigravity — AGENTS.md-only mode.** Antigravity reads a workspace-root `AGENTS.md` as a rule that
is always active ("Antigravity treats its entire content as plain Markdown and keeps it continuously
active (`always_on`)", [Rules](https://antigravity.google/docs/rules/)); it does not read `CLAUDE.md`.
Setup adds `.agents/rules/joserah.md`, an `always_on` rule that inlines `JOSERAH-ROLE.md` and
`.joserah/directives.md` with Antigravity's `@[label](path)` syntax. Antigravity has hooks of its own
(`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`, in `.agents/hooks.json`,
[Hooks](https://antigravity.google/docs/hooks/)) with a different input and output than Claude
Code's, and no session-start or prompt-submit event; Joserah's hooks are not ported to it. So:

| Does not run | Instead |
|---|---|
| Session briefing (date, open tasks, today's journal, learnings) | The assistant opens `.joserah/desk/tasks/now.md` and today's journal at session start |
| Capture hook ("remind me", "kaydet") | The assistant writes the capture itself |
| Vault guard | `AGENTS.md` rule 3 still applies — by instruction only |
| Tool-call nudge | `AGENTS.md` §2 "one lookup, then the answer" |
| `/joserah:*` skills | Ask for the step by name; the files are in the clone's `skills/` |

**Any other assistant** — the same AGENTS.md-only mode, minus the `.agents/rules` file: most tools
read a root `AGENTS.md`. Whether yours does is in its own documentation.

`node tools/detect-harness.js` prints which assistant setup found, and the evidence.

Already have years of notes lying around? `/joserah:import` takes the pile.

## What you get

| | |
|---|---|
| **A journal that writes itself** | Today's entry is created and read into every session. You never open it on purpose. |
| **Capture without commands** | Say "remind me" or "kaydet" mid-sentence and it lands in your inbox, timestamped. |
| **Context that arrives on its own** | Open tasks and recent decisions are in the session before you type. |
| **A workspace that explains itself** | Its `AGENTS.md` tells any assistant how to behave in it — routines included. Works with Claude Code today; the format is model-agnostic on purpose. |
| **A graph, not just files** | Notes carry typed `[[relations]]`, so the knowledge is a graph you can also open in Obsidian — no database, no service. |

## The skills

| | |
|---|---|
| `/joserah:setup` | Create a workspace where you want it, then get interviewed so it fills in. Stop and resume freely |
| `/joserah:import` | Bring in existing notes, exports, document piles |
| `/joserah:project` | Start new work: plans first, then a project folder, a drop folder, and optional containers or MCP servers |
| `/joserah:doctor` | Check a workspace is healthy, and repair it |
| `/joserah:update` | Bring a workspace current: refresh the standing instructions and the other plugin-owned files, run the migration, report when the plugin's own code needs an update |
| `/joserah:backup` | Write the workspace to a ZIP, or mirror it to a **private** git repository so two machines share it. A ZIP stays on your disk; a repository puts your journal and notes about people on a third party's server, so it asks first |
| `/joserah:correspondence` | Mail in and out: who it may go to, what a counterparty's message is worth, and the template it is sent in |
| `/joserah:orchestrate` | Place a piece of work at an effort tier, brief it, check what comes back, and report once when it is done |
| `/joserah:sweep` | Tidy the notes and turn their numbers into sourced claim lines |
| `/joserah:feedback` | Send the developer an anonymised note when Joserah itself misbehaves |

## How it works

A workspace is any folder holding a `.joserah/config.json`. The plugin's hooks
look for that marker and stay quiet everywhere else — so you install Joserah
once and keep as many workspaces as you like. The plugin's *code* updates all
of them at once; its *standing instructions* — the `AGENTS.md` every workspace
carries — are versioned apart from the code and brought current per workspace
at session start, with a new conversation and no restart (see CHANGELOG.md).

`.joserah/config.json` carries what is true of the workspace: `workspaceName`,
`ownerName`, `assistantName`, `dialogueLanguage`, `trust`, `kind`. Scaffolding
writes those. Two more are added by hand when they apply — `scope` (see
CHANGELOG.md, 0.11.3) and `ownerIsDeveloper`:

```json
"ownerIsDeveloper": true
```

Set it when the owner of the workspace builds this software. The session
briefing then names files, tools, commits and versions plainly instead of
keeping to the level the owner is speaking at. Absent is the default, and a
client's workspace must not have it.

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
├── CLAUDE.md          imports AGENTS.md, JOSERAH-ROLE.md and directives.md for Claude Code
├── JOSERAH-ROLE.md    who the assistant is talking to
├── .gitignore
├── .claude/settings.json   permission deny rules — carries the Read() guard on keys/
├── projects/           {Owner}/{ProjectName}/ — never tracked; each has its own git
├── keys/               SENSITIVE — the vault, read only through secret.js
├── imports/            source material and the drop folder, verbatim — outside .joserah/, excluded from repo backups
│
└── .joserah/
    ├── config.json          workspace marker
    ├── conventions.md · directives.md · agent.md · learned.md
    ├── tools/               verify-links.js, lib/untouchable.js, secret.js
    ├── desk/                daily/<year>/ · tasks/ · inbox/
    ├── knowledge/           people/ · wiki/ · archive/
    └── personal/            private — read on demand only
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

Containers are offered by `/joserah:project` only when they avoid a system-wide install; layout in
the workspace's `conventions.md`.

## MCP

MCP server configuration lives in `.mcp.json` at the workspace root, outside
`.joserah/` entirely. `/joserah:project` proposes specific servers when a
project needs to reach outside data — naming candidates and what each would
need — but it never configures one on its own initiative; the owner always
decides.

## Shared memory

A *Joserah Memory* is a company's shared memory in its own git repository: records, a few tools and
an `AGENTS.md` any assistant can follow, with or without Joserah. Each member's assistant writes
only in `members/<name>/` and `inbox/`; one sweeper merges the inbox into `knowledge/`, so commits
never collide. Nothing personal and no secret goes in. Say "this repo is our shared memory: <url>"
to clone one into `.joserah/shared/<name>/` (setup runs `scaffold.js --join-memory`), or "set up a
shared memory for <company>" for a new one (`scaffold.js --kind memory`). The session briefing then
shows, per memory, how far it is behind, whether a sweep is due and your own open items there. Your
name inside it is your first name, lowercase; `.memory/me` overrides it. A `.brand/` folder in the
memory holds the company's logo and colours for reports about it.

## Upgrading

Run `/joserah:update`. Release notes: [CHANGELOG.md](CHANGELOG.md).

## Requirements

- Claude Code (or AGENTS.md-only mode in another assistant — see Install)
- Node.js 18 or newer on your `PATH`
- **On Windows: [Git for Windows](https://git-scm.com/download/win)**, which
  provides the `bash` the hooks are executed with. Without it the hooks do not
  run and the automatic parts of Joserah stay silent.

Windows, macOS and Linux. Claude Code runs every hook command through a shell,
so Joserah's hooks declare `"shell": "bash"` and give Node an absolute script
path — one command string that behaves the same on all three platforms, given
a bash to run it in.

## Brand

Burgundy `#8B0D32`.

## What is coming

A visual layer over the same files — the workspace as something you can look
at, not only talk to. The files stay the source of truth either way; that is
the whole point of keeping them plain.

## Licence

MIT for the code. The Joserah name and logo are not part of that grant.
