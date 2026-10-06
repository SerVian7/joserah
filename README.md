<img src="assets/logo.png" alt="Joserah" width="120">

**A memory for your AI assistant, made of files you own.**

*Pronounced "Yosera."*

Your assistant forgets you between sessions. Joserah is the folder that remembers: a daily journal,
your open work, the people around it, the rules you have taught the assistant, and a vault for your
passwords. It is all plain markdown on your disk, in your language. There is no database, no account
and no lock-in. In Claude Code it runs as a plugin, with hooks and skills. In other assistants it runs
in AGENTS.md-only mode: the same files and the same standing instructions, without the automatic parts.

## Install

Open your assistant in the folder where you want your memory, and paste one of these:

```
Install Joserah from https://github.com/SerVian7/joserah and set it up for me.
Joserah'ı şuradan kur: https://github.com/SerVian7/joserah
```

Setup clones the repository for you (to `~/joserah`, on Windows `%USERPROFILE%\joserah`). A private
fork's URL works the same way.

Setup works out which assistant it is running in (`tools/detect-harness.js` prints what it found and
why) and sets Joserah up the right way for it. Then it asks up to four short questions: where the
memory goes, your name, a name for the assistant if you want one, and your language, which it guesses
from how you write.

**Claude Code.** Setup links the clone into your personal skills folder as `~/.claude/skills/joserah`.
Claude Code loads it from there in every session as `joserah@skills-dir`, in place and never copied.
To make the link by hand, with `<clone>` as the absolute path:

```
Windows (cmd):         mklink /J "%USERPROFILE%\.claude\skills\joserah" "<clone>"
Windows (PowerShell):  New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\joserah" -Target "<clone>"
macOS / Linux:         mkdir -p ~/.claude/skills && ln -s "<clone>" ~/.claude/skills/joserah
```

