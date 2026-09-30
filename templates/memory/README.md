# {{COMPANY}} Memory

{{COMPANY}}'s shared memory: what the company knows about its own work — systems, sites, devices,
decisions, procedures — kept as plain markdown in one git repository. Each file is a record of one
subject, not a conversation. Members: {{MEMBERS}}. Sweeper: {{SWEEPER}}.

This memory was created with Joserah, but Joserah is not required: anyone with git and Node can work
here — the rules are in `AGENTS.md`, the tools in `tools/` (Node built-ins only, nothing to install).

## If you are an AI assistant opening this repository

Read `AGENTS.md` in full before you write anything. Then, in this order:

1. `node tools/sync.js` — pulls, checks links and claim lines, lists questions waiting for the member.
2. `node tools/detect-member.js` — prints which member you work for (from `.memory/me`). If it prints
   nothing, ask once and write their first name, lowercase, into `.memory/me`.
3. Read the member's folder, `members/<member>/`, and the company's open items, `desk/tasks/now.md`.

## Layout

| Path | Holds | Written by |
|---|---|---|
| `knowledge/` | the company's record, one file per subject (`wiki/entities/`, `wiki/topics/`, `people/`) | the sweeper, by sweep |
| `knowledge/sources/` | source material archived verbatim (documentation, exports); never edited, not link- or claim-checked | the sweeper, by sweep |
| `members/<name>/` | one member's `daily/`, `notes/` and `tasks.md` | that member only |
| `inbox/` | notes proposed for `knowledge/`, one file each | any member |
| `questions/` | questions between members, one file each | asker creates, addressee answers |
| `desk/` | `tasks/now.md` (open items), `tools-proposed.md` (tool proposals) | the sweeper |
| `tools/` | sync, checks, vault, sweep; verified scripts under `tools/<system>/` | a sweep; Joserah refreshes the standard ones |
| `.brand/` | logo, colours, report template for anything about {{COMPANY}} | |
| `.memory/` | `config.json`, `vault-index.md` (secret names only); `me` (this machine, gitignored) | the tools |
| `keys/` | this machine's vault — gitignored, never committed, never opened by an assistant | `tools/secret.js` |

## Where the clone lives

- **With Joserah:** the plugin clones it into the workspace, at `.joserah/shared/<name>/`.
- **Without Joserah:** clone it to `~/<name>`. One clone per machine; every workspace on that machine
  points at that clone instead of keeping its own.

To join: `git clone <url> ~/<name>`, open the folder with your AI assistant and say "read AGENTS.md
and sync". With Joserah, say "this repo is our shared memory: <url>" instead.

## How work moves

- **Members write only their own folder, `inbox/` and `questions/`.** No two members edit the same
  file, so commits never collide.
- **Numbers are claim lines**, not sentences:
  `- [measurement|calculation|decision|estimate] <subject> -> <value>`, with `condition:`, `date:`,
  `by:` and `source:` under it. An unsourced number carries no weight.
- **Every push asks.** `node tools/sync.js --push` prints a push notice that names its target
  — `shared memory <name> (<origin url>)` — and every file about to leave the machine. The assistant
  shows it to the member, waits for their yes, then pushes with `--yes`.
- **Questions go through files.** A question for a colleague is a file in `questions/` addressed to
  them; their next sync lists it.
- **Only the sweeper writes `knowledge/`.** A regular sweep merges `inbox/` into the record of what
  each note is about, and `tools/sweep.js` checks that every claim line arrived verbatim.

## Secrets

No password, token or key is ever written here, not even masked. The memory carries its own vault
(names only ever leave the machine) and its own sweep check, so no plugin is needed for either:
`node tools/secret.js --set <company>.<system>.<field>` asks for the value in your own terminal and
stores it in `keys/`, which git ignores. Scripts under `tools/<system>/` are verified procedures;
they never contain a secret, they ask for it or take it from your vault.

## What does not belong here

Anything personal: private life, opinions about people, gossip — anything a member would not say in
a meeting. And no secret, ever.
