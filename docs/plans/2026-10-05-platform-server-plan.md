# Platform Server Implementation Plan

**Status: partial — tasks 1+ not yet written.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `server/` — a login-protected local web server that shows the workspace's pages live (Tracker, Trail, Case, Markdown reports, the knowledge wiki), takes answers and jobs from the browser, and runs each job through the user's own signed-in Claude Code CLI, natively or self-contained in Docker.

**Architecture:** A thin Hono app run by Node's type stripping (no build). The existing zero-dependency tools stay the renderers and the writers of their own files; the server serves what they render, injects a small `window.claude` shim so today's page scripts run unchanged, and pushes changes over SSE. A Store is the only file writer inside the server process (atomic writes, change events, a 2 s mtime poll); jobs write through the CLI, so every job is framed by a git checkpoint before and a changed-file check after. Jobs go through one `Engine` interface; v1 has one engine, the `claude` CLI in `-p --output-format stream-json` mode with the prompt on stdin. Deterministic work (rendering, index, lint, answer collection, bookkeeping) is code; the model is called only for judgement, with lean server-composed briefs.

**Tech Stack:** Node ≥ 22.18 (developed on v24.19.0) with type stripping, TypeScript checked by `tsc --noEmit`, Hono 4.13.13 + @hono/node-server 2.1.3, marked 18.1.0, `node:test`, Playwright 1.63.0 (one browser test), git, Docker 29 (image `node:24-slim`), Claude Code CLI 2.1.289.

**Spec:** `docs/specs/2026-10-05-local-server-design.md` (decisions 1–11, §1–§8). Also read `docs/design/2026-10-05-local-server-research.md` and `docs/design/2026-10-05-lessons-for-platform.md` (items B1–B12 are cited by number below). Section numbers refer to the spec.

## Global Constraints

