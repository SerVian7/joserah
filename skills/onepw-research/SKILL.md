---
name: onepw-research
description: Use when a repository, project folder or computer should be checked for passwords, tokens or keys lying in plain text, or when secrets kept in known places (.env files, config files, compose files, old local vaults, key folders) are to be moved into 1Password. Finds them without printing them, groups them by the server they open, and moves them only after the person's yes. The computer must already be set up (onepw-install).
---

# 1Password: find plain-text secrets and move them in

The aim is that no secret lives in plain text: not in code, config, notes, chat logs or git history. Each secret ends up as one
1Password item per server or device (the onepw-secrets filing rule). The program reads it through a reference
(`op://<vault>/<item>/<field>`) and never through a copy.

**Never print a secret's value**, a hash of it or its length. Not in chat, not in a report, not in a commit. Report a finding as
`file:line · kind · masked`, where masked is the first 2 and last 2 characters at most and only when that is needed to tell two apart.

**Vault scope:** the team vault for work, the person's own **Employee** vault for their own and their company's things. Ask when
unsure. Never read or write another vault unless the person names it.

## 1. Search: read only, change nothing
Agree the scope with the person first: which repo or folder. Then look in two places:
- **Known places:** `.env*`, `*.conf`, `*.ini`, `*.yaml`/`*.yml` (compose files), `*.json` config, `~/.ssh/config`, `.npmrc`, `.pypirc`,
  `.git-credentials`, `*.ovpn`, WireGuard `*.conf`, `*.pem`/`*.key`/`*.ppk`, and an old local vault if the person has one.
- **Everywhere else in the scope:** search for the shapes of secrets.
  - Assignments: `password=`, `passwd`, `secret`, `token`, `api_key`, `apikey`, `Authorization: Bearer`, `PRIVATE KEY-----`.
  - Credentials inside URLs: `://user:pass@`.
  - Known key formats: `sk-`, `ghp_`, `xox`, `AKIA`.
  - Long random strings in config values.
- **Git history:** a secret deleted from a file still lives in old commits. Search `git log -p` for the same patterns, and record the commit, not only the file.
- If installed, a dedicated scanner (for example gitleaks) can do the pattern work. 1Password's Watchtower can also scan `.env` files
  and `~/.ssh` (Settings → Developer → Watchtower). Do not install new tools without asking.

Weed out the false hits: placeholders (`<password>`, `changeme`, `xxx`), public keys, example files, test fixtures with fake values.
When unsure, list it as "check" rather than calling it a secret.

## 2. Report: show the person before anything changes
Write one short page in plain words:
- **Found:** `file:line · kind · masked · in git history? (commit) · pushed to a remote?`
- **Grouped by what it opens:** one row per server or device. Fields: host or IP, port, domain, WebSocket URL, user, password. Mark the vault
  (team or Employee), and say whether an item for that server **already exists** in that vault. Check by system, not by exact title.
  If one exists, compare the values in memory and print only "same" or "different".
- **Proposed fix per finding:** move to 1Password and replace with a reference; delete as stale; or leave it, with the reason.
- **Exposure:** a secret that was ever committed to a pushed repo, or shared, must be **changed (rotated)** at its system.
  Moving it is not enough. Say this plainly.

## 3. Move: after the person's yes
- Create the items in **one batch**: one command, so one approval. Say before it appears. Use templates or files that are deleted at once,
  and never put a value on the command line (onepw-secrets).
- Replace each plain-text value with its reference, using the form the program can use:
  - `op run --env-file <file> -- <command>`, where the env file holds `KEY=op://<vault>/<item>/<field>`;
  - `op inject -i <template> -o <file>`, where the config template holds `{{ op://<vault>/<item>/<field> }}`. Keep the produced
    file out of git;
  - or the program's own 1Password integration, if it has one.
- Run the program once to show it still works, before you call the move done.
- **Git history:** never rewrite it without the person's explicit yes. Rewriting changes every later commit and breaks other people's
  clones. Rotation is the usual right answer; rewriting is only an extra.
- Delete the old plain-text copies (files, local vault entries) only after the person's yes, with the exact list in front of them.

## 4. Approvals
- Say before 1Password asks: on which computer, and how many times.
- A background request shows only a tray dot ("SSH request waiting").
- One batch per step, and only one assistant asks at a time.
- Check from the docs or the tool's help that a command can work before spending an approval. Docs: https://www.1password.dev
