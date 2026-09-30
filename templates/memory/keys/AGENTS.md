# keys/

This folder is the memory's own vault, and it never leaves this machine (everything in it but this file is gitignored).
An assistant never opens it: not the files, not a listing of their contents. What exists is
named in `.memory/vault-index.md`. A secret is saved by the member, in their own terminal, with
`tools/secret.js --set` and a name. A script reads it only embedded in a command, as `$(...)`.
