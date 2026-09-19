# keys/ — the vault

SENSITIVE. Everything here except this file stays out of every repository backup.

`secrets.json` holds the workspace's secrets as `{"_readme": "...", "secrets": {"<name>": "<value>"}}`.
It is never opened, printed or copied directly — only through the tool:

| Command | Does |
|---|---|
| `node .joserah/tools/secret.js --list` | names only, never a value |
| `node .joserah/tools/secret.js --has <name>` | present / absent |
| `printf %s '<value>' | node .joserah/tools/secret.js --set <name> [--force]` | saves from stdin; refuses to overwrite without `--force`; keeps `secrets.json.bak` |
| `$(node .joserah/tools/secret.js <name>)` | the value — only ever embedded in the command that uses it |

- Every secret seen is saved here at once, without asking, and the owner is told in one line
  under which name.
- Names: lowercase, dot-separated — `<scope>.<system>[.<sub>].<field>`, field such as
  `host`, `url`, `user`, `password`, `token`, `api-token`, `pin`, `note`.
- Notes, answers and commits carry the name, never the value. A plaintext copy found elsewhere
  is replaced by its name (`imports/` excepted — source material stays verbatim).
- A hook refuses a bare `secret.js <name>` call and any command naming `keys/secrets.json`
  directly. It is a guardrail, not a wall.
