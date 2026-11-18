# Joserah Connect: build contract (v2)

Assistants on different machines message each other and send files, peer to peer. No central server.
Node >= 18, no dependencies, CommonJS, `'use strict'`, built-in `crypto` only. Everything under `tools/connect/`.

## Requirements (owner's words, not negotiable)

- One small MCP server per machine, shipped in the plugin.
- "Pair şifresi gerekmiyor. Yusuf eşleşmek istiyor der." The joining side gives the other machine's address and
  the username to join as. The other side records a **pending** request; its assistant tells its owner
  "<username> wants to pair, code 482913"; **its owner approves or refuses**. Approval alone creates the pair.
- "Her nic desteklesin ... mesajlar ve dosyalar şifreli gitsin." The listener accepts on every interface by
  default; a peer is identified by its key, not its IP. Messages and files are encrypted end to end.
- Messages, inbox, reply. A hook shows unread counts each turn.
- Files: small files (up to 10 MB) arrive directly; large files ask the receiver first and start only on the
  owner's yes; refusal or no answer within 10 minutes cancels. Streamed, sha256 checked over the plaintext at
  the end; a failed file is deleted and the sender is told. Nothing received is ever opened or run.
- "Gelen mesaj yeni session başlatmayacak gerektiğinde okunacak mesajlar." Receiving a message or file never
  starts, wakes or resumes a session, and the listener never spawns `claude` or any other process
  (no `child_process` in `listener.js`, `api.js`, `files.js`, `store.js`, `crypto.js`, `http.js`). Messages wait
  and are read on demand through `inbox()`. The hook prints at most a one-line count, never text or file names.

## Listening

- Default: every interface (`::` with dual stack, falling back to `0.0.0.0` where IPv6 is unavailable), port 4790.
- Optional `bind: ["<addr>", ...]` in config restricts it to those addresses (one server each).
- If the port is in use (another session on this machine already listens), run tools-only.

## Crypto design

Identity: each machine has a long-term X25519 key pair, made on first use (`crypto.generateKeyPairSync('x25519')`),
public key exchanged as raw 32 bytes (base64url of the JWK `x`). Private key only in `<root>/keys/connect.json`.
`keyid(pub)` = first 16 hex chars of sha256(raw pub).

Pairing (cleartext HTTP, carries no secret; a commit-then-reveal so a man in the middle cannot grind codes):
1. A -> B `POST /pair` `{ id, username, commit }`, `nA` = 32 random bytes,
   `commit = sha256("jc1 commit" || pubA || nA)`. B checks rate limit and pending cap, stores a half-open
   entry, answers `{ name: B.name, pub: pubB, nonce: nB }` (nB 32 random bytes).
2. A -> B `POST /pair/reveal` `{ id, pub: pubA, nonce: nA, addresses: [A's non-internal interface addresses], port }`.
   B checks the commitment (mismatch -> 400, entry dropped), adds the request's source address to the list,
   stores a **pending** entry. 202.
3. Both compute `code = uint32be(sha256("jc1 sas" || pubA || pubB || nA || nB)[0..4]) % 1000000`, six digits.
   `connect()` returns A's code; `pending()` shows B's code with the username and `keyid(pubA)`. The owners may
   compare; the code is always shown. A tampered exchange yields different codes on the two sides.
4. Keys (both sides): `shared = crypto.diffieHellman(own private, other public)`;
   `salt = sha256(pubA || pubB || nA || nB)`;
   `k(X->Y) = hkdfSync('sha256', shared, salt, "jc1 " + keyid(X) + ">" + keyid(Y), 32)` — one key per direction.
5. `approve(id)` on B: store peer, then send a sealed `accept { name, addresses, port }` to A. A, holding its
   half (pubB, nA, nB from steps 1-2 in `outgoing`), derives the keys, opens the seal, stores peer B. A seal that
   does not open -> refused, nothing stored. `refuse(id)`: B drops the entry and sends a sealed `refuse`.

Sealed request (every authenticated call): `POST /m` with body `{ from: keyid(sender), iv, ct }` (base64url),
AES-256-GCM, 12-byte random iv, 16-byte tag appended to `ct`, AAD = `"jc1 m " + from`. Plaintext is JSON
`{ type, ts, ... }`. The receiver finds the peer by `from` (unknown -> 401), opens with `k(peer->me)`
(fails -> 401), then checks replay: `|now - ts| <= 10 min` and `iv` not in the per-peer seen-iv cache (kept
10 minutes in `.joserah/connect/seen.json`); either fails -> 401, nothing stored. Types: `message`, `accept`,
`refuse`, `disconnect`, `file-offer`, `file-result`, `file-pull`.
Nothing readable (message text, file names, contents) is outside the seal; only `from` and lengths are.

