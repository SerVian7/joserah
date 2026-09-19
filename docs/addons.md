# Addons

An addon is an ordinary plugin. The market is an ordinary marketplace. There is
no Joserah installer, no registry format and no plugin system of our own — the
runtime already has all three, and a second one would only be a second thing to
keep working.

## What an addon is

A directory with `.claude-plugin/plugin.json` and any of `skills/`, `agents/`,
`hooks/`, `commands/`, `.mcp.json`. Installed, enabled and updated by the host,
exactly like this plugin.

## `joserah.json` — what it declares to us

One small file at the addon's root. Four keys and no more:

```json
{
  "tier": "open",
  "minJoserah": "0.14.0",
  "needs": {
    "secrets": ["example.service.api-token"],
    "commands": ["gh"]
  },
  "setup": "setup/SETUP.md"
}
```

- **`tier`** — the addon's own word for what it is.
- **`minJoserah`** — the plugin version it needs.
- **`needs.secrets`** — vault **names**, never values. Doctor reports any that
  are missing.
- **`needs.commands`** — binaries that must be on `PATH`.
- **`setup`** — a path inside the addon to its own setup instructions.

Nothing else belongs here. What account a user needs, what the addon does and
how to get a credential are prose, and prose belongs in the setup file.

## Where a credential lives

Two stores, one rule:

| Consumed by | Store |
|---|---|
| An MCP server or hook **the addon itself declares** | the runtime's own `userConfig` with `"sensitive": true` — the value goes to the operating system's keychain and the assistant cannot read it at all |
| A command **the assistant runs** | the workspace vault: `node .joserah/tools/secret.js --set <name>`, used only ever embedded as `$(node .joserah/tools/secret.js <name>)` |

Prefer the first wherever the addon's own server can do the work. Its honest
cost, which the addon's setup file must state rather than let someone discover:
a keychain value is not in the vault, not in a backup, and not visible to
doctor, so a new machine asks for it again.

## What an addon may write

> An addon writes plain markdown under the workspace's own `.joserah/`, and
> secrets only into the workspace vault by name. No private store, no binary
> format, no file this plugin cannot read.

Removing an addon must never orphan data. Its skills disappear from the next
session; its writes stay readable.

An addon may call the workspace's own tools under `.joserah/tools/`. It may not
call this plugin's `tools/` — the plugin's own root cannot be resolved from
another plugin, and guessing at a version-numbered cache path is how an addon
breaks on the next update. Anything that genuinely needs this plugin's tools
belongs in this plugin.

## A catalogue entry

A marketplace file lists addons. Each entry carries `name`, `description`,
`author`, `category`, `version`, `source`, `homepage`, `license`. `category` is
the trust tier:

| `category` | `source` rule |
|---|---|
| `official` | a path inside the market repository |
| `pro` | a git source with a release tag |
| `custom` | a git source pinned with **both** `ref` and `sha` — mandatory |

Set an explicit `version` on official and pro entries as well as a release tag,
so an update moves when someone decides it should and not because a branch
moved. Pin `sha` on every custom entry, without exception: it is what stops a
third party's code changing under our listing.
