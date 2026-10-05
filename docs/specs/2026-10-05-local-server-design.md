# Joserah platform server — design

**Status:** approved by the owner ("Hepsini onayladım", 2026-10-05); amended the same evening for the platform
direction (decisions 8–11). Not built.
**Source:** Serkan (owner, developer of Joserah), in chat, 2026-10-05: "Kalıplarıyla bilmemnesiyle local bir webserver
haline getir joserah ı … giriş yapılan ve canlı güncellenen kendi arayüzü olsun. Artifact sınırlarından kurtulalım, çok
daha az token yakalım. Ben kendi arayüzümden kullanacağım, işi arkada sen (Claude Code) yapacaksın; mümkünse sıfır
bağlamlı alt ajanlarla." Later: "docker versiyonunda klasör paylaşmaya gerek yok … her şey docker da çalışır. bu sayede
host etmesi kolay olur ve gerekirse gpu erişimi de olur."
**Research:** [../design/2026-10-05-local-server-research.md](../design/2026-10-05-local-server-research.md) (engine,
terms, stack, skills, existing projects; every claim with its source).

## Decisions (owner, 2026-10-05)

1. For everyone — a product. The repo may go private with access for chosen people.
2. Beside the terminal plugin, not replacing it: same files, two doors.
3. Joserah is a skill set run by each user's **own** Claude Code login. No Claude is bundled; the server calls the
   unmodified `claude` CLI the user signed in to (the terms' carve-out — research §Engine).
4. Approach A: a thin Hono server over the existing page tools (not a separate front-end app, not Agent-SDK-centred).
5. First version: live pages and answers from the page; jobs from the browser; a setup wizard.
   **OpenRouter later — no code for it now**; nothing in the design blocks adding a key field.
6. Access is a setting: default this computer only; Tailscale; open internet possible — so login is strict from day one.
7. Install: Docker or native. **In Docker everything runs inside the container, no host folder sharing**; GPU optional.

8. **Joserah is a platform of three parts, built in this order** (owner, "A"): this server; then a **device runner**
   the user installs on their own machines with their consent, so heavy local work (PDF, documents, video, ComfyUI)
   runs on their own hardware instead of paid cloud resources — its own spec; then nothing separate for screens.
9. **Screens are the server UI** (owner: "Ekranlar sunucu arayüzü zaten"): phone, watch and TV use the same web
   interface — layouts must work at phone width and on a large read-only TV view; no native apps in this spec.
10. **Engine:** the logged-in Claude Code CLI on whichever machine hosts the server; OpenRouter will be the recommended
    engine later (owner: "ama biz openrouter önericez gelecekte") — the job runner keeps the engine behind one
    interface (`Engine.start(job) → stream`) so a second engine slots in without touching routes.
11. **Device runner, for its own spec** (owner chose C): by default runs only the tools a device allows; a device may
    opt in to running jobs with its own Claude Code. This server only reserves for it: a `target` field on every job
    (`"server"` in v1) and the `/api/devices` path prefix — no device code in v1.

## 1. Structure and parts (approved)

`server/` inside the Joserah plugin repo. TypeScript run directly by Node ≥ 22.18 (type stripping; `erasableSyntaxOnly`,
no enums/namespaces/decorators, `.ts` import extensions; no build step). Outside packages, all MIT: `hono`,
`@hono/node-server`, one Markdown renderer (chosen in the plan). TypeScript itself is a dev-only type checker
(`tsc --noEmit`).

**Install modes, one code base.**
- *Docker, self-contained:* the image carries Node, git, Claude Code, the Joserah plugin and the server. Workspace in a
  named volume (`/workspace`), Claude Code login in another (`~/.claude`). Nothing shared from the host. Optional GPU.
  Terminal door: `docker exec -it joserah claude` opens Claude Code with the plugin on the same files.
- *Native:* `joserah serve` from a workspace folder.
- One server per workspace, its own port; a machine with two workspaces runs two servers (hosted workspaces stay
  isolated — standing rule 13).

**Parts, one job each.**
1. **Store** — the only writer the server has. Reads and writes workspace files (Tracker rows, Trail, Case, journal,
   tasks, answers). Atomic writes (temp file + rename). Emits a change event on each of its writes; polls mtimes every
   2 s for edits made elsewhere (terminal sessions, native mode on Windows).
2. **Pages** — renders Tracker, Trail, Case with the existing tools as libraries (`tracker.js` `board`, `trail.js`,
   `case.js`); renders Markdown reports to HTML inside the Theme.
3. **Artifact shim** — a small client script giving pages the same `window.claude` the artifact runtime gave:
   `use("db")` (collection, `doc().set()`, `onSnapshot`) over HTTP + SSE, and `hot` (`snapshot`, `ready`, `data`) so a
   live re-render keeps open rows and scroll exactly as a republish did. Today's page scripts run unchanged.
4. **Jobs** — runs the user's Claude Code headless per job; streams; logs; cancels; at most 2 at a time (setting,
   default 1 — standing rule 6).
