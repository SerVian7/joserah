---
name: onepw-install
description: Use when a computer is being set up so its user can SSH into the team's machines through 1Password, or when SSH from a computer fails because it was never set up (no key offered, "Too many authentication failures", agent not answering). One-time setup per computer; for creating or installing a machine's key use onepw-add-key, for passwords and tokens onepw-secrets.
---

# 1Password SSH: one-time setup on a computer

Everyone connects with the SSH keys kept in the team's shared 1Password vault. Local key files and password logins are not used.
Source: https://www.1password.dev/ssh. Read the relevant page there before trying anything that is not written here.

## How to run it
First give the person a short overview of the whole setup: what they will tick, what you will install and change,
and that 1Password will ask them for approvals. Then go step by step, saying what each step does as you do it.

## Before you start
- The person has the 1Password desktop app installed and signed in to their team account.
- **Ask which shared vault holds the team's SSH keys**. Their own 1Password account must have access to it;
  the account admin grants it. Without access, stop and say so.

## What the person does: tell them briefly, in their language
In 1Password → **Settings → Developer**. On Windows, turn on Windows Hello in 1Password first and keep 1Password in the notification area.

| Setting | Value |
|---|---|
| Use the SSH Agent | on |
| Advanced → Ask approval for each new | the person chooses; see "Approval choice" below (team default: **request**) |
| Advanced → Remember key approval | only offered with "application" or "application and terminal session"; see below |
| Advanced → Display key names when authorizing connections | on |
| Advanced → Generate SSH config file with bookmarked hosts | on |
| Advanced → Open SSH URLs with | Windows Terminal (on Windows) |
| Developer Integrations → Integrate with 1Password CLI | on |

Then lock and unlock 1Password once.

### Approval choice: explain it, then let the person pick
Where: 1Password → **Settings → Developer → SSH Agent → Advanced**. Explain these options in plain words, with what each costs,
and let them choose; do not choose for them. Wording from https://www.1password.dev/ssh/agent/authorization:

**"Ask approval for each new":**
- **application** (1Password's own default): approve once per program and key. Few prompts.
- **application and terminal session:** additionally, every new terminal tab asks again. An assistant running many commands
  then triggers a prompt almost every time.
- **request** (team default): every single SSH use asks, and nothing is remembered. The person sees every connection.
  It costs one approval per connection. Fine for someone who seldom opens many connections at once.

**"Remember key approval"** (not offered with "request"):
- until 1Password locks (1Password's default);
- until 1Password quits;
- for a set time (4, 12 or 24 hours), which keeps approvals even while 1Password is locked.

These settings cover SSH key use only. Reading passwords with the CLI is authorized separately, through "Integrate with 1Password CLI".

## What you do
1. **CLI:** Windows `winget install --id AgileBits.1Password.CLI -e`; macOS `brew install 1password-cli`.
2. **Agent vaults: ask which vaults' SSH keys the agent should load.** Suggest the team vault plus their own **Employee**;
   they may add or drop vaults. Write exactly the vaults they choose, without breaking existing settings.
   This file is also where onepw-add-key and onepw-secrets read the team vault's name from.
   File: Windows `%LOCALAPPDATA%\1Password\config\ssh\agent.toml`, macOS/Linux `~/.config/1Password/ssh/agent.toml`.
   - With no file, the agent loads every key in Personal, Private or Employee.
   - A file, even an empty one, replaces that default, so it must list both vaults.
   - If the file exists, read it first and append only the missing block.
   ```
   [[ssh-keys]]
   vault = "Employee"

   [[ssh-keys]]
   vault = "<team vault>"
   ```
3. **Windows:**
   - In `services.msc`, "OpenSSH Authentication Agent" must be **Disabled** and stopped, so 1Password serves `\\.\pipe\openssh-ssh-agent`.
   - Use `C:\Windows\System32\OpenSSH\ssh.exe`. 1Password does not work with Git Bash's own ssh, PuTTY, Pageant, FileZilla or Termius.
   - For Git: `git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"`.
   - Write no `IdentityAgent` line.

   **macOS:** under `Host *`, add `IdentityAgent "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"`.
4. **`~/.ssh/config`:** read it first and change nothing else in it. 1Password writes `~/.ssh/1Password/config` from the bookmarked keys;
   include that file:
   - **No aliases:** put the line at the **top**, as 1Password's docs say. That works when you connect by IP.
   - **With aliases** (`Host <alias>` blocks that set `HostName`): put it at the **end**, under its own `Match all`, as below.
     At the top, `Match Host <ip>` runs before the alias sets the IP, so it never matches. And without `Match all`
     in front, the include belongs to the last `Host` block. Both were tested.
   - Alias blocks keep only `HostName` and `User`.
   ```
   Match all
   Include ~/.ssh/1Password/config
   ```
5. **Check without a prompt:** `ssh -G <alias>` shows `identitiesonly yes` and a `~/.ssh/1Password/SHA256_….pub` identity file.
   A real login is the person's call, because it asks for approval.

Why bookmarks matter: servers allow six attempts by default (`MaxAuthTries 6`). With more keys than that in the agent, login fails
with "Too many authentication failures". A bookmark makes ssh offer only the right key.

## Approvals
- Before anything pops a 1Password approval, say so: on which computer, and how many times.
- A request from a background program does not pop up. Only a dot appears on the tray icon, and the person must click **"SSH request waiting"**.
- Put everything into one command, and only one assistant asks at a time. Never retry a timed-out prompt in a loop.
- Check from the docs or the tool's help that a command can work before spending an approval.
