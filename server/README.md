# Joserah server

## What it is

The web door to a Joserah workspace. Your pages (the Daily Tracker, Trails, Cases, Markdown reports and the
knowledge wiki) are live in the browser; you answer rows on the page; and you give jobs that your own
signed-in Claude Code carries out. The terminal plugin keeps working on the same files: nothing here replaces it.

The server is a small Node program (TypeScript run directly by Node's type stripping, no build step) behind a
password. The existing tools under `tools/` stay the renderers and the writers of their own files.

## Native

You need Node 22.18 or newer, git, and Claude Code installed and signed in.

```
npm --prefix <plugin>/server ci
cd <your workspace>
node <plugin>/server/bin/joserah.mjs serve
```

`<plugin>` is the folder this repository is cloned to. Run it inside the workspace (any subfolder works: the
launcher walks up until it finds `.joserah/config.json`), or pass `--workspace <dir>`. `--port <n>` overrides
the port (default 4747). To get a `joserah` command, run `npm --prefix <plugin>/server link` once.

It prints `Joserah server: http://127.0.0.1:4747/` and, on the first start only, the one-time setup link
(`/setup?token=...`). Open it and choose a password; the wizard then checks the workspace, the backup and
Claude Code, and runs a test job. `joserah setup-link` prints the link again while no password is set; once one
is, it says `already set up`.

Stop it with Ctrl+C: running jobs end as interrupted and the queue is kept for the next start.

## Docker

```
docker compose -f server/compose.yaml up -d --build
docker logs joserah 2>&1 | grep setup        # the one-time setup link
docker exec -it -w /workspace joserah claude # then /login, once
```

Sign Claude Code in once with `/login` inside the container (open the printed address in any browser, sign in,
paste the code back, `/exit`); the wizard then shows it signed in. Instead of signing in you may pass
`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in the environment when starting the container.

GPU: add `-f server/compose.gpu.yaml` after `-f server/compose.yaml`.

Three named volumes hold everything: `joserah-workspace` (the workspace itself, at `/workspace`),
`joserah-claude` (Claude Code's sign-in and settings) and `joserah-state` (the password hash, cookie key and
setup token, outside the workspace). Make a full copy of the workspace volume with:

```
docker run --rm -v joserah-workspace:/w -v "$PWD":/out busybox tar czf /out/workspace.tgz -C /w .
```

## Access

`.joserah/server.json` `exposure` decides who can reach it:

- `local` (default): this computer only (127.0.0.1).
- `tailnet`: set `bind` to the machine's tailnet address; Tailscale encrypts the traffic.
- `internet`: refuses to start unless it has HTTPS: either `https` certificate files (`{"cert": "<file>", "key": "<file>"}`, relative to the workspace) or `"proxy": true` behind an HTTPS reverse proxy (then `publicOrigin` must name the address the browser opens).

In Docker, change the published address in `compose.yaml` instead of `bind`.

## Settings

Every key of `.joserah/server.json`, with its default. A missing file or key means the default.

```json
{
  "port": 4747,
  "exposure": "local",
  "bind": null,
  "https": null,
  "proxy": false,
  "publicOrigin": null,
  "maxConcurrentJobs": 1,
  "jobTimeoutMin": 30,
  "jobMaxTurns": 60,
  "jobBudgetUsd": 2,
  "dailyBudgetUsd": 10,
  "answerStartsJob": false,
  "answerBatchSec": 60,
  "nightlyLlmLint": false,
  "nightlyAt": "03:30",
  "rawLogDays": 30,
  "models": {
    "answers": "haiku", "digest": "haiku", "bookkeeping": "haiku",
    "task": "sonnet", "code": "sonnet", "research": "sonnet", "ingest": "sonnet", "query": "sonnet", "lint": "sonnet",
    "plan": "opus", "review": "opus"
  }
}
```

Automation is yours to switch on: `answerStartsJob` and `nightlyLlmLint` are off until you set them to `true`
(the free, rule-based lint always runs). A job type missing from `models` uses `opus`. Haiku is refused for
`ingest`, `query`, `lint`, `research`, `plan` and `review`, because those touch claims.

## Safety

- The password hash, the cookie key and the setup token live outside the workspace (`JOSERAH_STATE_DIR`, else `~/.joserah-server/<id>/`; in Docker, its own volume), never where a job can read them.
- Every job is preceded by a checkpoint commit and followed by a list of the files it changed. A deletion, or a write outside the job's area, raises an owner row on the Tracker.
- Wiki jobs run restricted: only read tools, and writes only into their own area.
- Raw job logs (`.joserah/desk/jobs/**/*.jsonl`) and live job records stay out of the backup and are deleted after 30 days (`rawLogDays`). A short text digest of each job is kept.
- Sign-in is limited to 5 attempts a minute per address, then backs off; every request that changes something checks where it came from.

## Costs

Each job shows the cost estimate the Claude Code CLI reports, labelled as an estimate; the home screen shows
today's total. `jobBudgetUsd` caps a single job and `dailyBudgetUsd` stops new jobs for the day; `jobTimeoutMin`
and `jobMaxTurns` bound the time and the number of steps.

## Troubleshooting

- **Jobs cannot start**: Claude Code is missing or signed out. Natively, run `claude` once in a terminal and sign in; in Docker, `docker exec -it -w /workspace joserah claude` and `/login`.
- **The workspace is not a git repository**: the checkpoint before each job needs git; fix it in step 3 of the setup wizard.
- **A page says "signed out"**: the session ended (cookie expired or the server restarted). Follow its link and sign in again.
- **The port is already in use**: start with `--port <n>` (or set `port` in `server.json`).
- **Node is too old**: the launcher says so; the server needs 22.18 or newer.