5. **Login** — password, session cookie, rate limit, exposure setting.
6. **Setup wizard** — workspace, password, Claude Code present and signed in, backup remote.

**Home screen:** live Tracker; a job box; running jobs' streams; the list of pages (Trail, Case, reports).

## 2. Data flow

**Viewing a page.** `GET /p/tracker` → Pages renders today's Tracker from `rows.json` with the shim injected →
browser opens `GET /events` (SSE). Store writes or detects a change → event `{type:"changed", path}` → the shim fetches
the fresh page and swaps it in, carrying state through `hot.snapshot` → the page's own motion script marks new and
changed rows as it does today. Last-Event-ID resumes after a dropped connection.

**Answering a row.** The page's answer form calls the shim's `col.doc(id).set(a)` → `PUT /api/db/answers/<id>` →
Store writes `answers.json` beside the Tracker's `rows.json` (same doc shapes as today: choice, `--n` note, `--r`
assistant reply) → `onSnapshot` subscribers get it over SSE. The assistant reads answers through a new
`tools/answers.js` (`list --new`, `mark <id> read`, `reply <id> --note`) instead of ArtifactData; the session brief
lists new answers. Setting `answerStartsJob` (default on): a new answer starts a short job "process new answers" when
no job is running — the work happens behind, as asked.

**Giving a job.** `POST /api/jobs {text}` → queue → Jobs spawns `claude -p <text> --output-format stream-json
--verbose` with cwd = the workspace and the workspace's own permission settings (`--permission-mode acceptEdits`;
anything that needs an interactive approval fails and is reported, never silently widened). Each line of the stream →
job log `.joserah/desk/jobs/<day>/<id>.jsonl` and SSE `{type:"job", id, event}`. The final `result` line closes the job
with its text and cost estimate. A follow-up `POST /api/jobs/<id>/reply` resumes the same session (`--resume
<session_id>`). Every job starts from a fresh session — zero conversation context; inside it the plugin's own
orchestration decides on subagents. While a job runs, Jobs keeps a crew-strip entry on the Tracker (`tracker.js crew`),
so running work shows where it always has; the rows themselves stay the assistant's to write.

## 3. Login and security

- **Password** set in the wizard, stored as a scrypt hash (`node:crypto`). Server secrets (hash, cookie key) live under
  `keys/server/` — outside the backup, never read by the assistant.
- **Session cookie** HttpOnly, SameSite=Strict, Secure whenever served over HTTPS; every state-changing request also
  checks `Origin`. Login rate limit: 5 attempts a minute per address, then back-off.
- **Exposure setting** `local` (default, binds 127.0.0.1) · `tailnet` (binds the given address; Tailscale already
  encrypts) · `internet` (refuses to start without HTTPS — a certificate path or a reverse proxy declared in config).
- **Logged in means "may run Claude Code on this machine"** — the login is the master key and is treated as such.
- Job logs and streamed text pass through the existing redaction (`hooks/lib/redactions.js`); secrets are never logged.
- Install `security-guidance` (official) and review the server with it before the first release.

## 4. Docker and install

- Image from `node:24-slim`, non-root user `joserah`, git, Claude Code by its official install method (verified in the
  plan, not assumed here), the plugin, the server. Volumes `joserah-workspace:/workspace`,
  `joserah-claude:/home/joserah/.claude`. Port published to `127.0.0.1` unless the exposure setting says otherwise.
  Healthcheck `GET /healthz`. GPU through a compose profile (`gpus: all`) — off by default.
- **Claude Code sign-in inside the container is the riskiest step**: the wizard must get the user through Claude Code's
  own login (or `claude setup-token`) without a host browser on the same machine. First task of the plan is a spike
  that proves it; if it fails, the fallback is the user running `docker exec -it joserah claude` once.
- Native: `node server/main.ts --workspace <dir>`, wrapped as `joserah serve`. Windows, macOS, Linux — no build step,
  the same files run everywhere. The Docker image is Linux and is built for `linux/amd64` and `linux/arm64`.
- Backup: the wizard sets the workspace's git remote (today's backup); the docs show a volume export for a full copy.

## 5. Failure handling and testing

- Claude Code missing or signed out → wizard step stays open, job box disabled with the reason in plain words.
- Job crash, timeout (setting, default 30 min) or cancel → job marked failed, log kept, an owner row on the Tracker.
- Terminal sessions writing the same files → Store re-reads on mtime change; renders are atomic; the last writer wins
  per file, as today.
- SSE drop → reconnect with Last-Event-ID; a page that cannot hold SSE falls back to a 10 s poll.
- **Tests** (`node --test`, TypeScript test files run as-is): routes through Hono's `app.request()` with no socket; Jobs
  against a fake `claude` that replays recorded stream-json; Store against a temp workspace; one browser test (Playwright,
  already present) that answers a Tracker row through the shim and sees it come back over SSE. `tsc --noEmit` in the
  suite. The existing 889 tests stay untouched and green.
- **Skills** (first plan step): install `hono@hono` (honojs/skills, MIT), `security-guidance`, `typescript-lsp`
  (official); write ours with `writing-skills`: `joserah-node-ts-strip`, `joserah-hono-sse-routes`,
  `joserah-claude-cli-driver`, `joserah-auth-and-secrets`, `joserah-docker-native-parity`.

