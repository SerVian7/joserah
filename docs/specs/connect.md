# Joserah Connect: build contract

Assistants on different machines message each other and send files, peer to peer. No central server.
Node, no dependencies, CommonJS, `'use strict'`. Everything under `tools/connect/`.

## Requirements (owner's words, not negotiable)

- One small MCP server per machine, shipped in the plugin.
- Pairing: the joining side gives the other machine's IP, the pair password that machine's owner handed out,
  and the username to join as. The other side records a **pending** request; **its owner approves or refuses**.
  Only on approval do both sides store a long-lived token. A wrong pair password is refused without asking.
- Messages, inbox, reply. A hook shows unread counts each turn.
- Files: small files (up to 10 MB) arrive directly; large files ask the receiver first, and start only on the
  owner's yes; refusal or no answer within 10 minutes cancels. Streamed, sha256 checked at the end; a failed
  file is deleted and the sender is told. Nothing received is ever opened or run.
- "Gelen mesaj yeni session başlatmayacak gerektiğinde okunacak mesajlar." Receiving a message or file never
  starts, wakes or resumes a session, and the listener never spawns `claude` or any other process
  (no `child_process` in `listener.js`, `api.js`, `files.js`, `store.js`). Messages wait and are read on demand
  through `inbox()`. The hook prints at most the one-line count, never message text or file names.

## Safety (not negotiable)

- **Listen address** is a setting (`bind` in config). Allowed: one specific address that is loopback
  (127.0.0.0/8, ::1), Tailscale CGNAT (100.64.0.0/10), or private LAN (10/8, 172.16/12, 192.168/16, fd00::/8).
  Refused: `0.0.0.0`, `::`, empty, any public address, hostnames. `checkBind(addr)` in `config.js` decides;
  the listener refuses to start on a refused address. Setup defaults to the Tailscale address
  (`tailscale ip -4`) when one exists, else the owner names one LAN address.
- Every request needs `Authorization: Bearer <token>` of a known peer, except `POST /pair`, which needs the pair
  password and creates only a pending entry. Unknown/missing token: 401, nothing stored.
- Failed pairing attempts are rate limited per source IP: after 5 failures within 10 minutes, `POST /pair`
  from that IP answers 429 (even with the right password) until the window passes. In memory is fine.
- Tokens: 32 random bytes, hex. Stored only in `<workspace>/keys/connect.json` (file mode 0600 where the OS
  allows). Never in `.joserah/`, never in a message log, never printed, never in an error text or test output.
- Pair password: stored only as a salted `crypto.scryptSync` hash in `keys/connect.json`; compared with
  `crypto.timingSafeEqual`. Never logged.
- Pending pair requests and large-file offers expire after 10 minutes.
- Message text capped at 64 KB (UTF-8 bytes): 413 if larger.
- Received file names: `sanitizeName(name)` = basename only (split on `/` and `\`), control chars and
  `<>:"|?*` removed, leading dots removed, max 200 chars; empty -> `file`. Written only inside
  `.joserah/connect/files/<peer>/`, opened with flag `wx`; if the name exists, `name (1).ext`, `(2)`...
  Never overwrite. Resolved path must stay inside the folder (assert).
- Peer names: lowercase `[a-z0-9._-]`, 1-40 chars, else refused.

## Storage

Workspace root = `findWorkspace(process.env.CLAUDE_PROJECT_DIR || process.cwd())` from
`hooks/lib/workspace.js`. Every module function takes `root` as its first argument (tests pass temp dirs).

```
<root>/.joserah/connect/
  config.json         { name, bind, port }            name = this machine's username toward peers; port default 4790
  peers.json          { "<peer>": { address, port, since } }      no tokens here
  pending.json        [ { id, username, address, port, created } ]   incoming pair requests (ours to approve)
  outgoing.json       [ { id, peer_address, peer_port, username, created } ]   our own connect() calls waiting
  messages/<peer>.jsonl   one JSON per line: { id, dir:"in"|"out", text, reply_to?, at, kind?:"message"|"notice" }
  read.json           { "<peer>": <count of "in" lines already shown by inbox()> }
  offers.json         [ { id, peer, name, size, sha256, created } ]   incoming large-file offers (ours to accept)
  sending.json        [ { id, peer, path, name, size, sha256, created } ]   our outgoing large-file offers
  files/<peer>/       received files
<root>/keys/connect.json  { password: { salt, hash }, tokens: { "<peer>": "<hex>" }, outgoing: { "<id>": "<hex>" } }
```

All writes: write to `file.tmp` then rename. ids: `crypto.randomBytes(8).toString('hex')`. Times: ISO strings.
Expired entries are pruned whenever the file is read.

## Pairing protocol (one token per pair, used both ways)

1. A calls `connect(ip, pair_password, username)`. A makes token T, stores it under `keys.outgoing[id]` and an
   `outgoing.json` entry, then `POST http://ip:4790/pair` `{ id, username, pair_password, token: T, port: A.port }`.
2. B checks rate limit (429), password (403, no entry, counts as a failure), username valid (400), not already a
   peer under that name (409). Then stores pending `{ id, username, address: <req.socket.remoteAddress>, port }`
   and keeps T in `keys.outgoing[id]` on B's side too (B's keys file). 202 `{ pending: id }`.
