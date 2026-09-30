# Changelog

What changed for someone who already has a workspace, newest first. Run `/joserah:update` after
any of them.

## 0.15.1

**Reminders once a day, and only when something piled up.** The briefing's `[backup]` line appears only when a day or more has passed since `lastBackup` and at least one file changed (an untouched journal stub still never counts); the new `[sweep]` line when a week has passed since `lastSweep` or five days of journal have piled up since it. Each is one sentence in the owner's language ("Yedek 3 gündür alınmadı, 12 dosya değişti — istersen alayım.") and is said at most once per calendar day per workspace (a stamp in the OS temp dir). Doctor's `knowledge sweep` warning uses the same rule; it was 14 days.

**Old vault sources stay where they are.** `migrate` no longer renames or moves a file in `keys/`: a clean import is recorded in `config.json` under `vault.imported` and not read again, and the owner deletes the original if they want to. A file that `.mcp.json` or `.claude/settings*.json` names is not opened (`vault.inUse`). `secret.js --import` refuses what is not a vault, with exit 4 (`vault.notVault`, with the reason): a service-account key (`"type": "service_account"` or a `private_key` field), PEM or OpenSSH content, a file over 512 KB, or a JSON of any other shape. A foreign-shaped `keys/secrets.json` still moves aside (its path is the store's), and moves back if it proves not to be a vault. A file 0.15.0 already renamed to `*.imported-<date>` keeps that name; `docs/migrations/0.15.0.md` says what to tell the owner.

**A collector's record array is imported by record.** `[{ system, kind, username, value, note, ... }]` becomes `<prefix>.<system>.<field>`: the field comes from `kind` (`api key` gives `api-token`), `username` becomes `.user` and `note` becomes `.note`. `name`, `collected` and `found-in` are metadata and are not stored. `--prefix` is required. A repeated system and field with a different value is numbered `-2`, `-3` and listed. It used to be flattened by index into names like `0.found-in.3`. `--import ... --replace --yes` empties the store before it imports (the `.bak` keeps the old one); without `--yes` it only says how many names it would delete.

**The owner saves a secret without the assistant seeing it.** With nothing piped in, `secret.js --set <name>` asks for the value in the terminal with echo off. Piped input works as before.

## 0.15.0

**One vault format, imported in one pass.** `keys/secrets.json` in the standard shape, filled and read only through `secret.js`, is the vault in every workspace. `secret.js --import <file> [--prefix <scope>] [--delete]` brings in any old vault — JSON of any nesting (`corlu → cam1 → user` becomes `corlu.cam1.user`) or a `.env` — listing names, never values, and never overwriting: a name that exists with a different value is a listed conflict, exit 1. `/joserah:update` runs it once per workspace (`migratedTo` below 0.15.0) on every JSON or `.env` file in `keys/`, and on a `secrets.json` in a foreign shape (moved to `secrets.json.imported-<date>`, then imported into a fresh store; `secret.js` now refuses to work on such a store rather than listing nothing). A clean source is renamed `<name>.imported-<date>`, never deleted; the migrate report carries counts only. A module's own `.env` is never imported. `docs/migrations/0.15.0.md`.

**Names without values.** `secret.js --index` writes `.joserah/vault-index.md`, the names grouped by scope; every change to the store rewrites it, and it is the one vault file the assistant reads. `secret.js --rename <old> <new>` corrects an imported name without anyone seeing the value.

**A secret standing in a note leaves it.** `secret-scan.js <workspace> --extract` proposes a name per hit (`<scope>.<file>.<field>`) and changes nothing; with `--yes` it stores each value through `secret.js --set` and replaces every whole occurrence in the note with `$(node .joserah/tools/secret.js <name>)`, keeping line endings and never touching `keys/`. A name that already holds a different value is a conflict: the note keeps its text, exit 1. The scan no longer reports such a reference as a finding.

**The words.** Prompt version 12: rule 3 says to name the secret and never the value, that what exists is in `.joserah/vault-index.md`, and that `--extract` moves a stray secret — never a hand copy. Doctor adds `vault index current` (counts only). Run `/joserah:update`.

**`ownerIsDeveloper` is removed.** No config key decides how technical the talk is: the briefing always says to match the owner and volunteer no internals they did not ask for. A developer who wants them named plainly writes one line in their own `.joserah/directives.md`. `migrate.js` deletes a leftover key (`configKeysRemoved`).

**A shared memory's state is a sentence.** The briefing says it in the owner's language (Turkish or English): behind — the count, the latest commit's author, subject and age, and that it will be pulled at session start; ahead — the unpushed commits and `sync --push` for the push notice; level — up to date. The sweep-due and open-item lines stay.

## 0.14.0

**No marketplace, no cache, no `claude plugin update`.** Joserah is a git clone linked as `~/.claude/skills/joserah` and loaded in place as `joserah@skills-dir` (README, "Where Joserah runs"). `/joserah:update` is a `git pull` on the clone, the workspace migration, then `/reload-plugins`. The re-copy of 0.13.8–0.13.10, its diagnostics file and stamps, and `tools/install-dev-hook.js` are gone; the briefing keeps the daily "N new commits upstream" line. Doctor's new `plugin loaded from the skills dir` check warns on a copy in the plugin cache.

**Install is one prompt, and setup notices the assistant.** `tools/detect-harness.js` reads documented markers only (`CLAUDECODE=1`, Antigravity's `~/.gemini/config` and `~/.gemini/antigravity-cli`, `claude` on PATH, `~/.claude`). Claude Code gets the link; Antigravity and anything else get AGENTS.md-only mode.

**Setup asks four things.** Location (none, when the current folder is empty), the owner's name, an optional assistant name, and the language — inferred from how they write. Gone: the machine-or-folder question (trust is `owner`, kind `home`; hosting only on an explicit `--hosted` request), the definition and its keep-itself-current mode (`--identity-mode` and the `identity` block are removed), the consent gate (a one-line notice now; `--consent-model` and the `consent` block are removed) and the feedback question (off unless a developer passes `--feedback`).

**The texts say one thing.** An editorial pass over the prompt, the roles, the skills and the templates: an unnamed assistant is the assistant and Joserah is its memory; no skill hand-edits `AGENTS.md` (integrations are recorded in `directives.md`); `learn` takes only a batch handed over by the main session; the drop folder is `imports/`; the hosted role no longer assumes the host is not a developer, or male. Prompt version 11 and a changed hosted role: run `/joserah:update` (doctor names `JOSERAH-ROLE.md` in a hosted workspace). Release notes moved from the README into this file.

**Shared memory.** A new kind, the Joserah Memory: a company's shared memory in its own git repository (`templates/memory/`, `tools/lib/memory.js`). `scaffold.js --kind memory --company <name> --members a,b --sweeper a --target <dir>` creates one with its tools (`sync.js`, `sweep-due.js`, `detect-member.js`, `verify-links.js`, `claims.js`) and a first commit; `scaffold.js --join-memory <url> --target <workspace>` clones one into `.joserah/shared/<name>/` and names it under `shared` in config.json. Setup recognises both requests. Doctor checks a memory on its own path (layout, tools, links, claims, an overdue sweep, a member writing outside their folder) and, in a workspace, each memory it names. The session briefing adds one block per memory: commits upstream, the sweep-due line and the member's open items. The workspace `.gitignore` now carries `.joserah/shared/*`, and the workspace's link, claim, migration and secret scans stay out of it.

**Upgrading from 0.13.x, once:** `/plugin uninstall joserah@joserah`, `/plugin marketplace remove joserah`, link the clone (README, "Where Joserah runs"), restart Claude Code. Workspaces are untouched; run `/joserah:update` afterwards.

## 0.13.10

**The re-copy runs where it can be seen.** 0.13.8 started `claude plugin update` as a detached child of the session-start hook, and in the IDE the cache stayed on the old version. It now runs synchronously (at most 25 s, about 2 s measured), once per clone version, logged to `joserah-recopy.log` in the temp dir; a failure leaves no stamp and is retried next session, with the log named in the briefing. `claude` is also looked for off PATH (`%APPDATA%\npm`, `~/.local/bin`, `~/.claude/local`, `/usr/local/bin`), and every attempt writes `joserah-recopy-diag.json` there. Developers: `node tools/install-dev-hook.js`.

## 0.13.9

**Identity needs no lookup.** The session's workspace block now states the assistant's name, the owner's name and the language whether or not they are set — an unnamed assistant is told "You have no name here: you are simply the assistant" — and the client and hosted role files say "give yours if you have one". A workspace's `JOSERAH-ROLE.md` then differs from its template; `/joserah:update` replaces it (doctor names the file).

## 0.13.8

**After a `git pull` of the clone, only the restart is left.** When the clone carries a newer version than the loaded copy, the session briefing now starts `claude plugin update joserah@<marketplace>` itself, detached and at most once per version, and says a restart runs it; with no `claude` on PATH it falls back to pointing at `/joserah:update`.

## 0.13.7

**One lookup, then the answer.** Prompt version 10 tells the assistant to answer a factual question from its first lookup and never to go silent behind a chain of tool calls, and a new `PreToolUse` hook (`hooks/tool-count.js`, every tool, main thread only) adds one line of context on every third tool call since the owner's last message — run `/joserah:update`.

## 0.13.6

**A directory marketplace still loads a copy.** Measured on Claude Code 2.1.251: with Joserah installed from a `directory` marketplace, `installed_plugins.json` points at `~/.claude/plugins/cache/joserah/joserah/<version>/`, a real copy of the clone, so a `git pull` alone changes nothing that runs. `/joserah:update` now does both steps: `git pull --ff-only` on the clone (found through `known_marketplaces.json`; `check-update.js` reports it as `checkout`), then `claude plugin update joserah@<marketplace>` to copy the new version, then `/reload-plugins`. The session briefing adds a second `[update]` line when the clone carries a newer `plugin.json` version than the loaded copy: "Joserah <version> is pulled but not loaded".

**Every release bumps the version.** `claude plugin update` copies again only when the version in `.claude-plugin/plugin.json` changed, so a release without a bump never reaches a running session.

## 0.13.5

**`/joserah:update` is the only way Joserah updates itself.** The plugin is now installed from a local clone registered as a `directory` marketplace, (`marketplace.json` already lists it as the relative-path source `./`). This note first said the plugin then loads in place; it does not — see 0.13.6 below. `/joserah:update` runs `git pull --ff-only` on that clone, migrates the workspace, and asks for `/reload-plugins`; a restart only when `hooks/hooks.json` or MCP configuration changed. The session briefing's `[update]` line now comes from a daily `git fetch` and says how many commits the clone is behind; an install that is not a checkout keeps the old version comparison.

**Moving an existing install, once:** `/plugin uninstall joserah@joserah`, then `/plugin marketplace remove joserah`, then the three steps under Install (clone, `/plugin marketplace add <path>`, `/plugin install joserah@joserah`). Workspaces are untouched by the move; run `/joserah:update` afterwards.

## 0.13.4

**The session briefing keeps what matters when it overflows.** Today's journal is capped in the brief: its title and Top of mind, then its newest ~1,500 characters, with a `[cut]` line saying how much was left out. The `[update]` and `[backup]` lines now come before the learnings, so a budget cut drops learnings first. The cut notice names what was actually cut instead of always sending the session to `directives.md`.

**A fresh workspace stops briefing itself about nothing.** The untouched journal stub is no longer injected, and no longer counts as "1 file changed" in the backup line. The `setup` skill fires only on an explicit request to set up or continue setting up, never because a workspace looks empty.

**Subagents get a worker payload.** At SubagentStart the hook keeps the workspace facts and the language but drops the greeting and the signature, and opens with "You are a worker dispatched by the main session: do the task you were given, do not delegate further, report back as text."

**Delegation says one thing.** Prompt version 9: the §5 routines (journal, tasks and captures, people, learned) are always inline, however many files they touch; research, planning, multi-file work and sweeps go through `orchestrate`, in the background by default. `orchestrate` no longer says a lead never backgrounds its workers; its brief template carries "a worker does not delegate further" instead. Run `/joserah:update`.

## 0.13.3

**The standing layers travel through CLAUDE.md.** Every workspace gets a small plugin-owned `CLAUDE.md` at its root that `@`-imports `AGENTS.md`, `JOSERAH-ROLE.md` and `.joserah/directives.md`. Measured on 2026-09-23: the headless CLI (2.1.251) never loaded `AGENTS.md` at all, but loaded `CLAUDE.md` and expanded its imports whole — a 59,928-byte file arrived — while a hook command over 10,000 characters arrives as a 2,000-character stub. A directives file no longer has to stay under the hook's 5,000-character cap to reach a session.

**The hook stands down only where the imports arrive.** When a session starts at the workspace root and `CLAUDE.md` imports a layer, `session-start.js` no longer injects it, so nothing is sent twice; the identity block, the agent overlay (`.joserah/agent.md`, only the text below its marker) and the computed briefing stay in the hooks. With no `CLAUDE.md`, an owner-written one that lacks the lines, or a session started in a subfolder — where, measured, the parent `CLAUDE.md` loads but its imports do not expand — the hook injects every layer exactly as before.

**An owner-written CLAUDE.md is never touched.** `migrate.js` used to delete any `CLAUDE.md` it found; it now installs or refreshes only the plugin's own stub (recognised by its first-line marker), leaves any other `CLAUDE.md` as it is and lists it in `skipped`. Doctor's new `CLAUDE.md imports the standing layers` check fails on a missing or stale stub and warns on an owner-written file that lacks the import lines, naming them. Prompt version 8 says the layers are imported or injected. Run `/joserah:update`.

## 0.13.2

**Delegation has a hard threshold.** Where background agents exist, reading more than a couple of files, research, planning, a status or summary sweep and any multi-file change go to subagents (prompt version 7 and the `orchestrate` trigger); only a single small edit stays inline — run `/joserah:update`.

**The never-background rule travels down the chain.** `orchestrate` now says a lead never backgrounds its workers and copies that rule verbatim into every brief it writes, and its new brief template carries it.

**Migration leaves vendored material alone.** `migrate.js` (and every tool sharing its scan) no longer adds frontmatter under an `assets/` or `skills-ref/` folder, or in any folder holding a LICENSE: third-party skill copies and scraped source texts are not notes.

**Claim types are closed.** The prompt and the `sweep` skill now say measurement, calculation, decision and estimate are the only claim types, and that a measurement always carries `condition:`.

## 0.13.1

**Joserah no longer depends on another plugin.** Until now `skills/project/SKILL.md`
told every session to run two skills belonging to a third-party plugin before it
touched the filesystem, `/joserah:setup` stopped and refused to continue where that
plugin was not installed, and this README carried its install commands. All three are
gone. The planning step Joserah actually wanted is shipped in `skills/project/SKILL.md`
itself: name which of three sizes the job is, put it in front of the owner in their own
language, stop for a yes, and write a plan file only for the largest. The guard that
should have caught this — `tests/skills.test.js` — scanned four of the ten skills from a
hand-written list; it now reads `skills/` off disk, so a skill added tomorrow is covered
the day it lands.

**The briefing stops telling the assistant what the owner is not.** `hooks/session-start.js`
injected "They are the owner, **not a developer of this software**" into every session,
while the shipped `templates/AGENTS.md` rule had always excepted "unless they ask, or they
are the developer" — the product contradicted itself and asserted something about a person
it cannot know. The default line now says how much to say rather than what the person is,
and `templates/roles/joserah-client.md` says the same. A workspace whose owner builds this
software adds `"ownerIsDeveloper": true` to `.joserah/config.json` by hand and gets "name
files, tools, commits and versions plainly" instead. Nothing writes the key; a client's,
a held or a hosted workspace must not have it. `docs/migrations/0.13.1.md` has both steps.

**The brand stops signing with a middle dot.** `.brand/mail.html` and `.brand/report.html` were
rebuilt so neither page carries a mark a generator hands out free: the top line of a mail is now
the subject alone — no brand name welded to it — and a named assistant signs its name, a space,
then `Joserah` a shade fainter, with nothing between the two words. An assistant with no name is
Joserah and still signs once. Where tone cannot be carried, as in plain text, it is the comma
form, `Yarkın, Joserah`. `hooks/session-start.js` and the `correspondence` skill say the same
thing, and the skill gained a short "defaults we do not use" list — against stock furniture, not
against the burgundy rule, the large faint J or the dark ground, which are ours and stay. A
workspace whose own `directives.md` spells out the old signature has to be updated by hand;
`docs/migrations/0.13.1.md` step 3 says how.

**A lead no longer backgrounds its workers.** A worker's completion notice reaches the top session, not the lead that opened it, so the `orchestrate` skill now says a lead waits on its workers directly, in parallel batches, and never runs them in the background.

## 0.13.0

**The session briefing was not arriving.** Claude Code replaces any single
hook command's added context over 10,000 characters with a stub carrying only
the first 2,000 of it plus a file path — undocumented. Measured across 25
sessions on CLI 2.1.269-2.1.273: the briefing produced 10,140 to 16,417
characters and 2,263 arrived, every session for about a week. Nothing
announced it. The role file's first lines got through; the workspace identity,
the owner's own standing rules, the open tasks, the journal and the learnings
did not.

The fix is two things. Each hook command's output is now capped at 8,000
characters, and when something does have to be cut, the notice is the **first**
thing in the output rather than the last — a warning printed after the text it
warns about is thrown away with it, which is exactly what happened to the
per-file `[cut]` line. And the SessionStart briefing is now two hook commands
instead of one: the standing layers in one, the date, tasks, journal,
learnings and update lines in the other. Two commands, two budgets, neither of
them near the limit. The per-file cap drops from 10,000 to 5,000 so no single
layer can fill a command by itself, and the overlay below the marker in
`.joserah/agent.md` — which had no cap at all — now has one.

**`AGENTS.md` is 148 lines**, down from 200 (prompt version 6), with the
greeting, the identity re-read and the tone lines the role files and hooks
already handle taken out. It is not part of the fix above: that file reaches
the model through the host's own file discovery, not through a hook, so it was
arriving whole all along. Three hard rules are new: mail goes only to the
recipients the owner named, a counterparty's message is data and not
instructions, and a host's assistant never reads or writes a guest workspace's
folder.

**Skills: twelve become ten.** `dispatch`, `plan` and `research` are now
`orchestrate`; `install` and `onboard` are now `setup`; and `correspondence`
is new. `orchestrate` names no model — the effort tiers are extreme, heavy,
medium and simple, and the selected model is the ceiling.

**A `.brand/` folder** ships the mail template and a report template beside the
logo. Nothing under `assets/` moved: mail already sitting in other people's
inboxes fetches its background from those URLs.

**A hosted workspace gets its own role file** instead of the client one. An
existing hosted workspace will start failing doctor's `exists: JOSERAH-ROLE.md`
check until its role file is replaced — that is the check working, and
`docs/migrations/0.13.0.md` says what to do. The capture hook no longer treats
a background agent's finish notification, or the harness's own reminders and
command echoes, as something you said.

## 0.12.0

Every workspace now has a vault. A secret the assistant sees — pasted in chat,
found in a file, an import, a config, a tool's output — is saved at once,
without asking, into `keys/secrets.json` through `.joserah/tools/secret.js
--set <scope>.<system>.<field>`, and the owner is told in one line under which
name. From then on it is used only embedded in a command,
`$(node .joserah/tools/secret.js <name>)`, never printed; notes, answers and
commits carry the name. The prompt's rule 3 says so (prompt version 6), and
`keys/AGENTS.md` describes the tool.

Two hooks hold the line. A new PreToolUse hook refuses a bare `secret.js
<name>` call and any command naming `keys/secrets.json` without going
through the tool — a guardrail, not a wall. The prompt hook adds a one-line
reminder when a message looks like it carries a password or token.

An existing workspace picks this up through `/joserah:update`: doctor's new
`local secret.js current` check fails until the plugin's `tools/secret.js`
is copied to `.joserah/tools/secret.js`; the store is created by the first
`--set`. `keys/AGENTS.md` is not replaced on an existing workspace — copy it
from the plugin's template if you want the new text.

## 0.11.3

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

## 0.11.2

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

## 0.11.1

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

## 0.11.0

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

## 0.10.0

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

## 0.9.0

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

## 0.8.0

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

## 0.7.0

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

## 0.6.0

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

## 0.5.0

Source material now lands in `imports/` instead of `raw/`; doctor flags a
root `raw/` and `tools/relocate-imports.js` moves it and rewrites the links.
`raw/` stays recognised, so older workspaces keep working. Notes now carry
typed claim lines — `measurement`, `calculation`, `decision`, `estimate` —
audited by `tools/check-claims.js` in doctor. The prompt moves to version 2.

## 0.4.1

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

## 0.3.0

`keys/` moves from `.joserah/keys/` to the workspace root — the owner
populates it by hand, so it now lives where hands can find it. Existing
workspaces keep working, but `/joserah:doctor` will flag the old location
and walk you through the move (its "Migrate a pre-0.3.0 workspace" section).
Backups exclude both locations by default (except `keys/AGENTS.md`, which
carries no credential and is always kept in so a restored workspace still
passes doctor) and now **ask** whether keys should be included.
`archive.js extract` refuses to overwrite existing files without `--force`,
and a new `verify` command checks an archive's integrity.

## 0.2.0

0.2.0 moves everything Joserah owns under one hidden folder: `desk/`,
`knowledge/`, `personal/` and `keys/` all move under `.joserah/`. An existing
workspace is migrated by moving those four folders under a new `.joserah/`
directory and repointing the relative links in `AGENTS.md` and anywhere else
that referenced the old paths. Run `/joserah:doctor` afterwards to confirm
the move is complete. **If you're catching up from 0.1.x straight to the
current release, `keys/` does not stay under `.joserah/` for long — the 0.3.0 note moves it back out to the workspace root in 0.3.0. Do both moves
in the same sitting rather than the first one alone.**