## 6. Knowledge wiki (Karpathy's lessons)

Owner, 2026-10-05: "Karpathy den alacağımız dersleri de düşünmüştün onları ekleyelim wiki falan." Source: Karpathy's
LLM-wiki gist (gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) as read in the workspace's research note
`platform/research/16-kb-maintenance-and-memory-tools.md`; Joserah already has its shape, the server makes it visible
and runs its operations.

- **Three layers, mapped:** raw = `imports/` (immutable, never edited — rule 4); wiki = `.joserah/knowledge/` (LLM-owned
  pages, claim lines); schema = `AGENTS.md` + `conventions.md` ("what makes the LLM a disciplined wiki maintainer").
- **Wiki browser:** rendered pages with backlinks, `knowledge/wiki/index.md` (one line per page, generated), an
  append-only `log.md` (`## [YYYY-MM-DD] ingest|query|lint | title`), and a **claims view**: every
  `[measurement|calculation|decision|estimate]` line with its condition, date, source; struck (`superseded:`) lines shown
  struck and never used. Search: index + text search now; SQLite full-text only past ~1,000 notes (research: "at small
  scale the index file is enough").
- **Ingest:** a file dropped in the UI is copied verbatim to `imports/` → an ingest job writes the summary page, updates
  the touched entity/topic pages, the index and the log, and marks the source `status: compiled` with `compiled_to`.
- **Query:** a question asked in the UI is answered from the wiki with citations; a good answer has a "file it" button
  that turns it into a page (Karpathy: "good answers can be filed back into the wiki").
- **Lint, two layers:** a zero-token deterministic lint (broken links, orphans, frontmatter, stale uncompiled raw,
  superseded markers, duplicate slugs) runs on every change and nightly; the LLM pass runs only over the changed set
  (git/hash) and **quotes conflicting sentences and queues them as owner rows** instead of guessing.
- **Anti-drift:** a value that lives elsewhere is stored as a pointer to its home, never copied.

## 7. Token economy

Owner: "Token ekonomisi yapmayı unutma." The platform exists partly to burn fewer tokens; these are requirements.

- **The model never writes or re-reads a page.** It writes small JSON/Markdown through the tools (a Tracker row is a few
  hundred bytes); the server renders HTML. Today a Tracker publish rewrote ~170 KB.
- **Zero-token first:** rendering, indexes, link checks, lint, answer collection, job bookkeeping are scripts. A model is
  called only for judgement, and only over what changed (git/hash change set).
- **Lean jobs:** each job starts a fresh session with a brief the server composes — the task, file pointers, the one
  relevant rule — never pasted file contents. Subagent briefs are one line plus a path (standing orchestration rule).
- **Model per job type** (setting, defaults): routine bookkeeping, answer processing, session digests → Haiku; code,
  research, ingest → Sonnet; planning and final review only → Opus. Passed to the CLI as `--model`.
- **Cache-friendly prompts:** the stable instruction prefix first and unchanged between jobs; volatile context last and
  small; the session-start brief carries counts and pointers, not bodies.
- **Batching:** all new answers go to one job; the nightly lint and digest run once, not per change.
- **Visible cost:** each job shows the CLI's cost estimate (`total_cost_usd`, labelled an estimate); the home screen shows
  today's total; a per-job cap (turn limit and timeout; a money cap if the CLI offers one — verified in the plan).

## 8. Job safety and records (lessons from earlier projects)

From [../design/2026-10-05-lessons-for-platform.md](../design/2026-10-05-lessons-for-platform.md) (evidence per item there;
its other "missing" items are folded into the plan).

- **Per-job-type tool allowlist.** Ingest, query and lint jobs may write only under `knowledge/**` (the verbatim
  copy into `imports/` is made by the server, never by the job); no Bash, no network, no mail tools. General jobs use the
  workspace's own permissions. Server secrets (`keys/server/`) live outside the directory a job runs in.
- **Checkpoint and diff.** Jobs write through the CLI, not through Store: before each job the server makes a checkpoint
  commit of the workspace; after it, it lists the changed files on the job and raises an owner Tracker row for any
  deletion or any write outside the job type's allowlist.
- **Job logs outside the backup.** The raw stream-json log is gitignored (`.joserah/desk/jobs/**/*.jsonl`); the backup
  keeps a short text digest per job (task, result, changed files, cost estimate).
- **Answers never overwrite.** An answer write merges by document id and never replaces another author's document —
  an owner's `set()` cannot erase an assistant reply (the destructive-upsert bug seen in Zenger Control's registration).

## Out of scope (v1)

OpenRouter or any second engine; the device runner and any device code; native phone/watch/TV apps; several users or several workspaces per server; a separate front-end app; Wrap or
report generators beyond rendering Markdown; a mobile app; replacing the terminal plugin.

## Open questions

1. Default port (proposed 4747).
2. Markdown renderer choice (plan picks one MIT, dependency-free package and states why).