3. B's owner: `approve(id)` -> B stores peer `username` with address/port, `keys.tokens[username] = T`, removes
   the pending entry, then `POST http://address:port/pair/accept` with `Authorization: Bearer T` and
   `{ id, name: B.config.name }`. A finds `outgoing` with id and matching token -> stores peer `<B name>` at the
   address it originally dialled, `keys.tokens[<B name>] = T`, drops the outgoing entry. 200.
   `refuse(id)` -> B drops the pending entry and posts `/pair/refuse` the same way; A drops its outgoing entry and
   writes a notice line. If A is unreachable on approve, B keeps the peer and reports it.
4. `disconnect(peer)` -> drop locally (peer, token), then best effort `POST /disconnect` with the token; the
   other side drops too.

## Message routes (all with Bearer token; the token identifies the peer)

- `POST /message` `{ id, text, reply_to? }` -> append `dir:"in"` line to `messages/<peer>.jsonl`. 200.
- Sender appends its own `dir:"out"` line after a 200.

## File routes

- Small (`size <= 10 MB`, setting `smallFileMax` in config, default 10485760):
  `POST /file` with headers `x-connect-id`, `x-connect-name` (URI-encoded), `x-connect-size`,
  `x-connect-sha256`; body = file bytes streamed. Receiver streams to `files/<peer>/.<id>.part`, hashes while
  writing, refuses when bytes exceed size; on match renames to the sanitized free name (flag `wx` semantics),
  writes a notice line ("file received: <name>, <size>") and answers 200 `{ saved: <name> }`; on mismatch
  deletes the part file and answers 422. Sender reports 422 as a failure.
- Large: `POST /file/offer` `{ id, name, size, sha256 }` -> receiver stores in `offers.json`, writes a notice
  line, 202. Sender stores in `sending.json`.
  - `accept_file(id)` on the receiver: `GET http://peer/file/<id>` (Bearer) -> sender serves the bytes only if
    `sending.json` has that id for that peer and it has not expired; receiver streams, hashes, saves as above.
    Then receiver posts `POST /file/result { id, ok }` to the sender; sender drops the entry and writes a notice
    line ("<name> delivered" / "<name> failed the check and was deleted").
  - `refuse_file(id)`: receiver drops the offer and posts `/file/result { id, ok:false, refused:true }`.
  - Expiry: offers/sending older than 10 minutes are pruned on read.

## Module layout (one owner per file)

| file | owner | exports |
|---|---|---|
| `tools/connect/config.js` | core | `loadConfig(root)`, `saveConfig(root,cfg)`, `checkBind(addr) -> {ok, reason}`, `setPassword(root,pw)`, `checkPassword(root,pw)` |
| `tools/connect/store.js` | core | json/jsonl read-write helpers, peers, pending, outgoing, messages, read marks, tokens, `peerByToken(root,token)`, `sanitizeName`, `validPeerName` |
| `tools/connect/http.js` | core | `request({address,port,method,path,token,json,body,headers}) -> {status, json, stream}` client |
| `tools/connect/listener.js` | core | `startListener(root, {bind,port}) -> Promise<server>`; routes table; `registerRoutes(fn)` hook used by files.js |
| `tools/connect/api.js` | core | `connect, pending, approve, refuse, peers, send, inbox, reply, disconnect, unreadSummary(root)` |
| `tools/connect/files.js` | files | `fileRoutes(...)` registered into the listener; `sendFile, files, acceptFile, refuseFile` |
| `tools/connect/mcp.js` | surface | stdio JSON-RPC MCP server; tools call api.js / files.js; starts the listener when config has a valid bind |
| `tools/connect.js` | surface | CLI: `setup --bind <addr> [--port] --name <name>` (password from stdin, never echoed), `status`, `password` (change) |
| `hooks/connect-unread.js` | surface | UserPromptSubmit: prints `[connect] 2 unread from yusuf; 1 file offer from yusuf` or nothing |
| `skills/joserah-connect/SKILL.md` | surface | the short skill |

Every api/files function returns a plain object (`{ ok:true, ... }` or `{ ok:false, error:"<plain words>" }`),
never throws to the MCP layer, never puts a token or password into the result.

## Tests

`tests/connect-*.test.js`, `node:test`, two instances = two temp workspace roots each with its own listener on
`127.0.0.1` and port 0 (ephemeral; `startListener` resolves with the real port and config is written to it).
A test never prints a token or password; assertions on secrets compare, never show. Close every server in
`t.after`.
