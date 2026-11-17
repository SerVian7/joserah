---
name: onepw-add-key
description: Use when an SSH key for one of the team's machines is to be created, rotated or removed, when a new machine needs SSH access, or when a key has to be put on or taken off a machine. Keys live only in the team's shared 1Password vault. The computer must already be set up (onepw-install).
---

# 1Password SSH: a key for a machine

Every target machine has exactly one key, kept in the team vault, and that key is the only line in the machine's `authorized_keys`.

**Team vault:** the shared 1Password vault that holds the team's keys and secrets. Its name is set once by onepw-install, which writes it into `agent.toml` (Windows `%LOCALAPPDATA%\1Password\config\ssh\agent.toml`, macOS/Linux `~/.config/1Password/ssh/agent.toml`). Read it from there: it is the `vault = "..."` entry that is not Employee, Personal or Private. If there is more than one, ask which one is meant. Below it is written `<Team vault>`.

**Vault scope:** work only in the team vault and the person's own **Employee** vault. Do not read,
search, match against or write to any other vault the account can see, unless the person names it for this task.

Source: https://www.1password.dev/ssh. Read the relevant page there before trying anything that is not written here.

## Rules
- **Real name:** `<Company> · <Machine> · SSH` (for example `Acme · Web-1 · SSH`). Never a made-up name.
- **Only for a machine you can reach now.** Never put a key in the vault for a machine you cannot reach.
- **No duplicates:** list the vault first (`op item list --vault "<Team vault>" --categories "SSH Key"`).
- **Every key carries its target, entered at creation, always.** This is a URL custom field `ssh` = `ssh://<user>@<ip or host>`
  (the address you actually connect to, for example the VPN/Tailscale IP), plus the tag `ssh`. The create command below includes it.
  Never create an SSH key item without it. If you do not know the user and address yet, find them first or ask, and only then create.
  Without it the machine never reaches the generated SSH config, and the CLI cannot add it afterwards.

## Create
This is a tested, working command. Run it with stdin closed (`</dev/null`), or op swallows the caller's stdin:
```
op item create --category "SSH Key" --ssh-generate-key ed25519 --vault "<Team vault>" --title "<Company> · <Machine> · SSH" --tags ssh "ssh[url]=ssh://<user>@<ip>" --format json
```
The public key is in the result's `public_key` field.

## When an existing key item needs a change
For example, a missing or wrong bookmark URL, or a title. Do not try the CLI: `op item edit` refuses SSH Key items
("SSH Key item editing in the CLI is not yet supported"). Tell the person that reason in one sentence, then offer the two ways:
- **They change it by hand in the app**: Edit the item; for a bookmark, add a custom field and paste the `ssh://` URL; Save.
  Nothing on the machine changes and there is no approval. (A missing bookmark can also be added after a login, from
  Developer → View SSH Agent → Activity → **Bookmark**.)
- **You make a new key with the right details.** Create it as in "Create" above, then put it on the machine in the order below.
  This means a key change on the machine and a few approvals.

Let them choose; do not pick for them.
Check with no prompt: the host's `Match Host` block appears in `~/.ssh/1Password/config` within seconds.

## Put it on the machine, in this order, one machine at a time
1. Back up the key file.
   - Linux/macOS: `~/.ssh/authorized_keys`.
   - Windows admin users: `C:\ProgramData\ssh\administrators_authorized_keys`. Keep its ACL; append, do not recreate.
2. Append the new public key, logging in with the key that works today.
3. Log in with the new key through 1Password.
4. Show the owner the exact old lines to remove (comment and fingerprint), and wait for a yes. Then remove them.
5. Only then delete the old 1Password item. Never delete an item while it is still the only way into a machine.

Report per machine: appended / already there / could not reach (why).

## Approvals
- Before anything pops a 1Password approval, say so: on which computer, and how many times.
- A request from a background program shows only a tray dot ("SSH request waiting").
- One command per batch, and only one assistant asks at a time. Never retry a timed-out prompt in a loop.
- When another assistant reports a machine done and verified, do not redo its checks.