- **Language and runtime:** TypeScript under `server/`, run directly by Node ≥ 22.18 type stripping (`node server/main.ts`). `server/tsconfig.json` sets `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`, `module: "nodenext"`, `allowImportingTsExtensions`. Imports carry `.ts` extensions; type-only imports use `import type`. No enums, namespaces, parameter properties or decorators. No build step.
- **Dependencies:** runtime only `hono@4.13.13`, `@hono/node-server@2.1.3`, `marked@18.1.0` — marked because it is MIT, has zero dependencies, ships plain ESM JavaScript with its own `.d.ts`, and has GFM tables built in. Dev only: `typescript@7.0.2`, `@types/node@^24` (for `tsc --noEmit`), `playwright@1.63.0` (Task 17). `server/package.json` (`"type": "module"`, `"private": true`) owns them; `server/package-lock.json` is committed; `node_modules/` stays ignored. Every file under `tools/` and `hooks/` stays zero-dependency CommonJS — the server reaches them through `createRequire` or by running their CLIs.
- **Tests:** `node:test`, files `server/test/*.test.ts`, run with `node --test --test-concurrency=1 server/test/*.test.ts` from the repo root. Routes through Hono's `app.request()` (no sockets); jobs through a fake `claude` (`server/test/fixtures/fake-claude.mjs`) replaying recorded stream-json; git through real temp repositories. `tsc --noEmit` runs inside the suite (`server/test/typecheck.test.ts`). The existing suite (`node --test tests/*.test.js`, 889 passing at plan time) stays green; Task 18 runs both.
- **One machine resource rule:** never two heavy things at once — one `docker build` or one browser test at a time, never beside each other or a second build (AGENTS.md rule 6).
- **Engine:** one interface, `Engine.start(job) → EngineRun` plus `Engine.health()` (decision 10; B7). Every job carries `target` (`"server"` only in v1). `/api/devices` and everything under it is reserved and answers `501` (decision 11); no device code; device auth will use per-device tokens, never the cookie (B4).
- **Screens:** every server page works at 390 px width with a 16 px side gutter and no horizontal scroll; `/tv` is a large, read-only view of the Tracker (decision 9).
- **Token economy (§7), each with a test:** (a) the model never writes or re-reads an HTML page — briefs name the tools that write pages, say so, and contain no `.html` path; (b) briefs are composed by the server: a stable prefix identical across jobs, then the task, then file pointers — never pasted file bodies; anything cut carries a `[cut]` marker (B12); (c) model per job type, passed as `--model` — defaults `answers`, `digest`, `bookkeeping` → `haiku`; `task`, `code`, `research`, `ingest`, `query`, `lint` → `sonnet`; `plan`, `review` → `opus`; a type missing from the setting routes to `opus`; `haiku` is refused for the claim-touching types `ingest`, `query`, `lint`, `research`, `plan`, `review` (B11); (d) all new answers inside the batch window go to one job, and acknowledgement-only answers start no model (B11); (e) each job shows the CLI's `total_cost_usd` labelled an estimate; the home screen shows today's total; (f) per job: turn limit and timeout enforced by the server, money cap `--max-budget-usd` (verified in Claude Code 2.1.289 `--help`: "Maximum dollar amount to spend on API calls (only works with --print)"; a probe hit it and ended with `subtype: "error_max_budget_usd"`); per day: `dailyBudgetUsd` stops new jobs (B11).
- **Automation is the owner's to switch on (B11):** `answerStartsJob` default **off**; nightly LLM lint default **off**; deterministic lint on.
- **Job safety (§8, B1–B3, B10):** spawn without a shell, own process group, cancel by PID tree (`taskkill /PID <pid> /T /F` on Windows, `kill(-pid)` elsewhere) — never by image name; prompt on stdin as UTF-8 (verified: `printf '…çğış…' | claude -p …` returned `çğış`). `ingest`, `query`, `lint` jobs run `--restricted --strict-mcp-config --permission-mode default --permission-prompts none` with `--tools` limited to file tools and writes allowed only inside their area (verified: `--restricted --strict-mcp-config --tools Read` gave an init `tools: ["Read"]`); general jobs use `--permission-mode acceptEdits --permission-prompts none` and the workspace's own settings. A job with denied tool calls ends `needs-approval`, never silently widened. Before each job a git checkpoint commit; after it the changed files go on the job and an owner Tracker row is raised for any deletion or any write outside the type's area. Each job owns one Tracker row; a job that ends with its row still `run` turns it into an owner row.
- **Secrets out of the job's reach (§3, §8, B4):** the password hash, cookie key and setup token live in a **state directory outside the workspace** — `JOSERAH_STATE_DIR`, else `~/.joserah-server/<first 12 hex of sha1(workspace path)>/` (Docker: its own volume). The job's environment is an allowlist (no server variables, nothing named like a secret except the engine's own `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`). A present but unreadable or empty auth file stops the server from starting; only a missing one means setup.
- **Records (§8, B6, B8):** per job `.joserah/desk/jobs/<day>/<id>.job.json` (live record, persisted at every state change, `sessionId` at the first event) and `<id>.jsonl` (raw mapped stream, redacted) are gitignored — the server adds `.joserah/desk/jobs/**/*.jsonl` and `.joserah/desk/jobs/**/*.job.json` to the workspace `.gitignore` at start if missing; `<id>.md`, a short text digest (task, state, result, changed files, cost estimate, CLI version), is backed up. Raw logs older than 30 days are deleted at start and nightly. On start, queued jobs stay queued and running jobs become `interrupted`.
- **Security (§3):** scrypt password hash; session cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` over HTTPS; every state-changing request checks `Origin`; login limited to 5 attempts a minute per address, then doubling back-off up to 1 h; exposure `local` (default, 127.0.0.1) · `tailnet` (a given address) · `internet` (refuses to start without HTTPS); job logs and streamed text pass through `hooks/lib/redactions.js` `redact()`; an unknown `/api/` path answers 404 JSON, never HTML (B7). Uploads are scanned with the `SPECIFIC` patterns of `hooks/lib/redactions.js` before any model reads them; hits are quarantined with an owner row (B9). Default port **4747**.
- **Existing tools change only where the spec needs:** new `tools/lib/answers.js`, `tools/answers.js`, `tools/lib/wiki.js`, `tools/wiki.js`; one new line source in `hooks/session-brief.js`. `tracker.js`, `trail.js`, `case.js`, `scaffold.js` are not modified.
- **Data placement:** server settings `.joserah/server.json` (backed up, no secrets); answers `answers.json` beside the page's `rows.json`; lint results `.joserah/desk/lint/`; wiki index `.joserah/knowledge/wiki/index.md` (generated), log `.joserah/knowledge/wiki/log.md` (append-only), source register `.joserah/knowledge/sources.json`; uploads `imports/<YYYY-MM-DD>-upload/<name>`, quarantined uploads `imports/<YYYY-MM-DD>-quarantine/<name>` (verbatim, rule 4).
- **No personal data** in the repository (CONTRIBUTING.md): tests and fixtures use `O`, `w`, `example.invalid`.
- **Commits:** English subject; the message ends with the line `Claude Sonnet — Joserah Worker`; no `Co-Authored-By`; never push (the orchestrator pushes).

## Review Focus

1. **A crafted page, asset or wiki path** (`/p/../../keys/x`, `%2e%2e`, a backslash on Windows, `/w/page/../../.joserah/config.json`): 404, never a file outside the page or knowledge folder. → Task 5 test `traversal is refused`, Task 12 test `wiki traversal is refused`.
2. **The server restarts while a job runs** (crash, `docker restart`): the job must not read "running" forever. On start it becomes `interrupted`, its strip entry is cleared, its row becomes an owner row, and queued jobs still run. → Task 9 test `recover marks running jobs interrupted and keeps the queue`.
3. **A terminal session and the browser write answers at the same moment** (`answers.js reply` while a PUT lands): no answer is lost, and the owner's write never replaces the assistant's reply. → Task 6 tests `two writers lose nothing` and `an owner write never replaces an assistant document`.
4. **Turkish text, quotes and newlines in a job** typed in the browser (`"Şu dosyayı" 'özetle'\nsonra…`): reaches the CLI byte-identical on stdin, on Windows too. → Task 8 test `stdin carries Turkish, quotes and newlines`.
5. **The session ends while a page is open** (cookie expired, server restarted): no reload loop, no silently hidden form — the page shows "signed out — sign in again" with a link; API answers `401 {error:"signed-out"}`, pages redirect to `/login?next=`. → Task 4 test `api 401 vs page redirect`, Task 17 browser step `signed-out banner`.

## Spec notes the plan settles

- **Renderers as CLIs, not libraries.** Spec §1 says Pages uses the tools "as libraries (`tracker.js board`, `trail.js`, `case.js`)". `tracker.js` and `trail.js` do not export `render`, and `case.js` runs its CLI at `require` time (it would `process.exit`). Every tool already re-renders its `index.html` on each change, so Pages serves that file and, when the source JSON is newer than the page (a hand edit), runs the tool's CLI (`node tools/tracker.js <dir>`, `node tools/trail.js render <dir>`, `node tools/case.js render <dir>`). No tool is modified.
- **Answers are per page.** Spec §2 writes `PUT /api/db/answers/<id>`; one server serves many pages, each with its own `answers.json`, so the path is `PUT /api/db/<day>/<folder>/answers/<id>`.
- **Live swap is a reload.** The artifact runtime reloaded every open view on a publish (comment above `MOTION_JS` in `tools/tracker.js`); the shim does the same — `hot.snapshot()` into `sessionStorage`, `location.reload()`, `hot.data` restored before page scripts run — so `STATE_JS` and `MOTION_JS` behave as under a republish.
- **"compiled" lives beside the source.** Spec §6 marks an ingested source `status: compiled` with `compiled_to`; `imports/` is immutable (rule 4) and a PDF has no frontmatter, so the mark is a register, `.joserah/knowledge/sources.json`.
- **Wiki jobs get no Bash (§8), so the server does their bookkeeping.** Index, log and the compiled mark after an ingest, and the owner rows for lint conflicts, are written by the server (zero-token) from the job's changed files and from a conflicts file the lint job writes under `.joserah/knowledge/.lint/`.
- **Secrets move out of the workspace.** Spec §3 names `keys/server/`; §8 and B4 require them outside the job's directory. The plan uses the state directory above; `keys/` is not used by the server.
- **Sign-in spike and plugin installs move to the owner.** Spec §4 asks for a first-task spike proving Claude Code sign-in inside the container, and §5 installs `hono@hono`, `security-guidance`, `typescript-lsp` first; both need a person at the keyboard (`/plugin install`, a browser for sign-in), so they are Task 19. Nothing before it depends on a signed-in CLI.
- **GPU** is an override file (`server/compose.gpu.yaml`) rather than a compose profile, so the container keeps one name (`joserah`) for the terminal door.

---

## File Structure

```
server/
  package.json            deps, scripts (test, typecheck, start), bin joserah
  package-lock.json  tsconfig.json  main.ts
  bin/joserah.mjs         `joserah serve` (plain JS launcher; prints the URL, opens no window)
  Dockerfile  compose.yaml  compose.gpu.yaml  README.md
  src/
    paths.ts              PLUGIN_ROOT, toolPath(), localDay(), stateDir()
    cjs.ts                typed createRequire bridges to tools/ and hooks/ libs
    config.ts             ServerConfig, JOB_TYPES, defaults, loadServerConfig, modelFor, resolveListen
    app.ts                createApp(deps): middleware order + route registration
    deps.ts               AppDeps + buildDeps() composition root
    events.ts             EventBus (ids, ring buffer, subscribers)
    store.ts              Store (atomic writes, change events, mtime poll, importVerbatim)
    auth.ts               password, Sessions, RateLimiter, originOk, setup token, auth file checks
    security.ts           headers, CSP builders, guard middleware
    layout.ts             shell(), PAGE_CSS, TV_CSS, LABELS, langOf()
    markdown.ts           renderMarkdown() (marked; raw HTML escaped; safe links)
    pages.ts              page discovery, kinds, stale re-render, asset paths
    shim.ts               SHIM_JS, injectShim()
    engine.ts             Engine, EngineJob, EngineEvent, EngineRun, EngineHealth
    engines/claude-cli.ts ClaudeCliEngine, claudeArgs(), parseLine(), killTree(), jobEnv()
    briefs.ts             BRIEF_PREFIX, composeBrief(), cut()
    tracker-bridge.ts     job rows, crew strip, owner rows through tools/tracker.js
    checkpoint.ts         git checkpoint, changed files, assess()
    jobs.ts               JobRunner (persisted queue, logs, digests, limits, cancel, resume, recover, cost)
    answer-trigger.ts     answerStartsJob batching, acknowledgement filter
    lint-scheduler.ts     msUntil(), on-change lint, nightly with lock and catch-up, LLM pass
    routes/               auth.ts pages.ts db.ts events.ts jobs.ts home.ts wiki.ts ingest.ts setup.ts
  test/
    helpers.ts  *.test.ts  fixtures/fake-claude.mjs  fixtures/stream-ok.jsonl
    browser/answer.e2e.ts
tools/lib/answers.js  tools/answers.js  tools/lib/wiki.js  tools/wiki.js
tests/answers.test.js  tests/wiki.test.js        (zero-dependency tool tests, existing suite)
hooks/session-brief.js                           (+ the [answers] line)
.claude/skills/joserah-*/SKILL.md                (five dev skills)
.dockerignore
```

Tasks: 1 dev skills · 2 scaffold · 3 Store · 4 auth · 5 pages · 6 answers, shim, SSE · 7 answers CLI and brief · 8 engine · 9 job runner · 10 checkpoint and diff · 11 job routes, answer trigger, home · 12 wiki browser · 13 ingest and query · 14 lint · 15 setup wizard · 16 Docker · 17 browser test · 18 `joserah serve`, docs, release note · 19 owner present.

---
