---
name: onepw-secrets
description: Use when one of the team's passwords, tokens or API keys has to be read for a command, or saved because someone gave it or it was found in a file, chat or tool output. Secrets live in the team's shared 1Password vault and are never printed. The computer must already be set up (onepw-install).
---

# 1Password: reading and saving secrets

**Team vault:** the shared 1Password vault that holds the team's keys and secrets. Its name is set once by onepw-install, which writes it into `agent.toml` (Windows `%LOCALAPPDATA%\1Password\config\ssh\agent.toml`, macOS/Linux `~/.config/1Password/ssh/agent.toml`). Read it from there: it is the `vault = "..."` entry that is not Employee, Personal or Private. If there is more than one, ask which one is meant. Below it is written `<Team vault>`.

**Vault scope:** work only in the team vault and the person's own **Employee** vault. Do not read,
search, match against or write to any other vault the account can see, unless the person names it for this task.

**The assistant never sees a secret's value.** It works only with the secret's *reference*
(`op://<Team vault>/<item>/<field>`), and 1Password puts the value into the program that needs it.

- **Read: through `op run`.** Point an environment variable at the reference and let `op run` start the program:
  ```
  # bash
  DB_PASSWORD="op://<Team vault>/<item>/password" op run -- <command that uses $DB_PASSWORD>
  # PowerShell
  $env:DB_PASSWORD = "op://<Team vault>/<item>/password"; op run -- <command>
  ```
  The value goes only to that program. The assistant's command line holds only the reference. `op run` hides the value in the
  output: its help says "Secrets printed to stdout or stderr are concealed by default". The same help says masking is
  "best effort": a value can still leak, for example when a program prints it transformed. So:
  - never use `--no-masking`, `op read` to the screen, `echo`, verbose or debug flags, or anything else that prints the value;
  - never put a secret in a URL or a command argument that ends up in an error message or log.
- **A person giving a secret** types it into the 1Password app themselves. They never paste it into the chat, because anything
  pasted there the assistant has seen. If one is pasted anyway, say so plainly and suggest changing it.
- **Save, only for a secret the assistant has already come across** in a file or tool output. That one it has seen; the aim is to move it
  out of plain text:
  1. Get a template: `op item template get --out-file t.json Login`.
  2. Fill it in.
  3. Run `op item create --vault "<Team vault>" --template=t.json`.
  4. Delete `t.json` straight away.

  Never put a secret on the command line as `password=...`; the CLI's own help warns against it.
- **One item per server or device, filed by what it opens, not by who uses it.** The item holds everything needed to reach it:
  host or IP, port, domain, WebSocket URL/port where there is one, username, password. Programs that share a login all point at
  that one item (`op://<Team vault>/<item>/<field>`). They never get their own copy. Example: a message broker with one user
  is ONE item, not one per client program.
- **Before saving, check the vault for an item that already opens the same server.** If one exists, use it, or tell the person
  what is missing from it. Do not create a second one.
- **Moving many secrets at once:** first group the entries by the server they open. Compare values in memory, without printing,
  to see which are really the same. Fill addresses from the records, and mark any address not found. Show the person the
  grouped list, and create only after their yes.
- **Names:** `<Company> · <Server or device> · <Kind>`, the same pattern as the SSH keys. The title alone must say what it opens.
- Notes, chat and commits carry the item name, never the value.
- **Approvals:** say so before 1Password asks, batch all the reads into one command, and only one assistant asks at a time.