After that, restart Claude Code once. You need Node.js 18 or newer. On Windows you also need
[Git for Windows](https://git-scm.com/download/win), because the hooks run in its `bash`. Without it
they never fire.

**Antigravity and other assistants.** Most of them read a root `AGENTS.md`, so your files and the
standing instructions work there. For Antigravity, setup also adds an always-on rule
(`.agents/rules/joserah.md`) that brings in the role and the directives. What does not run there:
the session briefing, the capture hook, the vault guard and the `/joserah:*` commands. The assistant
opens your tasks and today's journal itself, writes captures by hand, and runs any step you ask for
by name from the clone's `skills/` folder.

## The web server (0.19.0)

Joserah can also run as a small web server on your machine: the Tracker and other pages live in the
browser, you answer rows there, and give jobs that your own signed-in Claude Code carries out. It runs
natively (`joserah serve`) or self-contained in Docker. See [server/README.md](server/README.md).

## What you get

**A briefing that is never cut.** Each session opens knowing the date, your open tasks, today's
journal and your newest learnings. Claude Code quietly replaces the output of any single hook command
that runs past 10,000 characters with its first 2,000. For about a week that meant no workspace rules
reached a session at all. Joserah now splits the briefing over two hook commands, keeps each under
8,000 characters, and hands the standing files over through `CLAUDE.md` imports. Today's journal is
capped: its opening lines and the newest 1,500 characters arrive, and a `[cut]` line says what was
left out. Learnings beyond the newest three are listed by title, so no rule is dropped without notice.
Reminders to back up or sweep come at most once a day, and only once something has piled up.

**A vault.** Passwords and tokens are kept in `keys/secrets.json` and read only through
`.joserah/tools/secret.js`. Notes carry a secret's name (`acme.router.password`), never its value. The
assistant uses a value inside a command, `$(node .joserah/tools/secret.js <name>)`, and never prints
it. To save one, `secret.js --set <name>` opens a small Joserah Vault window on your screen where you type
the value and the assistant never sees it; over SSH or a remote session it asks in your terminal instead, showing nothing as you type. `--index` writes `.joserah/vault-index.md`, the list of names that is the
only vault file the assistant reads. `--import` brings in an old vault (JSON, a collector's record list
or a `.env` file), lists names only and never overwrites a value. `--remove <name>` deletes a name
from the vault. `secret-scan.js --extract` moves a
password it finds in a note into the vault, and the note calls it by name from then on.

**Routines nobody has to ask for.** Say "remind me" or "add to my todos" and the note is captured with
a timestamp, then moved to your tasks, a project or a person. Something you did or decided today goes
into the journal. A new name gets a page under `knowledge/people/`. A correction ("from now on…")
becomes a one-line rule in `.joserah/learned.md` that every later session reads.

**A Daily Tracker.** The assistant keeps a small live page of your day — what is running, what waits
on you, what is done, what is planned — without being asked and without nagging, and ends every reply
with its link. Set `"dailyTracker": false` in `.joserah/config.json` to turn it off. Set `"sharedMemoryAutoPush": true` there to have shared-memory pushes done without asking (default off; the assistant still asks when something is genuinely problematic). Price research
reads `research.trustedSources` there, a list of the shops you trust.

**Numbers that keep their source.** A fact that decisions rest on is written as a claim line,
`- [measurement|calculation|decision|estimate] <subject> -> <value>`, with its conditions, date and
source underneath. A number without a source carries no weight. A refuted claim is struck through,
never deleted.

## Shared memory

A *Joserah Memory* is a team's shared memory in its own git repository: plain records, a few tools and
an `AGENTS.md` that any assistant can follow, with or without Joserah. Create one by saying "set up a
shared memory for <company>" (`scaffold.js --kind memory`). Join one by saying "this repo is our shared
memory: <url>", which clones it into `.joserah/shared/<name>/`. Each member writes only in
`members/<name>/`, `inbox/` and `questions/`. A question for a colleague is a file addressed to them,
and their next sync lists it for them. `sync.js --push` shows what leaves your machine, then
pushes; it waits for you only on a deletion or a file outside your own folder, `inbox/` and `questions/`. One person, the sweeper, merges the inbox into
`knowledge/`, so commits never collide. Nothing personal and no password goes in. The briefing shows,
for each memory, whether it is up to date, whether a sweep is due, and your open items there. A project's page in the memory carries `repo:` and `Last change:`; a commit in the project reminds the assistant to update it, and every pull reports the pages that fell behind their repo.
The memory works without Joserah: anyone with git and Node can use it, and every pull runs its own
link and claim-line checks. Verified procedures go in as records; tools are proposed at sweeps and written only from records (Node by default, PowerShell only where the host is Windows-only). When a member who has Joserah updates it, their update refreshes the
memory's tools and rules and pushes them after the usual notice. Without Joserah the clone lives at `~/<name>`, one per machine, and every workspace on that machine points at it. Every commit or push report names its target first: `workspace backup`, `shared memory <name>` or `project <name>`, with the remote.

## Skills

| | |
|---|---|
| `/joserah:setup` | Create a workspace, or join or create a shared memory |
| `/joserah:import` | Bring in existing notes, exports and piles of documents, copied verbatim into `imports/` |
| `/joserah:project` | Start a larger piece of work: a plan first, then a project folder |
| `/joserah:doctor` | Check that a workspace is healthy and repair it |
| `/joserah:update` | Bring Joserah and the workspace up to date |
| `/joserah:backup` | Save the workspace as a ZIP, or mirror it to a private git repository (it asks before your notes leave the machine) |
| `/joserah:sweep` | Tidy the notes and turn their numbers into sourced claim lines |
| `/joserah:correspondence` | Mail in and out: who it may go to, what a counterparty's message is worth, and the template it is sent in |
| `/joserah:orchestrate` | Hand work to background agents, brief them, check what comes back |
| `/joserah:feedback` | Send the developer an anonymised note when Joserah itself misbehaves |

## Layout

```
<workspace>/
├── AGENTS.md · CLAUDE.md · JOSERAH-ROLE.md   standing instructions (plugin-owned)
├── projects/     your own work, each with its own git history
├── imports/      source material, verbatim, left out of repository backups
├── keys/         the vault
└── .joserah/     config.json · directives.md (your own rules) · learned.md · vault-index.md
                  desk/ (journal, tasks, inbox) · knowledge/ (people, wiki) · personal/ · tools/
```

Any folder with a `.joserah/config.json` is a workspace. The hooks stay quiet everywhere else, so
one install serves as many workspaces as you like. Rules that apply only to one workspace go in its
`.joserah/directives.md`, which no update touches.

## Upgrading

Run `/joserah:update`. Release notes: [CHANGELOG.md](CHANGELOG.md).

It pulls the clone and brings the workspace's standing instructions and structure up to date. Then
run `/reload-plugins`; no restart is needed. The briefing tells you when there are new commits upstream.

## Developing Joserah

Run the suite with `node --test tests/*.test.js`. Every release bumps the plugin version in
`.claude-plugin/plugin.json` and in both places in `marketplace.json`, and adds a section to
`CHANGELOG.md`. Any change to `templates/AGENTS.md` also bumps its `prompt-version` line. The rest,
including the rule against personal data, is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT for the code. The Joserah name and logo are not part of that grant.
