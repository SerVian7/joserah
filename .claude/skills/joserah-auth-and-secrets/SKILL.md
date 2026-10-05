---
name: joserah-auth-and-secrets
description: Use when touching login, sessions, the setup token, exposure settings, or anything the Joserah server keeps secret, or when a job could reach a server secret.
---

# Login and server secrets

- The login is the master key: signed in means "may run Claude Code on this machine".
- Password: `scrypt` (`node:crypto`, N=16384, r=8, p=1, 64-byte key, 16-byte salt), compared with `timingSafeEqual`.
- Server secrets (`auth.json`: hash, cookie key, generation; `setup-token`) live in the **state directory outside the workspace**: `JOSERAH_STATE_DIR`, else `~/.joserah-server/<sha1(workspace)[0..12]>/`; Docker gives it its own volume. Never under the workspace, never under `keys/`.
- A present but unreadable, empty or malformed `auth.json` stops the server from starting (exit 1, plain message). Only a **missing** file means setup.
- Cookie `jsid`: `HttpOnly; SameSite=Strict; Path=/`, plus `Secure` when served over HTTPS or behind a declared proxy. Value `<generation>.<expiry>.<nonce>.<hmac>`; a password change bumps the generation and signs every device out.
- Every POST/PUT/PATCH/DELETE checks `Origin` against the server's own origin (and `publicOrigin` when set); a missing Origin is refused.
- Login: 5 attempts a minute per address, then a block of 60 s that doubles on every further block up to 1 h.
- Exposure: `local` binds 127.0.0.1; `tailnet` binds the given address; `internet` refuses to start without HTTPS (certificate files or `proxy: true`).
- Job environment is an allowlist (`jobEnv()` in `server/src/engines/claude-cli.ts`): a test must show a server variable and a secret-named variable never reach a job.
- Uploads are scanned with the `SPECIFIC` patterns of `hooks/lib/redactions.js` before any model reads them; a hit is quarantined, verbatim, with an owner row.
- Never print, log or commit a secret; `/healthz` says alive / signed in / last job ok and nothing else.