File stream (small-file push `POST /f`, and the response to a sealed `file-pull`): frames of
`uint32be(len) || iv(12) || ct+tag`, plaintext chunks of 64 KB. Frame 0 is the sealed JSON header
`{ id, name, size, sha256, ts }`, sealed like a request (replay rules apply to frame 0). Chunk i's AAD =
`"jc1 f " + id + " " + i + " " + (last ? "1" : "0")`, so reorder, cut or splice fails. Request `/f` carries
`x-connect-from` for the key lookup. sha256 is checked over the decrypted plaintext.

Why not a counter: several sessions on one machine may send at once; random 96-bit GCM nonces plus a time
window and a seen-iv cache avoid nonce reuse without a shared counter.

## Safety

- Pairing requests: per source IP at most 5 in 10 minutes (429), and at most 10 pending + half-open entries in
  total (429). Pending and half-open entries expire after 10 minutes.
- Message text capped at 64 KB (413). Peer names lowercase `[a-z0-9._-]`, 1-40 chars.
- Received file names: `sanitizeName` = basename only, control chars and `<>:"|?*` removed, leading dots removed,
  max 200 chars, empty -> `file`. Written only inside `.joserah/connect/files/<peer>/`, flag `wx`, `name (1).ext`
  on a clash, never overwrite, resolved path asserted inside the folder.
- Private key and derived keys never in `.joserah/`, a log, a result object, an error text or test output.

## Storage

Workspace root = `findWorkspace(process.env.CLAUDE_PROJECT_DIR || process.cwd())` (`hooks/lib/workspace.js`).
Every function takes `root` first.

```
<root>/.joserah/connect/
  config.json       { name, port, bind? }
  peers.json        { "<peer>": { pub, keyid, addresses: [..], port, since } }     public keys only
  pending.json      [ { id, username, pub, keyid, code, nA, nB, addresses, port, created, open:bool } ]
  outgoing.json     [ { id, username, target, port, pubB?, nA, nB?, name?, created } ]
  seen.json         { "<keyid>": { "<iv>": <ms> } }
  messages/<peer>.jsonl   { id, dir:"in"|"out", text, reply_to?, at, kind:"message"|"notice" }
  read.json         { "<peer>": <count of "in" lines shown> }
  offers.json       [ { id, peer, name, size, sha256, created } ]       incoming large-file offers
  sending.json      [ { id, peer, path, name, size, sha256, created } ]  our outgoing offers
  files/<peer>/
<root>/keys/connect.json   { identity: { private (pkcs8 base64), public } }   mode 0600 where possible
```
Nonces in pending/outgoing are public values. Writes: tmp + rename. ids: 8 random bytes hex.

## Sending to a peer

Try each of the peer's addresses in order (last address that worked first), short connect timeout (3 s);
on a connection error move to the next; record the address that worked. Every authenticated request received
adds its source address to that peer's list.

## Module layout

| file | owner | exports |
|---|---|---|
| `tools/connect/crypto.js` | core | `identity(root)`, `keyid(pub)`, `commit`, `sasCode`, `deriveKeys`, `seal(key, obj, aad)`, `open(key, env, aad)`, `frameWriter`, `frameReader` |
| `tools/connect/config.js` | core | `loadConfig`, `saveConfig`, `checkBind(addr)` (rejects hostnames and invalid IPs) |
| `tools/connect/store.js` | core | json helpers, peers, pending, outgoing, messages, read marks, seen cache, `peerByKeyid`, `sanitizeName`, `validPeerName`, `appendMessage` |
| `tools/connect/http.js` | core | `request(...)`, `sendToPeer(root, peer, ...)` with address fallback |
| `tools/connect/listener.js` | core | `startListener(root, {port, bind}) -> Promise<servers>`, `registerRoutes(fn)` |
| `tools/connect/api.js` | core | `connect(root, address, username)`, `pending, approve, refuse, peers, send, inbox, reply, disconnect, unreadSummary` |
| `tools/connect/files.js` | files | `sendFile, files, acceptFile, refuseFile` + its routes |
| `tools/connect/mcp.js`, `tools/connect.js`, `hooks/connect-unread.js`, `skills/joserah-connect/` | surface | |

Results are plain objects `{ ok:true, ... }` / `{ ok:false, error }`; nothing throws to the MCP layer.

## Tests

`tests/connect-*.test.js`, `node:test`, two temp roots, listeners on `127.0.0.1` port 0 (tests set `bind`).
Address fallback: give a peer a dead first address (e.g. `127.0.0.2` on a closed port, or a closed port on
127.0.0.1) before the live one.
