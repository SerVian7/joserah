# Platform Server Implementation Plan

**Status:** complete — 20 tasks, assumptions and self-review at the end (Architect, 2026-10-06). Execution: subagent-driven, one task at a time.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `server/` — a login-protected local web server that shows the workspace's pages live (Tracker, Trail, Case, Markdown reports, the knowledge wiki), takes answers and jobs from the browser, and runs each job through the user's own signed-in Claude Code CLI, natively or self-contained in Docker.

**Architecture:** A thin Hono app run by Node's type stripping (no build). The existing zero-dependency tools stay the renderers and the writers of their own files; the server serves what they render, injects a small `window.claude` shim so today's page scripts run unchanged, and pushes changes over SSE. A Store is the only file writer inside the server process (atomic writes, change events, a 2 s mtime poll); jobs write through the CLI, so every job is framed by a git checkpoint before and a changed-file check after. Jobs go through one `Engine` interface; v1 has one engine, the `claude` CLI in `-p --output-format stream-json` mode with the prompt on stdin. Deterministic work (rendering, index, lint, answer collection, bookkeeping) is code; the model is called only for judgement, with lean server-composed briefs.

**Tech Stack:** Node ≥ 22.18 (developed on v24.19.0) with type stripping, TypeScript checked by `tsc --noEmit`, Hono 4.13.13 + @hono/node-server 2.1.3, marked 18.1.0, `node:test`, Playwright 1.63.0 (one browser test), git, Docker 29 (image `node:24-slim`), Claude Code CLI 2.1.289.

**Spec:** `docs/specs/2026-10-05-local-server-design.md` (decisions 1–11, §1–§8). Also read `docs/design/2026-10-05-local-server-research.md` and `docs/design/2026-10-05-lessons-for-platform.md` (items B1–B12 are cited by number below). Section numbers refer to the spec.

## Global Constraints

- **Language and runtime:** TypeScript under `server/`, run directly by Node ≥ 22.18 type stripping (`node server/main.ts`). `server/tsconfig.json` sets `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`, `module: "nodenext"`, `allowImportingTsExtensions`. Imports carry `.ts` extensions; type-only imports use `import type`. No enums, namespaces, parameter properties or decorators. No build step.
- **Dependencies:** runtime only `hono@4.13.13`, `@hono/node-server@2.1.3`, `marked@18.1.0` — marked because it is MIT, has zero dependencies, ships plain ESM JavaScript with its own `.d.ts`, and has GFM tables built in. Dev only: `typescript@7.0.2`, `@types/node@^24` (for `tsc --noEmit`), `playwright@1.63.0` (Task 18). `server/package.json` (`"type": "module"`, `"private": true`) owns them; `server/package-lock.json` is committed; `node_modules/` stays ignored. Every file under `tools/` and `hooks/` stays zero-dependency CommonJS — the server reaches them through `createRequire` or by running their CLIs.
- **Tests:** `node:test`, files `server/test/*.test.ts`, run with `node --test --test-concurrency=1 "server/test/*.test.ts"` from the repo root (the glob quoted, so Node expands it on every shell). Routes through Hono's `app.request()` (no sockets); jobs through a fake `claude` (`server/test/fixtures/fake-claude.mjs`) replaying recorded stream-json; git through real temp repositories. `tsc --noEmit` runs inside the suite (`server/test/typecheck.test.ts`). The existing suite (`node --test tests/*.test.js`, 889 passing at plan time) stays green; Task 19 runs both.
- **One machine resource rule:** never two heavy things at once — one `docker build` or one browser test at a time, never beside each other or a second build (AGENTS.md rule 6).
- **Engine:** one interface, `Engine.start(job) → EngineRun` plus `Engine.health()` (decision 10; B7). Every job carries `target` (`"server"` only in v1). `/api/devices` and everything under it is reserved and answers `501` (decision 11); no device code; device auth will use per-device tokens, never the cookie (B4).
- **Screens:** every server page works at 390 px width with a 16 px side gutter and no horizontal scroll; `/tv` is a large, read-only view of the Tracker (decision 9).
- **Token economy (§7), each with a test:** (a) the model never writes or re-reads an HTML page — briefs name the tools that write pages, say so, and contain no `.html` path; (b) briefs are composed by the server: a stable prefix identical across jobs, then the task, then file pointers — never pasted file bodies; anything cut carries a `[cut]` marker (B12); (c) model per job type, passed as `--model` — defaults `answers`, `digest`, `bookkeeping` → `haiku`; `task`, `code`, `research`, `ingest`, `query`, `lint` → `sonnet`; `plan`, `review` → `opus`; a type missing from the setting routes to `opus`; `haiku` is refused for the claim-touching types `ingest`, `query`, `lint`, `research`, `plan`, `review` (B11); (d) all new answers inside the batch window go to one job, and acknowledgement-only answers start no model (B11); (e) each job shows the CLI's `total_cost_usd` labelled an estimate; the home screen shows today's total; (f) per job: turn limit and timeout enforced by the server, money cap `--max-budget-usd` (verified in Claude Code 2.1.289 `--help`: "Maximum dollar amount to spend on API calls (only works with --print)"; a probe hit it and ended with `subtype: "error_max_budget_usd"`); per day: `dailyBudgetUsd` stops new jobs (B11).
- **Automation is the owner's to switch on (B11):** `answerStartsJob` default **off**; nightly LLM lint default **off**; deterministic lint on.
- **Job safety (§8, B1–B3, B10):** spawn without a shell, own process group, cancel by PID tree (`taskkill /PID <pid> /T /F` on Windows, `kill(-pid)` elsewhere) — never by image name; prompt on stdin as UTF-8 (verified: `printf '…çğış…' | claude -p …` returned `çğış`). `ingest`, `query`, `lint` jobs run `--restricted --strict-mcp-config --permission-mode dontAsk --permission-prompts none --tools Read,Grep,Glob[,Edit,Write]` and, when they may write, `--allowedTools "Edit(<area>/**)" "Write(<area>/**)"` last on the line (verified 2026-10-06 on this machine, CLI 2.1.289: with `--allowedTools "Write(.joserah/knowledge/**)"` a write into `.joserah/knowledge/k.txt` landed and a write to `top.txt` was denied, `system/permission_denied` event plus `result.permission_denials`; the partial head said `--permission-mode default`, which `--help` does not list — `dontAsk` is the mode that denies everything not allowed); general jobs use `--permission-mode acceptEdits --permission-prompts none` and the workspace's own settings. A job with denied tool calls ends `needs-approval`, never silently widened. Before each job a git checkpoint commit; after it the changed files go on the job and an owner Tracker row is raised for any deletion or any write outside the type's area. Each job owns one Tracker row; a job that ends with its row still `run` turns it into an owner row.
- **Secrets out of the job's reach (§3, §8, B4):** the password hash, cookie key and setup token live in a **state directory outside the workspace** — `JOSERAH_STATE_DIR`, else `~/.joserah-server/<first 12 hex of sha1(workspace path)>/` (Docker: its own volume). The job's environment is an allowlist (no server variables, nothing named like a secret except the engine's own `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`). A present but unreadable or empty auth file stops the server from starting; only a missing one means setup.
- **Records (§8, B6, B8):** per job `.joserah/desk/jobs/<day>/<id>.job.json` (live record, persisted at every state change, `sessionId` at the first event) and `<id>.jsonl` (raw mapped stream, redacted) are gitignored — the server adds `.joserah/desk/jobs/**/*.jsonl` and `.joserah/desk/jobs/**/*.job.json` to the workspace `.gitignore` at start if missing; `<id>.md`, a short text digest (task, state, result, changed files, cost estimate, CLI version), is backed up. Raw logs older than 30 days are deleted at start and nightly. On start, queued jobs stay queued and running jobs become `interrupted`.
- **Security (§3):** scrypt password hash; session cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` over HTTPS; every state-changing request checks `Origin`; login limited to 5 attempts a minute per address, then doubling back-off up to 1 h; exposure `local` (default, 127.0.0.1) · `tailnet` (a given address) · `internet` (refuses to start without HTTPS); job logs and streamed text pass through `hooks/lib/redactions.js` `redact()`; an unknown `/api/` path answers 404 JSON, never HTML (B7). Uploads are scanned with the `SPECIFIC` patterns of `hooks/lib/redactions.js` before any model reads them; hits are quarantined with an owner row (B9). Default port **4747**.
- **Existing tools change only where the spec needs:** new `tools/lib/answers.js`, `tools/answers.js`, `tools/lib/wiki.js`, `tools/wiki.js`; one new line source in `hooks/session-brief.js`. `tracker.js`, `trail.js`, `case.js`, `scaffold.js` are not modified.
- **Data placement:** server settings `.joserah/server.json` (backed up, no secrets); answers `answers.json` beside the page's `rows.json`; lint results `.joserah/desk/lint/`; wiki index `.joserah/knowledge/wiki/index.md` (generated), log `.joserah/knowledge/wiki/log.md` (append-only), source register `.joserah/knowledge/sources.json`; uploads `imports/<YYYY-MM-DD>-upload/<name>`, quarantined uploads `imports/<YYYY-MM-DD>-quarantine/<name>` (verbatim, rule 4).
- **No personal data** in the repository (CONTRIBUTING.md): tests and fixtures use `O`, `w`, `example.invalid`.
- **Commits:** English subject; blank line; the message ends with the signature line `<model> <effort> — Joserah Worker` (for example `Claude Sonnet 5 Medium — Joserah Worker`); no `Co-Authored-By`; never push (the orchestrator pushes). Each task below gives the subject.

## Review Focus

1. **A crafted page, asset or wiki path** (`/p/../../keys/x`, `%2e%2e`, a backslash on Windows, `/w/page/../../.joserah/config.json`): 404, never a file outside the page or knowledge folder. → Task 5 test `traversal is refused`, Task 12 test `wiki traversal is refused`.
2. **The server restarts while a job runs** (crash, `docker restart`): the job must not read "running" forever. On start it becomes `interrupted`, its strip entry is cleared, its row becomes an owner row, and queued jobs still run. → Task 9 test `recover marks running jobs interrupted and keeps the queue`.
3. **A terminal session and the browser write answers at the same moment** (`answers.js reply` while a PUT lands): no answer is lost, and the owner's write never replaces the assistant's reply. → Task 6 tests `two writers lose nothing` and `an owner write never replaces an assistant document`.
4. **Turkish text, quotes and newlines in a job** typed in the browser (`"Şu dosyayı" 'özetle'\nsonra…`): reaches the CLI byte-identical on stdin, on Windows too. → Task 8 test `stdin carries Turkish, quotes and newlines`.
5. **The session ends while a page is open** (cookie expired, server restarted): no reload loop, no silently hidden form — the page shows "signed out — sign in again" with a link; API answers `401 {error:"signed-out"}`, pages redirect to `/login?next=`. → Task 4 test `api 401 vs page redirect`, Task 6 test `shim shows the signed-out banner on 401`, Task 18 browser step `signed-out banner`.

## Spec notes the plan settles

- **Renderers as CLIs, not libraries.** Spec §1 says Pages uses the tools "as libraries (`tracker.js board`, `trail.js`, `case.js`)". `tracker.js` and `trail.js` do not export `render`, and `case.js` runs its CLI at `require` time (it would `process.exit`). Every tool already re-renders its `index.html` on each change, so Pages serves that file and, when the source JSON is newer than the page (a hand edit), runs the tool's CLI (`node tools/tracker.js <dir>`, `node tools/trail.js render <dir>`, `node tools/case.js render <dir>`). No tool is modified.
- **Answers are per page.** Spec §2 writes `PUT /api/db/answers/<id>`; one server serves many pages, each with its own `answers.json`, so the path is `PUT /api/db/<day>/<folder>/answers/<id>`.
- **Live swap is a reload.** The artifact runtime reloaded every open view on a publish (comment above `MOTION_JS` in `tools/tracker.js`); the shim does the same — `hot.snapshot()` into `sessionStorage`, `location.reload()`, `hot.data` restored before page scripts run — so `STATE_JS` and `MOTION_JS` behave as under a republish.
- **"compiled" lives beside the source.** Spec §6 marks an ingested source `status: compiled` with `compiled_to`; `imports/` is immutable (rule 4) and a PDF has no frontmatter, so the mark is a register, `.joserah/knowledge/sources.json`.
- **Wiki jobs get no Bash (§8), so the server does their bookkeeping.** Index, log and the compiled mark after an ingest, and the owner rows for lint conflicts, are written by the server (zero-token) from the job's changed files and from a conflicts file the lint job writes under `.joserah/knowledge/.lint/`.
- **Secrets move out of the workspace.** Spec §3 names `keys/server/`; §8 and B4 require them outside the job's directory. The plan uses the state directory above; `keys/` is not used by the server.
- **Sign-in spike and plugin installs move to the owner.** Spec §4 asks for a first-task spike proving Claude Code sign-in inside the container, and §5 installs `hono@hono`, `security-guidance`, `typescript-lsp` first; both need a person at the keyboard (`/plugin install`, a browser for sign-in), so they are Task 20. Nothing before it depends on a signed-in CLI.
- **GPU** is an override file (`server/compose.gpu.yaml`) rather than a compose profile, so the container keeps one name (`joserah`) for the terminal door.

---

## File Structure

```
server/
  package.json            deps, scripts (test, typecheck, start), bin joserah
  package-lock.json  tsconfig.json  main.ts
  bin/joserah.mjs         `joserah serve` (plain JS launcher; prints the URL, opens no window)
  Dockerfile  compose.yaml  compose.gpu.yaml  README.md  docker/claude (wrapper adding --plugin-dir)  docker/smoke.sh
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
    client.ts             APP_JS (home and job pages: job box, live job lines)
    lint-scheduler.ts     msUntil(), on-change lint, nightly with lock and catch-up, LLM pass
    wiki-books.ts         upload scan, source register, index/log bookkeeping, file-an-answer
    routes/               auth.ts pages.ts db.ts events.ts jobs.ts home.ts wiki.ts ingest.ts lint.ts setup.ts
  test/
    helpers.ts  *.test.ts  fixtures/fake-claude.mjs  fixtures/stream-ok.jsonl  docker-files.test.ts  serve.test.ts
    browser/answer.e2e.ts
tools/lib/answers.js  tools/answers.js  tools/lib/wiki.js  tools/wiki.js
tests/answers.test.js  tests/wiki.test.js  tests/dev-skills.test.js   (existing suite)
hooks/session-brief.js                           (+ the [answers] line)
.claude/skills/joserah-*/SKILL.md                (five dev skills)
.dockerignore
```

Tasks: 1 dev skills · 2 scaffold · 3 Store and events · 4 login · 5 pages, phone and TV · 6 answers, shim, SSE · 7 answers CLI and session brief · 8 engine · 9 job runner · 10 checkpoint and diff (§8) · 11 job routes and home · 12 wiki browser (§6) · 13 ingest and query (§6) · 14 lint (§6) · 15 token economy (§7) · 16 setup wizard · 17 Docker build and smoke · 18 browser test · 19 `joserah serve`, docs, release · 20 owner present (not for agents).

---

## How to run this plan

- One task at a time, in order; a fresh implementer per task, a fresh reviewer after it (superpowers:subagent-driven-development). A task's **Interfaces** block is the contract with its neighbours: names and types there are binding.
- Every task starts with a failing test and shows it failing before any implementation is written.
- Commands are written for Git Bash on Windows from the repository root (`projects/Atay/joserah`) and work unchanged on Linux and macOS.
- Before Task 2 nothing exists under `server/`; from Task 2 on, `npm --prefix server ci` restores `server/node_modules` on a fresh checkout.
- The full server suite is `node --test --test-concurrency=1 "server/test/*.test.ts"`; the existing suite is `node --test tests/*.test.js`. Run the existing suite at the end of every task that touches `tools/`, `hooks/` or `tests/`.
- Task 20 is the owner's, not an agent's.

---

### Task 1: Development skills

Five project skills that carry the rules this plan depends on, so every later implementer gets them by trigger instead of re-deriving them. They live in `.claude/skills/` of the plugin repo (loaded for sessions opened in this repo, never shipped: the plugin's own skills are under `skills/`). Write them with superpowers:writing-skills; the content below is the required minimum.

**Files:**
- Create: `.claude/skills/joserah-node-ts-strip/SKILL.md`
- Create: `.claude/skills/joserah-hono-sse-routes/SKILL.md`
- Create: `.claude/skills/joserah-claude-cli-driver/SKILL.md`
- Create: `.claude/skills/joserah-auth-and-secrets/SKILL.md`
- Create: `.claude/skills/joserah-docker-native-parity/SKILL.md`
- Test: `tests/dev-skills.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: five skills named `joserah-node-ts-strip`, `joserah-hono-sse-routes`, `joserah-claude-cli-driver`, `joserah-auth-and-secrets`, `joserah-docker-native-parity`; later briefs name them.

- [ ] **Step 1: Write the failing test**

```js
// tests/dev-skills.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PLUGIN_ROOT } = require('./helpers');

// Each development skill must load (frontmatter name + trigger-shaped description, LF only)
// and carry the facts the server plan relies on; a skill that lost one of them would teach
// the next implementer the wrong thing.
const MUST = {
  'joserah-node-ts-strip': ['erasableSyntaxOnly', 'import type', '.ts', 'enum', 'node_modules', '--test-concurrency=1'],
  'joserah-hono-sse-routes': ['streamSSE', 'Last-Event-ID', 'app.request', '404', 'Origin', 'HttpBindings'],
  'joserah-claude-cli-driver': ['stream-json', 'stdin', 'taskkill', '/T', 'dontAsk', '--allowedTools', 'permission_denials', '--max-budget-usd', 'session_id', 'redact'],
  'joserah-auth-and-secrets': ['scrypt', 'SameSite=Strict', 'HttpOnly', 'JOSERAH_STATE_DIR', 'Origin', 'allowlist', 'empty'],
  'joserah-docker-native-parity': ['node:24-slim', 'CLAUDE_CONFIG_DIR', 'JOSERAH_IN_DOCKER', 'eol=lf', '127.0.0.1', 'DISABLE_AUTOUPDATER'],
};

for (const [name, facts] of Object.entries(MUST)) {
  test(`dev skill ${name} loads and carries its facts`, () => {
    const p = path.join(PLUGIN_ROOT, '.claude', 'skills', name, 'SKILL.md');
    assert.ok(fs.existsSync(p), `${p} missing`);
    const text = fs.readFileSync(p, 'utf8');
    assert.ok(!text.includes('\r'), 'LF only: a CRLF frontmatter does not parse');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, 'frontmatter');
    assert.match(fm[1], new RegExp(`^name: ${name}$`, 'm'));
    assert.match(fm[1], /^description: Use when /m, 'trigger-shaped description');
    for (const f of facts) assert.ok(text.includes(f), `${name} must mention ${f}`);
    assert.ok(text.split('\n').length <= 120, 'a skill stays short');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dev-skills.test.js`
Expected: FAIL, five tests, each `... SKILL.md missing`.

- [ ] **Step 3: Write the five skills**

`.claude/skills/joserah-node-ts-strip/SKILL.md`:

```markdown
---
name: joserah-node-ts-strip
description: Use when writing or reviewing TypeScript under server/ in the Joserah repo, or when Node refuses to run a .ts file, or tsc and Node disagree.
---

# TypeScript run by Node's type stripping

`server/` is TypeScript that Node ≥ 22.18 runs directly (`node server/main.ts`). There is no build.
Node only *erases* types, so only erasable syntax is allowed (`erasableSyntaxOnly` in tsconfig):

- No `enum` (use a `const` array and a union type: `const JOB_TYPES = [...] as const; type JobType = typeof JOB_TYPES[number]`).
- No `namespace`, no decorators, no parameter properties (`constructor(private x: T)` is a syntax error; declare the field, assign it).
- Every relative import carries `.ts`: `import { Store } from './store.ts'`.
- Type-only imports use `import type { Engine } from './engine.ts'` (`verbatimModuleSyntax`); a value import of a type is an error at run time.
- Private state uses `#field` (plain JavaScript, erasable).
- Node refuses TypeScript inside `node_modules`; never publish or import `.ts` from a package.
- Reaching the zero-dependency CommonJS tools: `createRequire(import.meta.url)` in `server/src/cjs.ts`, typed there once.
- `import.meta.dirname` is the module's folder (Node ≥ 20.11).

Check: `npx --prefix server tsc -p server/tsconfig.json` must print nothing and exit 0; `server/test/typecheck.test.ts` runs it inside the suite.
Tests: `node --test --test-concurrency=1 "server/test/*.test.ts"` — one file at a time, because job tests spawn processes and git.
```

`.claude/skills/joserah-hono-sse-routes/SKILL.md`:

```markdown
---
name: joserah-hono-sse-routes
description: Use when adding or changing a route, middleware or the event stream of the Joserah server, or when a route test behaves differently from the browser.
---

# Hono routes and server-sent events in the Joserah server

- The app is `new Hono<Env>()` with `Env = { Bindings: HttpBindings; Variables: {...} }` (`import type { HttpBindings } from '@hono/node-server'`); the client address is `c.env.incoming.socket.remoteAddress`, never a header.
- Each route module exports `register(app: App, deps: AppDeps): void`; `createApp(deps)` in `server/src/app.ts` fixes the order: security headers → auth guard → Origin check → routes → not-found.
- Test routes with `app.request(path, init, env)` — no socket. Pass `env = { incoming: { socket: { remoteAddress: '10.0.0.9' } } }` when the code reads the address.
- Every state-changing method (POST, PUT, PATCH, DELETE) needs an `Origin` equal to the server's own origin; tests send `Origin: http://127.0.0.1:4747`.
- An unknown `/api/...` path answers `404` JSON `{"error":"not-found"}`, never the HTML page; `/api/devices/*` answers `501`.
- SSE: `import { streamSSE } from 'hono/streaming'`; each event `stream.writeSSE({ id: String(n), data: JSON.stringify(e) })`; the browser's `EventSource` resends the last id as the `Last-Event-ID` header — replay from the bus ring buffer after it; an id older than the buffer gets `{type:"reset"}`. A comment line every 25 s keeps proxies from closing the stream. `stream.onAbort` unsubscribes.
- Reading an SSE response in a test: take `res.body.getReader()`, read until the expected `data:` line, then `reader.cancel()`.
```

`.claude/skills/joserah-claude-cli-driver/SKILL.md`:

```markdown
---
name: joserah-claude-cli-driver
description: Use when changing how the Joserah server starts, reads, limits or cancels a Claude Code job, or when a job hangs, mis-parses its stream, or writes where it should not.
---

# Driving the claude CLI from the server

Verified on Claude Code 2.1.289 (2026-10-06).

- Start: `claude -p --output-format stream-json --verbose --model <m> --max-budget-usd <usd> --permission-prompts none ...`, spawned **without a shell**, `windowsHide: true`, `detached: true` (own process group). The prompt goes on **stdin** as UTF-8 and stdin is closed; never put it on the command line (quotes, newlines, Turkish).
- Restricted job types (ingest, query, lint): `--restricted --strict-mcp-config --permission-mode dontAsk --tools Read,Grep,Glob[,Edit,Write]`, and when they may write, `--allowedTools "Edit(<area>/**)" "Write(<area>/**)"` **last** (the option takes several values). `dontAsk` denies anything not allowed; an allowed write inside the area lands, one outside is denied.
- General jobs: `--permission-mode acceptEdits --permission-prompts none`; the workspace's own settings decide the rest.
- Stream lines (JSON, one per line): `system/init` (`session_id`, `tools`, `model`, `claude_code_version`), `assistant` (`message.content[]` of `text` / `tool_use` / `thinking`), `user` (`tool_result`), `system/permission_denied` (`tool_name`), `result` (`subtype` `success` | `error_max_budget_usd` | ..., `is_error`, `result`, `total_cost_usd`, `num_turns`, `permission_denials[]`). The `result` line is not always last. Unknown types and bad lines are kept as `other`/`bad-line`, never thrown.
- A denial ends the job as `needs-approval`; never widen permissions silently.
- Turn limit: the server counts tool round-trips (`user` lines carrying a `tool_result`) and cancels past the limit; the CLI has no turn flag.
- Cancel by **process tree**: Windows `taskkill /PID <pid> /T /F`; elsewhere `process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after 3 s. Never kill by image name.
- Child environment is an allowlist (`jobEnv()`); no `JOSERAH_*` server variable, nothing secret-named except `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`.
- Logs pass through `redact()` from `hooks/lib/redactions.js` — which also masks the 36-character `session_id`. Take `session_id` from the raw event **before** redacting the line.
- Tests use `server/test/fixtures/fake-claude.mjs`, never the real CLI.
```

`.claude/skills/joserah-auth-and-secrets/SKILL.md`:

```markdown
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
```

`.claude/skills/joserah-docker-native-parity/SKILL.md`:

```markdown
---
name: joserah-docker-native-parity
description: Use when changing the Joserah server's Dockerfile, compose files, start-up paths or anything that must behave the same natively on Windows and inside the Linux container.
---

# One code base, two install modes

- Image `node:24-slim`, user `joserah` (uid 10001), git, curl, Claude Code by its official native installer pinned to one version (`curl -fsSL https://claude.ai/install.sh | bash -s <version>`), `DISABLE_AUTOUPDATER=1` (the image is the version).
- Volumes: `/workspace` (the workspace), `/home/joserah/.claude` (`CLAUDE_CONFIG_DIR`, the Claude Code login), `/home/joserah/state` (`JOSERAH_STATE_DIR`, server secrets). Nothing is shared from the host.
- `JOSERAH_IN_DOCKER=1` makes the server bind `0.0.0.0` inside the container; what the host sees is decided by compose: `127.0.0.1:4747:4747` by default.
- The terminal door: `docker exec -it -w /workspace joserah claude`; the image's `claude` wrapper adds `--plugin-dir /opt/joserah` so jobs and the terminal both load the plugin.
- Paths: build them with `path.join`, compare workspace-relative paths with `/` separators; never hard-code `C:/` or `/home`.
- Line endings: `.gitattributes` forces `eol=lf` for `.ts`, `.mjs`, `.sh` and the Dockerfile, so a Windows checkout builds the same image.
- Native mode (`node server/main.ts --workspace <dir>`, wrapped as `joserah serve`) prints its URL and opens no window.
- File change detection never relies on inotify (it does not fire across the Windows boundary): the Store emits its own events and polls mtimes every 2 s.
- One heavy thing at a time: one `docker build`, never beside a browser test or a second build.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dev-skills.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the existing suite**

Run: `node --test tests/*.test.js 2>&1 | tail -5`
Expected: `# fail 0` (889 + 5 passing).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills tests/dev-skills.test.js
git commit -m "server: five development skills for the platform server"
```

---

### Task 2: Server scaffold, configuration, health

**Files:**
- Create: `server/package.json`, `server/package-lock.json` (by npm), `server/tsconfig.json`, `server/main.ts`
- Create: `server/src/paths.ts`, `server/src/cjs.ts`, `server/src/config.ts`, `server/src/app.ts`, `server/src/deps.ts`
- Create: `server/test/helpers.ts`, `server/test/typecheck.test.ts`, `server/test/config.test.ts`, `server/test/app.test.ts`
- Modify: `.gitignore` (add `server/node_modules/`)

**Interfaces:**
- Consumes: `hooks/lib/redactions.js` (`SPECIFIC`, `redact`), `hooks/lib/daily-tracker.js` (`dailyTracker`), `hooks/lib/workspace.js` (`readConfig`), `tools/lib/theme.js` (`TOKENS_CSS`, `BASE_CSS`), `tools/lib/note-format.js` (`parseFrontmatter`, `parseClaims`, `findClaimAnomalies`, `extractWikilinks`).
- Produces:
  - `paths.ts`: `PLUGIN_ROOT: string`, `toolPath(name: string): string`, `now(): Date` (honours `JOSERAH_NOW`), `localDay(d?: Date): string` (`YYYY-MM-DD`, local), `hhmm(d?: Date): string`, `stateDir(workspace: string): string`, `rel(root: string, abs: string): string` (forward slashes).
  - `config.ts`: `JOB_TYPES` (const tuple), `type JobType`, `RESTRICTED_TYPES`, `CLAIM_TYPES_JOB`, `DEFAULT_MODELS: Record<JobType,string>`, `interface ServerConfig`, `DEFAULT_CONFIG`, `class ConfigError`, `loadServerConfig(workspace: string): ServerConfig`, `modelFor(cfg: ServerConfig, type: string): string`, `resolveListen(cfg: ServerConfig, env?: NodeJS.ProcessEnv): { hostname: string; port: number; https: { cert: string; key: string } | null; secure: boolean }`, `workspaceLang(workspace: string): 'tr' | 'en'`.
  - `app.ts`: `type Env`, `type App`, `createApp(deps: AppDeps): App`, `jsonError(c, status, error, extra?)`.
  - `deps.ts`: `interface AppDeps { workspace: string; stateDir: string; config: () => ServerConfig; baseUrl: string; health: HealthView }` and `interface HealthView { signedIn: boolean | null; lastJobOk: boolean | null }`; later tasks add fields.
  - `test/helpers.ts`: `SERVER_ROOT`, `REPO_ROOT`, `ORIGIN = 'http://127.0.0.1:4747'`, `tmpdir(t)`, `tmpWorkspace(t, opts?: { git?: boolean }): string`, `baseDeps(t, over?: Partial<AppDeps>): AppDeps`, `ADDR` (the fake socket env).

- [ ] **Step 1: Create the package and install exact versions**

```bash
mkdir -p server/src server/test/fixtures
cat > server/package.json <<'EOF'
{
  "name": "joserah-server",
  "version": "0.19.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18" },
  "bin": { "joserah": "bin/joserah.mjs" },
  "scripts": {
    "start": "node main.ts",
    "test": "node --test --test-concurrency=1 \"test/*.test.ts\"",
    "typecheck": "tsc -p tsconfig.json",
    "e2e": "node --test test/browser/answer.e2e.ts"
  }
}
EOF
npm --prefix server install --save-exact hono@4.13.13 @hono/node-server@2.1.3 marked@18.1.0
npm --prefix server install --save-dev --save-exact typescript@7.0.2 playwright@1.63.0
npm --prefix server install --save-dev "@types/node@^24"
printf 'server/node_modules/\n' >> .gitignore
```

Expected: `server/package-lock.json` exists; `npm --prefix server ls --depth=0` lists exactly the six packages.

`server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023", "dom", "dom.iterable"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["main.ts", "src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 2: Write the failing tests**

`server/test/helpers.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import type { AppDeps } from '../src/deps.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

export const SERVER_ROOT = path.resolve(import.meta.dirname, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
export const ORIGIN = 'http://127.0.0.1:4747';
export const ADDR = { incoming: { socket: { remoteAddress: '10.0.0.9' } } } as const;
process.env.JOSERAH_VAULT_DIALOG = 'off';
const HERMETIC = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-srv-config-'));
process.on('exit', () => fs.rmSync(HERMETIC, { recursive: true, force: true }));

export function tmpdir(t: TestContext): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-srv-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  return d;
}

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A scaffolded workspace (owner O, workspace w, English). With git: an initial commit. */
export function tmpWorkspace(t: TestContext, opts: { git?: boolean } = {}): string {
  const dir = path.join(tmpdir(t), 'ws');
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'scaffold.js'), '--target', dir, '--owner', 'O', '--workspace', 'w', '--language', 'en', '--role', 'r'],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC } });
  if (r.status !== 0) throw new Error(`scaffold: ${r.stderr}`);
  if (opts.git) { git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'init'); }
  return dir;
}

export function baseDeps(t: TestContext, over: Partial<AppDeps> = {}): AppDeps {
  const workspace = over.workspace ?? tmpWorkspace(t);
  const stateDir = over.stateDir ?? path.join(tmpdir(t), 'state');
  return { workspace, stateDir, config: () => DEFAULT_CONFIG, baseUrl: ORIGIN, health: { signedIn: null, lastJobOk: null }, ...over } as AppDeps;
}
```

`server/test/typecheck.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { SERVER_ROOT } from './helpers.ts';

test('tsc --noEmit is clean', () => {
  const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd: SERVER_ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
```

`server/test/config.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadServerConfig, modelFor, resolveListen, ConfigError, DEFAULT_CONFIG, JOB_TYPES } from '../src/config.ts';
import { stateDir, localDay } from '../src/paths.ts';
import { tmpdir } from './helpers.ts';

function ws(t: import('node:test').TestContext, server?: unknown): string {
  const d = tmpdir(t);
  fs.mkdirSync(path.join(d, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(d, '.joserah', 'config.json'), '{"dialogueLanguage":"Turkish"}');
  if (server !== undefined) fs.writeFileSync(path.join(d, '.joserah', 'server.json'), JSON.stringify(server));
  return d;
}

test('defaults when server.json is absent', (t) => {
  const c = loadServerConfig(ws(t));
  assert.equal(c.port, 4747);
  assert.equal(c.exposure, 'local');
  assert.equal(c.maxConcurrentJobs, 1);
  assert.equal(c.answerStartsJob, false);
  assert.equal(c.nightlyLlmLint, false);
});

test('model routing defaults and unknown types go to opus', () => {
  assert.equal(modelFor(DEFAULT_CONFIG, 'answers'), 'haiku');
  assert.equal(modelFor(DEFAULT_CONFIG, 'code'), 'sonnet');
  assert.equal(modelFor(DEFAULT_CONFIG, 'review'), 'opus');
  assert.equal(modelFor(DEFAULT_CONFIG, 'something-new'), 'opus');
  for (const j of JOB_TYPES) assert.ok(modelFor(DEFAULT_CONFIG, j));
});

test('haiku is refused for claim-touching job types', (t) => {
  assert.throws(() => loadServerConfig(ws(t, { models: { ingest: 'haiku' } })), (e: unknown) => e instanceof ConfigError && /models\.ingest/.test((e as Error).message));
  assert.throws(() => loadServerConfig(ws(t, { models: { review: 'claude-haiku-5' } })), ConfigError);
  assert.equal(loadServerConfig(ws(t, { models: { digest: 'haiku' } })).models.digest, 'haiku');
});

test('bad values name their key', (t) => {
  assert.throws(() => loadServerConfig(ws(t, { maxConcurrentJobs: 3 })), /maxConcurrentJobs/);
  assert.throws(() => loadServerConfig(ws(t, { exposure: 'everywhere' })), /exposure/);
  assert.throws(() => loadServerConfig(ws(t, { port: 'x' })), /port/);
  const bad = ws(t); fs.writeFileSync(path.join(bad, '.joserah', 'server.json'), '{oops');
  assert.throws(() => loadServerConfig(bad), /server\.json/);
});

test('exposure decides the bind address', () => {
  assert.equal(resolveListen(DEFAULT_CONFIG, {}).hostname, '127.0.0.1');
  assert.equal(resolveListen({ ...DEFAULT_CONFIG, exposure: 'tailnet', bind: '100.64.0.7' }, {}).hostname, '100.64.0.7');
  assert.throws(() => resolveListen({ ...DEFAULT_CONFIG, exposure: 'tailnet' }, {}), /bind/);
  assert.throws(() => resolveListen({ ...DEFAULT_CONFIG, exposure: 'internet' }, {}), /HTTPS/);
  const p = resolveListen({ ...DEFAULT_CONFIG, exposure: 'internet', proxy: true }, {});
  assert.equal(p.secure, true);
  assert.equal(resolveListen(DEFAULT_CONFIG, { JOSERAH_IN_DOCKER: '1' }).hostname, '0.0.0.0');
});

test('state dir is outside the workspace and stable', () => {
  const a = stateDir('/x/ws');
  assert.equal(a, stateDir('/x/ws'));
  assert.ok(!a.startsWith(path.resolve('/x/ws')));
  process.env.JOSERAH_STATE_DIR = '/tmp/s';
  assert.equal(stateDir('/x/ws'), '/tmp/s');
  delete process.env.JOSERAH_STATE_DIR;
});

test('localDay honours JOSERAH_NOW', () => {
  process.env.JOSERAH_NOW = '2026-10-06T08:00:00';
  assert.equal(localDay(), '2026-10-06');
  delete process.env.JOSERAH_NOW;
});
```

`server/test/app.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { baseDeps } from './helpers.ts';

test('healthz separates alive, signed in and last job', async (t) => {
  const app = createApp(baseDeps(t, { health: { signedIn: false, lastJobOk: null } }));
  const r = await app.request('/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { alive: true, signedIn: false, lastJobOk: null });
});

test('an unknown api path is 404 JSON, never HTML', async (t) => {
  const r = await createApp(baseDeps(t)).request('/api/nope');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await r.json(), { error: 'not-found' });
});

test('the device prefix is reserved', async (t) => {
  const r = await createApp(baseDeps(t)).request('/api/devices/abc/run', { method: 'POST' });
  assert.equal(r.status, 501);
  assert.deepEqual(await r.json(), { error: 'reserved' });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../src/config.ts`, `../src/app.ts`.

- [ ] **Step 4: Write the implementation**

`server/src/paths.ts`:

```ts
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');
export function toolPath(name: string): string { return path.join(PLUGIN_ROOT, 'tools', name); }
export function now(): Date { const s = process.env.JOSERAH_NOW; return s ? new Date(s) : new Date(); }
const pad = (n: number) => String(n).padStart(2, '0');
export function localDay(d: Date = now()): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function hhmm(d: Date = now()): string { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function stateDir(workspace: string): string {
  if (process.env.JOSERAH_STATE_DIR) return process.env.JOSERAH_STATE_DIR;
  const h = crypto.createHash('sha1').update(path.resolve(workspace)).digest('hex').slice(0, 12);
  return path.join(os.homedir(), '.joserah-server', h);
}
export function rel(root: string, abs: string): string { return path.relative(root, abs).split(path.sep).join('/'); }
```

`server/src/cjs.ts`:

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export interface Claim { type: string; text: string; subject: string; value: string | null; struck: boolean; fields: Record<string, string>; line: number }
export const redactions = require('../../hooks/lib/redactions.js') as {
  SPECIFIC: Array<[RegExp, string]>; redact(text: string): { text: string; redacted: boolean };
};
export const dailyTrackerLib = require('../../hooks/lib/daily-tracker.js') as { dailyTracker(root: string, day: string): string | null };
export const workspaceLib = require('../../hooks/lib/workspace.js') as { readConfig(root: string): Record<string, unknown> | null };
export const theme = require('../../tools/lib/theme.js') as { TOKENS_CSS: string; BASE_CSS: string };
export const noteFormat = require('../../tools/lib/note-format.js') as {
  parseFrontmatter(text: string): { data: Record<string, unknown>; body: string; hasFrontmatter: boolean; rawBlock: string | null };
  parseClaims(body: string): Claim[];
  findClaimAnomalies(body: string): Array<{ line: number; kind: string; detail?: string }>;
  extractWikilinks(text: string): string[];
};
```

(These declarations match the tools as of plan time — `parseFrontmatter` never returns null; it returns `hasFrontmatter: false` and the whole text as `body`. If a tool changes, fix the type here, never the tool.)

`server/src/config.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { workspaceLib } from './cjs.ts';

export const JOB_TYPES = ['answers', 'digest', 'bookkeeping', 'task', 'code', 'research', 'ingest', 'query', 'lint', 'plan', 'review'] as const;
export type JobType = typeof JOB_TYPES[number];
export const RESTRICTED_TYPES: readonly JobType[] = ['ingest', 'query', 'lint'];
export const CLAIM_TYPES_JOB: readonly JobType[] = ['ingest', 'query', 'lint', 'research', 'plan', 'review'];
export const DEFAULT_MODELS: Record<JobType, string> = {
  answers: 'haiku', digest: 'haiku', bookkeeping: 'haiku',
  task: 'sonnet', code: 'sonnet', research: 'sonnet', ingest: 'sonnet', query: 'sonnet', lint: 'sonnet',
  plan: 'opus', review: 'opus',
};
export type Exposure = 'local' | 'tailnet' | 'internet';
export interface ServerConfig {
  port: number; exposure: Exposure; bind: string | null; https: { cert: string; key: string } | null; proxy: boolean; publicOrigin: string | null;
  maxConcurrentJobs: 1 | 2; jobTimeoutMin: number; jobMaxTurns: number; jobBudgetUsd: number; dailyBudgetUsd: number;
  answerStartsJob: boolean; answerBatchSec: number; nightlyLlmLint: boolean; nightlyAt: string; rawLogDays: number;
  models: Record<string, string>;
}
export const DEFAULT_CONFIG: ServerConfig = {
  port: 4747, exposure: 'local', bind: null, https: null, proxy: false, publicOrigin: null,
  maxConcurrentJobs: 1, jobTimeoutMin: 30, jobMaxTurns: 60, jobBudgetUsd: 2, dailyBudgetUsd: 10,
  answerStartsJob: false, answerBatchSec: 60, nightlyLlmLint: false, nightlyAt: '03:30', rawLogDays: 30,
  models: { ...DEFAULT_MODELS },
};
export class ConfigError extends Error {}

function num(v: unknown, key: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ConfigError(`server.json: ${key} must be a number from ${min} to ${max}`);
  return v;
}

export function loadServerConfig(workspace: string): ServerConfig {
  const p = path.join(workspace, '.joserah', 'server.json');
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(p)) {
    try { raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new ConfigError(`server.json is not valid JSON: ${(e as Error).message}`); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('server.json must hold an object');
  }
  const c: ServerConfig = { ...DEFAULT_CONFIG, ...raw, models: { ...DEFAULT_MODELS, ...((raw.models as Record<string, string>) ?? {}) } } as ServerConfig;
  num(c.port, 'port', 1, 65535);
  if (!['local', 'tailnet', 'internet'].includes(c.exposure)) throw new ConfigError('server.json: exposure must be local, tailnet or internet');
  if (c.maxConcurrentJobs !== 1 && c.maxConcurrentJobs !== 2) throw new ConfigError('server.json: maxConcurrentJobs must be 1 or 2');
  num(c.jobTimeoutMin, 'jobTimeoutMin', 1, 240); num(c.jobMaxTurns, 'jobMaxTurns', 1, 500);
  num(c.jobBudgetUsd, 'jobBudgetUsd', 0.01, 100); num(c.dailyBudgetUsd, 'dailyBudgetUsd', 0.01, 1000);
  num(c.answerBatchSec, 'answerBatchSec', 5, 3600); num(c.rawLogDays, 'rawLogDays', 1, 365);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.nightlyAt)) throw new ConfigError('server.json: nightlyAt must be HH:MM');
  for (const [type, model] of Object.entries(c.models)) {
    if (typeof model !== 'string' || !model.trim()) throw new ConfigError(`server.json: models.${type} must be a model name`);
    if ((CLAIM_TYPES_JOB as readonly string[]).includes(type) && /haiku/i.test(model)) throw new ConfigError(`server.json: models.${type} may not be a Haiku model — ${type} jobs touch claims`);
  }
  return c;
}

export function modelFor(cfg: ServerConfig, type: string): string { return cfg.models[type] ?? 'opus'; }

export function resolveListen(cfg: ServerConfig, env: NodeJS.ProcessEnv = process.env) {
  let hostname = '127.0.0.1';
  if (cfg.exposure === 'tailnet') { if (!cfg.bind) throw new ConfigError('server.json: exposure "tailnet" needs "bind" (the tailnet address)'); hostname = cfg.bind; }
  if (cfg.exposure === 'internet') {
    if (!cfg.https && !cfg.proxy) throw new ConfigError('server.json: exposure "internet" refuses to start without HTTPS — give "https": {"cert","key"} or declare "proxy": true');
    hostname = cfg.proxy ? '127.0.0.1' : (cfg.bind ?? '0.0.0.0');
  }
  if (env.JOSERAH_IN_DOCKER === '1') hostname = '0.0.0.0';
  return { hostname, port: cfg.port, https: cfg.https, secure: !!cfg.https || cfg.proxy };
}

export function workspaceLang(workspace: string): 'tr' | 'en' {
  const l = String(workspaceLib.readConfig(workspace)?.dialogueLanguage ?? '');
  return /^(tr|turk)/i.test(l) ? 'tr' : 'en';
}
```

`server/src/deps.ts`:

```ts
import type { ServerConfig } from './config.ts';
export interface HealthView { signedIn: boolean | null; lastJobOk: boolean | null }
export interface AppDeps {
  workspace: string;
  stateDir: string;
  config: () => ServerConfig;
  baseUrl: string;
  health: HealthView;
}
```

`server/src/app.ts`:

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HttpBindings } from '@hono/node-server';
import type { AppDeps } from './deps.ts';

export type Env = { Bindings: HttpBindings; Variables: { signedIn: boolean } };
export type App = Hono<Env>;

export function jsonError(c: Context, status: ContentfulStatusCode, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, ...extra }, status);
}

export function createApp(deps: AppDeps): App {
  const app: App = new Hono<Env>();
  app.get('/healthz', (c) => c.json({ alive: true, signedIn: deps.health.signedIn, lastJobOk: deps.health.lastJobOk }));
  app.all('/api/devices', (c) => jsonError(c, 501, 'reserved'));
  app.all('/api/devices/*', (c) => jsonError(c, 501, 'reserved'));
  app.notFound((c) => (c.req.path.startsWith('/api/') ? jsonError(c, 404, 'not-found') : c.html('<!doctype html><title>404</title><p>Not found.</p>', 404)));
  return app;
}
```

`server/main.ts`:

```ts
import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadServerConfig, resolveListen, ConfigError } from './src/config.ts';
import { stateDir } from './src/paths.ts';
import { createApp } from './src/app.ts';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

const workspace = path.resolve(arg('--workspace') ?? process.cwd());
let cfg;
try { cfg = loadServerConfig(workspace); } catch (e) { if (e instanceof ConfigError) { console.error(`joserah: ${e.message}`); process.exit(1); } throw e; }
if (arg('--port')) cfg = { ...cfg, port: Number(arg('--port')) };
const listen = resolveListen(cfg);
const baseUrl = `${listen.secure ? 'https' : 'http'}://${listen.hostname === '0.0.0.0' ? '127.0.0.1' : listen.hostname}:${listen.port}`;
const app = createApp({ workspace, stateDir: stateDir(workspace), config: () => cfg, baseUrl, health: { signedIn: null, lastJobOk: null } });
serve({ fetch: app.fetch, port: listen.port, hostname: listen.hostname }, () => console.log(`Joserah server: ${baseUrl}/`));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `typecheck`, `config` (7), `app` (3); `# fail 0`.

- [ ] **Step 6: Start it once**

Run: `node server/main.ts --workspace "$(mktemp -d)" --port 4799 & curl -s --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:4799/healthz; kill %1`
Expected: `Joserah server: http://127.0.0.1:4799/` then `{"alive":true,"signedIn":null,"lastJobOk":null}`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore server/package.json server/package-lock.json server/tsconfig.json server/main.ts server/src server/test
git commit -m "server: scaffold, configuration and health"
```

---

### Task 3: Store and event bus

The Store is the only writer inside the server process: atomic writes, a change event on each of its own writes, and a 2 s mtime poll for edits made elsewhere (a terminal session, a tool run by a job). The bus numbers events and keeps the last 1000 so a dropped browser can resume.

**Files:**
- Create: `server/src/events.ts`, `server/src/store.ts`
- Test: `server/test/store.test.ts`, `server/test/events.test.ts`

**Interfaces:**
- Consumes: `paths.ts` `rel`, `localDay`.
- Produces:
  - `events.ts`: `type BusEvent = { type: 'changed'; path: string } | { type: 'answers'; page: string } | { type: 'job'; id: string; event: JobEventView } | { type: 'jobs' } | { type: 'reset' }`; `type JobEventView = { kind: 'text'; text: string } | { kind: 'tool'; name: string } | { kind: 'state'; state: string } | { kind: 'result'; ok: boolean; text: string; costUsd: number | null }`; `class EventBus { publish(e: BusEvent): number; since(id: number): Array<{ id: number; event: BusEvent }> | null; subscribe(fn: (id: number, e: BusEvent) => void): () => void; lastId(): number }`.
  - `store.ts`: `class OutsideWorkspace extends Error`; `class Store { constructor(root: string, bus: EventBus, opts?: { pollMs?: number; pollDirs?: () => string[] }); readonly root: string; abs(relPath: string): string; read(relPath: string): string | null; readJson<T>(relPath: string): T | null; write(relPath: string, data: string | Uint8Array): void; writeJson(relPath: string, value: unknown): void; append(relPath: string, text: string): void; remove(relPath: string): void; importVerbatim(bytes: Uint8Array, relPath: string): string; pollOnce(): string[]; start(): void; stop(): void }` — `importVerbatim` refuses anything outside `imports/` and never overwrites (returns the path actually used, adding ` (2)`, ` (3)` before the extension); `pollOnce` returns the workspace-relative paths it found changed and publishes them.
  - Event mapping (used by the shim in Task 6): a path `.joserah/desk/artifacts/<day>/<folder>/answers.json` publishes `{type:'answers', page:'<day>/<folder>'}`; every other path publishes `{type:'changed', path}`.

- [ ] **Step 1: Write the failing tests**

`server/test/events.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/events.ts';

test('ids increase and since() replays after an id', () => {
  const b = new EventBus(3);
  const seen: number[] = [];
  const off = b.subscribe((id) => seen.push(id));
  b.publish({ type: 'jobs' }); b.publish({ type: 'jobs' }); b.publish({ type: 'jobs' });
  off(); b.publish({ type: 'jobs' });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(b.since(2)!.map((x) => x.id), [3, 4]);
  assert.deepEqual(b.since(4), []);
});

test('an id older than the ring buffer returns null (the page must reset)', () => {
  const b = new EventBus(2);
  for (let i = 0; i < 5; i++) b.publish({ type: 'jobs' });
  assert.equal(b.since(1), null);
  assert.equal(b.lastId(), 5);
});
```

`server/test/store.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, OutsideWorkspace } from '../src/store.ts';
import { EventBus, type BusEvent } from '../src/events.ts';
import { tmpdir } from './helpers.ts';

function setup(t: import('node:test').TestContext) {
  const root = tmpdir(t);
  const bus = new EventBus();
  const events: BusEvent[] = [];
  bus.subscribe((_id, e) => events.push(e));
  const store = new Store(root, bus, { pollDirs: () => ['.joserah/desk/artifacts', '.joserah/knowledge'] });
  return { root, bus, store, events };
}

test('write is atomic, creates folders and emits one change', (t) => {
  const { root, store, events } = setup(t);
  store.writeJson('.joserah/desk/artifacts/2026-10-06/x/rows.json', { rows: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.joserah/desk/artifacts/2026-10-06/x/rows.json'), 'utf8')), { rows: [] });
  assert.deepEqual(events, [{ type: 'changed', path: '.joserah/desk/artifacts/2026-10-06/x/rows.json' }]);
  assert.deepEqual(fs.readdirSync(path.join(root, '.joserah/desk/artifacts/2026-10-06/x')), ['rows.json'], 'no temp file left');
});

test('answers.json maps to an answers event for its page', (t) => {
  const { store, events } = setup(t);
  store.write('.joserah/desk/artifacts/2026-10-06/daily-tracker/answers.json', '{}');
  assert.deepEqual(events, [{ type: 'answers', page: '2026-10-06/daily-tracker' }]);
});

test('the poll sees an outside edit once, and not the Store\'s own write', (t) => {
  const { root, store, events } = setup(t);
  store.write('.joserah/knowledge/a.md', 'a');
  store.pollOnce(); events.length = 0;
  assert.deepEqual(store.pollOnce(), [], 'own write is not reported again');
  const p = path.join(root, '.joserah/knowledge/a.md');
  fs.writeFileSync(p, 'b'); const later = new Date(Date.now() + 3000); fs.utimesSync(p, later, later);
  assert.deepEqual(store.pollOnce(), ['.joserah/knowledge/a.md']);
  assert.deepEqual(store.pollOnce(), []);
  assert.deepEqual(events, [{ type: 'changed', path: '.joserah/knowledge/a.md' }]);
});

test('the poll reports a deleted file', (t) => {
  const { root, store } = setup(t);
  store.write('.joserah/knowledge/gone.md', 'x'); store.pollOnce();
  fs.rmSync(path.join(root, '.joserah/knowledge/gone.md'));
  assert.deepEqual(store.pollOnce(), ['.joserah/knowledge/gone.md']);
});

test('paths outside the workspace are refused', (t) => {
  const { store } = setup(t);
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'C:\\x', 'a\\..\\..\\x', '']) assert.throws(() => store.abs(bad), OutsideWorkspace, bad);
});

test('importVerbatim only writes under imports/ and never overwrites', (t) => {
  const { root, store } = setup(t);
  const a = store.importVerbatim(Buffer.from('one'), 'imports/2026-10-06-upload/n.txt');
  const b = store.importVerbatim(Buffer.from('two'), 'imports/2026-10-06-upload/n.txt');
  assert.equal(a, 'imports/2026-10-06-upload/n.txt');
  assert.equal(b, 'imports/2026-10-06-upload/n (2).txt');
  assert.equal(fs.readFileSync(path.join(root, a), 'utf8'), 'one');
  assert.throws(() => store.importVerbatim(Buffer.from('x'), '.joserah/x.txt'), OutsideWorkspace);
});

test('readJson returns null for a missing or broken file', (t) => {
  const { store } = setup(t);
  assert.equal(store.readJson('nope.json'), null);
  store.write('bad.json', '{');
  assert.equal(store.readJson('bad.json'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-concurrency=1 server/test/events.test.ts server/test/store.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/events.ts`.

- [ ] **Step 3: Write the implementation**

`server/src/events.ts`:

```ts
export type JobEventView =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'state'; state: string }
  | { kind: 'result'; ok: boolean; text: string; costUsd: number | null };
export type BusEvent =
  | { type: 'changed'; path: string }
  | { type: 'answers'; page: string }
  | { type: 'job'; id: string; event: JobEventView }
  | { type: 'jobs' }
  | { type: 'reset' };

export class EventBus {
  #ring: Array<{ id: number; event: BusEvent }> = [];
  #next = 1;
  #subs = new Set<(id: number, e: BusEvent) => void>();
  #size: number;
  constructor(size = 1000) { this.#size = size; }
  publish(event: BusEvent): number {
    const id = this.#next++;
    this.#ring.push({ id, event });
    if (this.#ring.length > this.#size) this.#ring.shift();
    for (const fn of this.#subs) { try { fn(id, event); } catch { /* a broken subscriber never stops the others */ } }
    return id;
  }
  since(id: number): Array<{ id: number; event: BusEvent }> | null {
    if (id >= this.#next - 1) return [];
    const first = this.#ring[0]?.id ?? this.#next;
    if (id + 1 < first) return null;
    return this.#ring.filter((x) => x.id > id);
  }
  subscribe(fn: (id: number, e: BusEvent) => void): () => void { this.#subs.add(fn); return () => this.#subs.delete(fn); }
  lastId(): number { return this.#next - 1; }
}
```

`server/src/store.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { EventBus, BusEvent } from './events.ts';
import { rel } from './paths.ts';

export class OutsideWorkspace extends Error {}
const ANSWERS_RE = /^\.joserah\/desk\/artifacts\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/answers\.json$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.lint-cache']);
const MAX_FILES = 5000;

function eventFor(p: string): BusEvent {
  const m = ANSWERS_RE.exec(p);
  return m ? { type: 'answers', page: `${m[1]}/${m[2]}` } : { type: 'changed', path: p };
}

function renameRetry(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 6 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) { fs.rmSync(from, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1)); // Windows: a reader holds the file
    }
  }
}

export class Store {
  readonly root: string;
  #bus: EventBus;
  #seen = new Map<string, number>();
  #pollMs: number;
  #pollDirs: () => string[];
  #timer: NodeJS.Timeout | null = null;

  constructor(root: string, bus: EventBus, opts: { pollMs?: number; pollDirs?: () => string[] } = {}) {
    this.root = path.resolve(root);
    this.#bus = bus;
    this.#pollMs = opts.pollMs ?? 2000;
    this.#pollDirs = opts.pollDirs ?? (() => ['.joserah/desk/artifacts', '.joserah/knowledge']);
  }

  abs(relPath: string): string {
    if (!relPath || relPath.includes('\\') || relPath.includes('\0') || path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) throw new OutsideWorkspace(relPath);
    if (relPath.split('/').some((s) => s === '..')) throw new OutsideWorkspace(relPath);
    const p = path.resolve(this.root, relPath);
    const r = path.relative(this.root, p);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new OutsideWorkspace(relPath);
    return p;
  }

  read(relPath: string): string | null { try { return fs.readFileSync(this.abs(relPath), 'utf8'); } catch (e) { if (e instanceof OutsideWorkspace) throw e; return null; } }
  readJson<T>(relPath: string): T | null { const t = this.read(relPath); if (t === null) return null; try { return JSON.parse(t.replace(/^\uFEFF/, '')) as T; } catch { return null; } }

  write(relPath: string, data: string | Uint8Array): void {
    const p = this.abs(relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, data);
    renameRetry(tmp, p);
    this.#remember(relPath);
    this.#bus.publish(eventFor(relPath));
  }
  writeJson(relPath: string, value: unknown): void { this.write(relPath, JSON.stringify(value, null, 2) + '\n'); }
  append(relPath: string, text: string): void { const p = this.abs(relPath); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, text); this.#remember(relPath); }
  remove(relPath: string): void { fs.rmSync(this.abs(relPath), { force: true }); this.#seen.delete(relPath); this.#bus.publish(eventFor(relPath)); }

  importVerbatim(bytes: Uint8Array, relPath: string): string {
    if (!relPath.startsWith('imports/')) throw new OutsideWorkspace(relPath);
    const ext = path.posix.extname(relPath); const stem = relPath.slice(0, relPath.length - ext.length);
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? relPath : `${stem} (${n})${ext}`;
      const p = this.abs(candidate);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      try { fs.writeFileSync(p, bytes, { flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
      this.#remember(candidate);
      return candidate;
    }
    throw new Error(`no free name for ${relPath}`);
  }

  #remember(relPath: string): void { try { this.#seen.set(relPath, fs.statSync(this.abs(relPath)).mtimeMs); } catch { this.#seen.delete(relPath); } }

  #walk(dir: string, out: Map<string, number>): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.size >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) this.#walk(p, out); continue; }
      if (!e.isFile() || e.name.endsWith('.tmp')) continue;
      try { out.set(rel(this.root, p), fs.statSync(p).mtimeMs); } catch { /* vanished between list and stat */ }
    }
  }

  pollOnce(): string[] {
    const now = new Map<string, number>();
    const dirs = this.#pollDirs();
    for (const d of dirs) this.#walk(path.join(this.root, d), now);
    const changed: string[] = [];
    for (const [p, m] of now) if (this.#seen.get(p) !== m) changed.push(p);
    for (const p of this.#seen.keys()) if (!now.has(p) && dirs.some((d) => p.startsWith(d + '/'))) changed.push(p);
    this.#seen = new Map([...[...this.#seen].filter(([p]) => !dirs.some((d) => p.startsWith(d + '/'))), ...now]);
    for (const p of changed) this.#bus.publish(eventFor(p));
    return changed;
  }

  start(): void { if (this.#timer) return; this.pollOnce(); this.#timer = setInterval(() => this.pollOnce(), this.#pollMs); this.#timer.unref(); }
  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
}
```

Note: the first `pollOnce()` after construction reports every existing file. `start()` calls it once before the interval and the server only starts publishing to browsers after `start()`, so open pages never see that first sweep (the bus is created before any SSE subscriber exists). The Store test above calls `pollOnce()` once to settle before measuring.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 server/test/events.test.ts server/test/store.test.ts`
Expected: PASS (2 + 7).

- [ ] **Step 5: Commit**

```bash
git add server/src/events.ts server/src/store.ts server/test/events.test.ts server/test/store.test.ts
git commit -m "server: store with atomic writes, mtime poll and numbered events"
```

---

### Task 4: Login, sessions, exposure, guard

**Files:**
- Create: `server/src/auth.ts`, `server/src/security.ts`, `server/src/layout.ts`, `server/src/routes/auth.ts`
- Modify: `server/src/deps.ts` (add `auth`, `limiter`, `secureCookies`), `server/src/app.ts` (middleware order), `server/main.ts` (load auth, refuse a broken auth file, print the setup link), `server/test/helpers.ts` (add `readyAuth`, `login`)
- Test: `server/test/auth.test.ts`, `server/test/login.test.ts`

**Interfaces:**
- Consumes: `paths.ts` `stateDir`, `now`; `cjs.ts` `theme`; `config.ts` `workspaceLang`.
- Produces:
  - `auth.ts`: `interface AuthFile { version: 1; scrypt: { salt: string; hash: string; N: number; r: number; p: number; keylen: number }; cookieKey: string; generation: number; createdAt: string }`; `class AuthFileError extends Error`; `type AuthState = { kind: 'setup' } | { kind: 'ready'; file: AuthFile }`; `loadAuth(stateDir: string): AuthState`; `writeAuth(stateDir: string, file: AuthFile): void`; `newAuthFile(password: string): AuthFile`; `verifyPassword(password: string, s: AuthFile['scrypt']): boolean`; `COOKIE = 'jsid'`; `signSession(file: AuthFile, nowMs?: number, days?: number): string`; `checkSession(file: AuthFile, value: string | undefined, nowMs?: number): boolean`; `class RateLimiter { check(addr: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number }; fail(addr: string, nowMs: number): void; success(addr: string): void }`; `originOk(reqUrl: string, origin: string | undefined, extra: (string | null)[]): boolean`; `setupToken(stateDir: string): string`; `clearSetupToken(stateDir: string): void`; `MIN_PASSWORD = 10`.
  - `AuthHolder` in `deps.ts`: `{ state: AuthState }` (mutable: the wizard switches it from setup to ready).
  - `layout.ts`: `LABELS: { tr: Record<string,string>; en: Record<string,string> }`, `shell(o: { title: string; lang: 'tr' | 'en'; body: string; head?: string; tv?: boolean }): string`, `esc(s: string): string`, `PAGE_CSS`, `TV_CSS`.
  - `security.ts`: `CSP`, `headers(): MiddlewareHandler<Env>`, `guard(deps: AppDeps): MiddlewareHandler<Env>`, `originCheck(deps: AppDeps): MiddlewareHandler<Env>`, `clientAddr(c: Context<Env>): string`, `safeNext(next: string | undefined): string`.
  - Public paths (no session): `/healthz`, `/login` (GET, POST), `/_/login.css`, `/setup` and `/api/setup/*` (Task 16 adds them; only while `auth.state.kind === 'setup'`).
  - Test helpers: `readyAuth(deps: AppDeps, password?: string): AuthFile` (writes auth.json and switches the holder), `login(app: App, password?: string): Promise<string>` (returns the `Cookie` header value).

- [ ] **Step 1: Write the failing tests**

`server/test/auth.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadAuth, writeAuth, newAuthFile, verifyPassword, signSession, checkSession, RateLimiter, originOk, AuthFileError, setupToken, clearSetupToken } from '../src/auth.ts';
import { tmpdir } from './helpers.ts';

test('a missing auth file means setup; empty, unreadable or broken stops the server', (t) => {
  const d = tmpdir(t);
  assert.deepEqual(loadAuth(d), { kind: 'setup' });
  fs.writeFileSync(path.join(d, 'auth.json'), '');
  assert.throws(() => loadAuth(d), AuthFileError);
  fs.writeFileSync(path.join(d, 'auth.json'), '{"version":1}');
  assert.throws(() => loadAuth(d), /missing fields/);
  fs.rmSync(path.join(d, 'auth.json')); fs.mkdirSync(path.join(d, 'auth.json'));
  assert.throws(() => loadAuth(d), AuthFileError, 'a directory in its place is unreadable, not missing');
});

test('scrypt round trip and a written file loads back', (t) => {
  const d = tmpdir(t);
  const f = newAuthFile('correct horse battery');
  assert.ok(verifyPassword('correct horse battery', f.scrypt));
  assert.ok(!verifyPassword('correct horse batterx', f.scrypt));
  writeAuth(d, f);
  const s = loadAuth(d);
  assert.equal(s.kind, 'ready');
  assert.equal(JSON.stringify(s), JSON.stringify({ kind: 'ready', file: f }));
});

test('session cookies expire, are tamper-proof and die with a new generation', () => {
  const f = newAuthFile('pw-0123456789');
  const v = signSession(f, 1000, 1);
  assert.ok(checkSession(f, v, 2000));
  assert.ok(!checkSession(f, v, 1000 + 86400000 + 1), 'expired');
  assert.ok(!checkSession(f, v.slice(0, -2) + 'xx', 2000), 'tampered');
  assert.ok(!checkSession({ ...f, generation: f.generation + 1 }, v, 2000), 'signed out everywhere');
  assert.ok(!checkSession(f, undefined, 2000));
});

test('rate limit: 5 a minute, then a doubling block capped at an hour', () => {
  const r = new RateLimiter();
  let t0 = 0;
  for (let i = 0; i < 5; i++) { assert.deepEqual(r.check('a', t0), { ok: true }); r.fail('a', t0); }
  assert.deepEqual(r.check('a', t0), { ok: false, retryAfterSec: 60 });
  assert.deepEqual(r.check('b', t0), { ok: true }, 'per address');
  t0 += 61000;
  for (let i = 0; i < 5; i++) r.fail('a', t0);
  assert.deepEqual(r.check('a', t0), { ok: false, retryAfterSec: 120 });
  for (let k = 0; k < 10; k++) { t0 += 4000000; for (let i = 0; i < 5; i++) r.fail('a', t0); }
  assert.deepEqual(r.check('a', t0), { ok: false, retryAfterSec: 3600 });
  r.success('a');
  assert.deepEqual(r.check('a', t0), { ok: true });
});

test('origin must match the server or the declared public origin', () => {
  assert.ok(originOk('http://127.0.0.1:4747/api/x', 'http://127.0.0.1:4747', []));
  assert.ok(!originOk('http://127.0.0.1:4747/api/x', 'http://evil.example.invalid', []));
  assert.ok(!originOk('http://127.0.0.1:4747/api/x', undefined, []));
  assert.ok(originOk('http://127.0.0.1:4747/api/x', 'https://w.example.invalid', ['https://w.example.invalid']));
});

test('setup token is created once and cleared', (t) => {
  const d = tmpdir(t);
  const a = setupToken(d);
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(setupToken(d), a);
  clearSetupToken(d);
  assert.notEqual(setupToken(d), a);
});
```

`server/test/login.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { baseDeps, readyAuth, login, ORIGIN, ADDR } from './helpers.ts';

function form(o: Record<string, string>) { return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: new URLSearchParams(o).toString() }; }

test('api 401 vs page redirect', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const app = createApp(deps);
  const api = await app.request('/api/jobs');
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'signed-out' });
  const page = await app.request('/p/tracker?x=1');
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login?next=%2Fp%2Ftracker%3Fx%3D1');
});

test('login sets a strict cookie and redirects to a safe next', async (t) => {
  const deps = baseDeps(t); readyAuth(deps, 'pw-0123456789');
  const app = createApp(deps);
  const r = await app.request('/login', form({ password: 'pw-0123456789', next: '//evil.example.invalid/x' }), ADDR);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
  const c = r.headers.get('set-cookie') ?? '';
  assert.match(c, /^jsid=/); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\//);
  assert.doesNotMatch(c, /Secure/, 'plain http on 127.0.0.1');
  const ok = await app.request('/api/nope', { headers: { cookie: c.split(';')[0] } });
  assert.equal(ok.status, 404, 'signed in: the request reaches routing');
});

test('wrong password is 401, the sixth try in a minute is 429', async (t) => {
  const deps = baseDeps(t); readyAuth(deps, 'pw-0123456789');
  const app = createApp(deps);
  for (let i = 0; i < 5; i++) assert.equal((await app.request('/login', form({ password: 'nope' }), ADDR)).status, 401);
  const r = await app.request('/login', form({ password: 'pw-0123456789' }), ADDR);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
});

test('a state-changing request without our Origin is refused', async (t) => {
  const deps = baseDeps(t); readyAuth(deps);
  const app = createApp(deps);
  const cookie = await login(app);
  const r = await app.request('/api/anything', { method: 'POST', headers: { cookie, origin: 'http://evil.example.invalid' } });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'origin' });
});

test('security headers are on every response', async (t) => {
  const r = await createApp(baseDeps(t)).request('/healthz');
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('setup mode sends pages to /setup', async (t) => {
  const r = await createApp(baseDeps(t)).request('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/setup');
});
```

Add to `server/test/helpers.ts`:

```ts
import { newAuthFile, writeAuth, type AuthFile } from '../src/auth.ts';
import type { App } from '../src/app.ts';

export function readyAuth(deps: AppDeps, password = 'pw-0123456789'): AuthFile {
  const f = newAuthFile(password);
  writeAuth(deps.stateDir, f);
  deps.auth.state = { kind: 'ready', file: f };
  return f;
}

export async function login(app: App, password = 'pw-0123456789'): Promise<string> {
  const r = await app.request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: new URLSearchParams({ password }).toString() }, ADDR);
  if (r.status !== 303) throw new Error(`login failed: ${r.status}`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}
```

and in `baseDeps` add `auth: { state: { kind: 'setup' } }, limiter: new RateLimiter(), secureCookies: false` to the defaults (import `RateLimiter`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-concurrency=1 server/test/auth.test.ts server/test/login.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/auth.ts`.

- [ ] **Step 3: Write the implementation**

`server/src/auth.ts`:

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AuthFile { version: 1; scrypt: { salt: string; hash: string; N: number; r: number; p: number; keylen: number }; cookieKey: string; generation: number; createdAt: string }
export class AuthFileError extends Error {}
export type AuthState = { kind: 'setup' } | { kind: 'ready'; file: AuthFile };
export const COOKIE = 'jsid';
export const MIN_PASSWORD = 10;
const P = { N: 16384, r: 8, p: 1, keylen: 64 };

export function loadAuth(stateDir: string): AuthState {
  const p = path.join(stateDir, 'auth.json');
  let text: string;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'setup' };
    throw new AuthFileError(`cannot read ${p}: ${(e as Error).message}`);
  }
  if (!text.trim()) throw new AuthFileError(`${p} is empty — restore it or delete it to run setup again`);
  let j: AuthFile;
  try { j = JSON.parse(text); } catch { throw new AuthFileError(`${p} is not valid JSON`); }
  if (j?.version !== 1 || !j.scrypt?.salt || !j.scrypt?.hash || typeof j.cookieKey !== 'string' || j.cookieKey.length < 32 || typeof j.generation !== 'number') throw new AuthFileError(`${p} is missing fields`);
  return { kind: 'ready', file: j };
}

export function writeAuth(stateDir: string, file: AuthFile): void {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const p = path.join(stateDir, 'auth.json'); const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
}

function scrypt(pw: string, salt: Buffer, s: { N: number; r: number; p: number; keylen: number }): Buffer {
  return crypto.scryptSync(pw.normalize('NFC'), salt, s.keylen, { N: s.N, r: s.r, p: s.p, maxmem: 64 * 1024 * 1024 });
}
export function newAuthFile(password: string, generation = 1): AuthFile {
  const salt = crypto.randomBytes(16);
  return { version: 1, scrypt: { salt: salt.toString('base64'), hash: scrypt(password, salt, P).toString('base64'), ...P }, cookieKey: crypto.randomBytes(32).toString('hex'), generation, createdAt: new Date().toISOString() };
}
export function verifyPassword(password: string, s: AuthFile['scrypt']): boolean {
  const want = Buffer.from(s.hash, 'base64');
  const got = scrypt(password, Buffer.from(s.salt, 'base64'), s);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const mac = (key: string, body: string) => crypto.createHmac('sha256', key).update(body).digest('base64url');
export function signSession(file: AuthFile, nowMs = Date.now(), days = 30): string {
  const body = `${file.generation}.${nowMs + days * 86400000}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${body}.${mac(file.cookieKey, body)}`;
}
export function checkSession(file: AuthFile, value: string | undefined, nowMs = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const body = parts.slice(0, 3).join('.');
  const a = Buffer.from(mac(file.cookieKey, body)); const b = Buffer.from(parts[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(parts[0]) === file.generation && Number(parts[1]) > nowMs;
}

export class RateLimiter {
  #m = new Map<string, { hits: number[]; until: number; level: number }>();
  check(addr: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
    const e = this.#m.get(addr);
    if (e && e.until > nowMs) return { ok: false, retryAfterSec: Math.ceil((e.until - nowMs) / 1000) };
    return { ok: true };
  }
  fail(addr: string, nowMs: number): void {
    const e = this.#m.get(addr) ?? { hits: [], until: 0, level: 0 };
    e.hits = e.hits.filter((h) => nowMs - h < 60000); e.hits.push(nowMs);
    if (e.hits.length >= 5) { e.level += 1; e.until = nowMs + Math.min(60 * 2 ** (e.level - 1), 3600) * 1000; e.hits = []; }
    this.#m.set(addr, e);
  }
  success(addr: string): void { this.#m.delete(addr); }
}

export function originOk(reqUrl: string, origin: string | undefined, extra: (string | null)[]): boolean {
  if (!origin) return false;
  return origin === new URL(reqUrl).origin || extra.some((x) => !!x && x === origin);
}

export function setupToken(stateDir: string): string {
  const p = path.join(stateDir, 'setup-token');
  try { const t = fs.readFileSync(p, 'utf8').trim(); if (t) return t; } catch { /* first start */ }
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const t = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(p, t, { mode: 0o600 });
  return t;
}
export function clearSetupToken(stateDir: string): void { fs.rmSync(path.join(stateDir, 'setup-token'), { force: true }); }
```

`server/src/deps.ts` becomes:

```ts
import type { ServerConfig } from './config.ts';
import type { AuthState, RateLimiter } from './auth.ts';
export interface HealthView { signedIn: boolean | null; lastJobOk: boolean | null }
export interface AuthHolder { state: AuthState }
export interface AppDeps {
  workspace: string;
  stateDir: string;
  config: () => ServerConfig;
  baseUrl: string;
  health: HealthView;
  auth: AuthHolder;
  limiter: RateLimiter;
  secureCookies: boolean;
}
```

`server/src/layout.ts`:

```ts
import { theme } from './cjs.ts';

export function esc(s: string): string { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

export const LABELS = {
  tr: { home: 'Ana sayfa', tracker: 'Takip', wiki: 'Bilgi', jobs: 'İşler', signin: 'Giriş', password: 'Parola', signinBtn: 'Giriş yap', wrong: 'Parola yanlış.', limited: 'Çok fazla deneme. {s} sn sonra tekrar deneyin.', signout: 'Çıkış', pages: 'Sayfalar', newJob: 'Yeni iş', send: 'Gönder', cost: 'Bugün tahmini maliyet', estimate: 'tahmin', running: 'Çalışan işler', none: 'Şu an çalışan iş yok', cancel: 'Durdur', reply: 'Yanıtla', approve: 'İzin ver ve sürdür', retry: 'Yeniden dene', changed: 'Değişen dosyalar', result: 'Sonuç', disabled: 'İş verilemiyor', search: 'Ara', claims: 'Ölçüm ve kararlar', lint: 'Denetim', log: 'Günlük', fileIt: 'Sayfa olarak kaydet', ask: 'Sor', upload: 'Dosya ekle', noTracker: 'Bugün için takip sayfası yok.' },
  en: { home: 'Home', tracker: 'Tracker', wiki: 'Knowledge', jobs: 'Jobs', signin: 'Sign in', password: 'Password', signinBtn: 'Sign in', wrong: 'Wrong password.', limited: 'Too many tries. Try again in {s} s.', signout: 'Sign out', pages: 'Pages', newJob: 'New job', send: 'Send', cost: "Today's estimated cost", estimate: 'estimate', running: 'Running jobs', none: 'Nothing running right now', cancel: 'Stop', reply: 'Reply', approve: 'Allow and continue', retry: 'Retry', changed: 'Changed files', result: 'Result', disabled: 'Jobs cannot start', search: 'Search', claims: 'Measurements and decisions', lint: 'Checks', log: 'Log', fileIt: 'File it as a page', ask: 'Ask', upload: 'Add a file', noTracker: 'There is no Tracker for today.' },
} as const;
export type Lang = keyof typeof LABELS;

// Phone first: 16 px gutter, nothing wider than the screen, long words wrap (decision 9).
export const PAGE_CSS = [
  '*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);overflow-wrap:anywhere}',
  'main,header.top{max-width:960px;margin:0 auto;padding:0 16px}',
  'header.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding-top:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}',
  'header.top a{color:var(--link);text-decoration:none}',
  'img,video,iframe,table,pre{max-width:100%}pre{overflow-x:auto}table{display:block;overflow-x:auto;border-collapse:collapse}',
  'input,textarea,button,select{font:inherit;max-width:100%}textarea{width:100%}',
  'button{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;cursor:pointer}',
  '.muted{color:var(--muted)}.err{color:var(--you)}',
].join('\n');
// TV: a large read-only view, far from the screen.
export const TV_CSS = 'html{font-size:28px}body{font-size:1rem}form.ans,button.rp,.send,input,textarea{display:none!important}';

export function shell(o: { title: string; lang: Lang; body: string; head?: string; nav?: boolean }): string {
  const L = LABELS[o.lang];
  const nav = o.nav === false ? '' : `<header class="top"><a href="/">${esc(L.home)}</a><a href="/p/tracker">${esc(L.tracker)}</a><a href="/w/">${esc(L.wiki)}</a><a href="/jobs">${esc(L.jobs)}</a></header>`;
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.title)}</title><style id="theme">${theme.TOKENS_CSS}</style><style>${PAGE_CSS}</style>${o.head ?? ''}</head><body>${nav}<main>${o.body}</main></body></html>`;
}
```

`server/src/security.ts`:

```ts
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './app.ts';
import type { AppDeps } from './deps.ts';
import { COOKIE, checkSession, originOk } from './auth.ts';

export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";

export function headers(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'SAMEORIGIN');
  };
}

export function clientAddr(c: Context<Env>): string { return c.env?.incoming?.socket?.remoteAddress ?? 'unknown'; }
export function safeNext(next: string | undefined): string { return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/'; }

const PUBLIC = [/^\/healthz$/, /^\/login$/, /^\/_\/login\.css$/];
const SETUP_ONLY = [/^\/setup$/, /^\/api\/setup\//, /^\/_\/setup\.js$/];

export function guard(deps: AppDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const p = c.req.path;
    if (PUBLIC.some((r) => r.test(p))) return next();
    if (deps.auth.state.kind === 'setup') {
      if (SETUP_ONLY.some((r) => r.test(p))) return next();
      return p.startsWith('/api/') ? c.json({ error: 'setup-needed' }, 503) : c.redirect('/setup', 302);
    }
    if (checkSession(deps.auth.state.file, getCookie(c, COOKIE))) { c.set('signedIn', true); return next(); }
    if (p.startsWith('/api/') || p === '/events') return c.json({ error: 'signed-out' }, 401);
    const u = new URL(c.req.url);
    return c.redirect(`/login?next=${encodeURIComponent(u.pathname + u.search)}`, 302);
  };
}

export function originCheck(deps: AppDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    if (!originOk(c.req.url, c.req.header('origin'), [deps.config().publicOrigin, deps.baseUrl])) return c.json({ error: 'origin' }, 403);
    return next();
  };
}
```

`server/src/routes/auth.ts`:

```ts
import { setCookie, deleteCookie } from 'hono/cookie';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { COOKIE, signSession, verifyPassword } from '../auth.ts';
import { clientAddr, safeNext } from '../security.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';

export function register(app: App, deps: AppDeps): void {
  const page = (lang: 'tr' | 'en', next: string, msg = '') => {
    const L = LABELS[lang];
    return shell({ title: L.signin, lang, nav: false, body: `<h1>${esc(L.signin)}</h1>${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ''}<form method="post" action="/login"><input type="hidden" name="next" value="${esc(next)}"><label>${esc(L.password)}<br><input type="password" name="password" autocomplete="current-password" required autofocus></label><p><button>${esc(L.signinBtn)}</button></p></form>` });
  };
  app.get('/login', (c) => c.html(page(workspaceLang(deps.workspace), safeNext(c.req.query('next')))));
  app.post('/login', async (c) => {
    const lang = workspaceLang(deps.workspace); const L = LABELS[lang];
    if (deps.auth.state.kind !== 'ready') return c.redirect('/setup', 302);
    const addr = clientAddr(c); const t = Date.now();
    const gate = deps.limiter.check(addr, t);
    if (!gate.ok) { c.header('Retry-After', String(gate.retryAfterSec)); return c.html(page(lang, '/', L.limited.replace('{s}', String(gate.retryAfterSec))), 429); }
    const body = await c.req.parseBody();
    const next = safeNext(typeof body.next === 'string' ? body.next : undefined);
    if (typeof body.password !== 'string' || !verifyPassword(body.password, deps.auth.state.file.scrypt)) {
      deps.limiter.fail(addr, t);
      return c.html(page(lang, next, L.wrong), 401);
    }
    deps.limiter.success(addr);
    setCookie(c, COOKIE, signSession(deps.auth.state.file), { httpOnly: true, sameSite: 'Strict', path: '/', secure: deps.secureCookies, maxAge: 30 * 86400 });
    return c.redirect(next, 303);
  });
  app.post('/logout', (c) => { deleteCookie(c, COOKIE, { path: '/' }); return c.redirect('/login', 303); });
}
```

`server/src/app.ts` — `createApp` registers in this order (replace its body):

```ts
import { headers, guard, originCheck } from './security.ts';
import { register as authRoutes } from './routes/auth.ts';
// ...
export function createApp(deps: AppDeps): App {
  const app: App = new Hono<Env>();
  app.use('*', headers());
  app.get('/healthz', (c) => c.json({ alive: true, signedIn: deps.health.signedIn, lastJobOk: deps.health.lastJobOk }));
  app.all('/api/devices', (c) => jsonError(c, 501, 'reserved'));   // reserved for the device runner (decision 11): answers before the guard, does nothing
  app.all('/api/devices/*', (c) => jsonError(c, 501, 'reserved'));
  app.use('*', guard(deps));
  app.use('*', originCheck(deps));
  authRoutes(app, deps);
  app.notFound((c) => (c.req.path.startsWith('/api/') ? jsonError(c, 404, 'not-found') : c.html('<!doctype html><title>404</title><p>Not found.</p>', 404)));
  return app;
}
```

Later tasks add their `register(app, deps)` calls after `authRoutes`, before `notFound`.

`server/main.ts` — after `cfg` is known, load the auth state and build deps:

```ts
import { loadAuth, AuthFileError, setupToken, RateLimiter } from './src/auth.ts';
// ...
const sdir = stateDir(workspace);
let authState;
try { authState = loadAuth(sdir); } catch (e) { if (e instanceof AuthFileError) { console.error(`joserah: ${e.message}`); process.exit(1); } throw e; }
const deps = { workspace, stateDir: sdir, config: () => cfg, baseUrl, health: { signedIn: null, lastJobOk: null }, auth: { state: authState }, limiter: new RateLimiter(), secureCookies: listen.secure };
const app = createApp(deps);
serve({ fetch: app.fetch, port: listen.port, hostname: listen.hostname }, () => {
  console.log(`Joserah server: ${baseUrl}/`);
  if (authState.kind === 'setup') console.log(`First start — open ${baseUrl}/setup?token=${setupToken(sdir)} to set the password.`);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — all earlier tests plus `auth` (6) and `login` (6). The earlier `app.test.ts` checks still hold: `/healthz` and `/api/devices` are reached before the guard, and in setup mode an unknown `/api/` path answers `503 {"error":"setup-needed"}` — update `app.test.ts`'s 404 test to call `readyAuth(deps)` and `login(app)` first and send the cookie.

- [ ] **Step 5: Refuse a broken auth file at start**

Run: `D=$(mktemp -d); mkdir -p "$D/s"; : > "$D/s/auth.json"; JOSERAH_STATE_DIR="$D/s" node server/main.ts --workspace "$D" --port 4798; echo "exit=$?"`
Expected: `joserah: .../auth.json is empty — restore it or delete it to run setup again` and `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add server/src server/main.ts server/test
git commit -m "server: login with scrypt, strict session cookie, rate limit, origin check, exposure"
```

---

### Task 5: Pages, Markdown reports, phone width and the TV view

Pages serves what the tools already render: `index.html` in each page folder under `.joserah/desk/artifacts/<day>/<folder>/`, re-rendered first by the tool's own CLI when its source JSON is newer (a hand edit). Markdown files in a page folder are rendered inside the server's shell. `/tv` is today's Tracker, large and read-only.

**Files:**
- Create: `server/src/markdown.ts`, `server/src/pages.ts`, `server/src/routes/pages.ts`
- Modify: `server/src/app.ts` (register pages routes), `server/test/helpers.ts` (add `trackerPage`, `signedIn`)
- Test: `server/test/markdown.test.ts`, `server/test/pages.test.ts`

**Interfaces:**
- Consumes: `layout.ts` `shell`, `esc`, `LABELS`, `TV_CSS`; `paths.ts` `toolPath`, `localDay`; `cjs.ts` `dailyTrackerLib`; `config.ts` `workspaceLang`.
- Produces:
  - `markdown.ts`: `safeHref(href: string, resolve?: (h: string) => string | null): string | null`; `renderMarkdown(md: string, opts?: { resolveHref?: (h: string) => string | null }): string` — raw HTML in the source is escaped, only `http(s):`, `mailto:`, `#…` and resolved relative links survive.
  - `pages.ts`: `ARTIFACTS = '.joserah/desk/artifacts'`; `type PageKind = 'tracker' | 'trail' | 'case' | 'static'`; `interface PageInfo { day: string; folder: string; kind: PageKind; title: string; url: string; mtimeMs: number; reports: string[] }`; `pageDir(ws: string, day: string, folder: string): string | null`; `kindOf(dir: string): PageKind`; `listPages(ws: string, days?: number): PageInfo[]`; `ensureFresh(dir: string): { rendered: boolean; error?: string }`; `resolveAsset(pageDirAbs: string, sub: string): string | null`; `todayTrackerPage(ws: string): { day: string; folder: string } | null`; `preparePage(html: string, o: { page: string; mode: 'page' | 'tv' }): string` (Task 6 extends it with the shim tag).
  - Routes: `GET /p/tracker` (302 to today's Daily Tracker, or a shell page "no Tracker today"), `GET /p/:day/:folder` (302 adds the slash), `GET /p/:day/:folder/` (the page), `GET /p/:day/:folder/*` (an asset or a rendered `.md`), `GET /tv`, `GET /` (page list; Task 11 replaces it with the full home).
  - Test helpers: `trackerPage(ws: string, day: string, rows?: Array<{ title: string; state: string; small?: string }>): string` (runs `tools/tracker.js init` + `row`, returns the page dir); `signedIn(t: TestContext, over?: Partial<AppDeps>): Promise<{ app: App; deps: AppDeps; cookie: string }>`.

- [ ] **Step 1: Write the failing tests**

`server/test/markdown.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, safeHref } from '../src/markdown.ts';

test('raw html is escaped, never executed', () => {
  const h = renderMarkdown('hi <script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!h.includes('<script>'));
  assert.ok(!/<img[^>]*onerror/.test(h));
  assert.match(h, /&lt;script&gt;/);
});

test('only safe links survive', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref('//evil.example.invalid'), null);
  assert.equal(safeHref('https://example.invalid/a'), 'https://example.invalid/a');
  assert.equal(safeHref('notes.md', (h) => `/x/${h}`), '/x/notes.md');
  const h = renderMarkdown('[a](javascript:alert(1)) [b](https://example.invalid)');
  assert.ok(!h.includes('javascript:'));
  assert.match(h, /<a href="https:\/\/example\.invalid" rel="noopener noreferrer">b<\/a>/);
});

test('gfm tables and Turkish text', () => {
  const h = renderMarkdown('| a | b |\n|---|---|\n| ğüşiöç | İı |');
  assert.match(h, /<table>/);
  assert.match(h, /ğüşiöç/);
});
```

`server/test/pages.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signedIn, trackerPage } from './helpers.ts';
import { listPages } from '../src/pages.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('a page is served with its page id and a viewport', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, [{ title: 'Check the line', state: 'run' }]);
  const r = await app.request(`/p/${DAY}/daily-tracker/`, { headers: { cookie } });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Check the line/);
  assert.match(html, new RegExp(`<meta name="joserah-page" content="${DAY}/daily-tracker">`));
  assert.match(html, /<meta name="viewport"/);
});

test('/p/tracker goes to today\'s Daily Tracker', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  let r = await app.request('/p/tracker', { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /no Tracker for today/);
  trackerPage(deps.workspace, DAY);
  r = await app.request('/p/tracker', { headers: { cookie } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/p/${DAY}/daily-tracker/`);
});

test('a hand edit of rows.json is re-rendered before serving', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY, [{ title: 'First', state: 'run' }]);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8'));
  const list = Array.isArray(rows) ? rows : rows.rows;
  list.push({ title: 'Added by hand', state: 'wait' });
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(Array.isArray(rows) ? list : { ...rows, rows: list }));
  const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'rows.json'), later, later);
  const html = await (await app.request(`/p/${DAY}/daily-tracker/`, { headers: { cookie } })).text();
  assert.match(html, /Added by hand/);
});

test('markdown reports render inside the shell', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  fs.writeFileSync(path.join(dir, 'report.md'), '# Report\n\n<script>x</script>\n');
  const r = await app.request(`/p/${DAY}/daily-tracker/report.md`, { headers: { cookie } });
  const html = await r.text();
  assert.match(html, /<h1>Report<\/h1>/);
  assert.ok(!html.includes('<script>x'));
  assert.match(html, /width=device-width/);
});

test('traversal is refused', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  const secret = fs.readFileSync(path.join(deps.workspace, '.joserah', 'config.json'), 'utf8');
  fs.mkdirSync(path.join(deps.workspace, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(deps.workspace, 'keys', 'x'), 'TOPSECRET');
  for (const p of [
    '/p/../../keys/x', `/p/${DAY}/daily-tracker/../../../../keys/x`, `/p/${DAY}/daily-tracker/%2e%2e/%2e%2e/%2e%2e/%2e%2e/keys/x`,
    `/p/${DAY}/daily-tracker/..%5c..%5c..%5c..%5ckeys%5cx`, `/p/${DAY}/daily-tracker/.%2e/.%2e/.%2e/.%2e/.joserah/config.json`,
    `/p/..%2f..%2fkeys/x/`, `/p/${DAY}/..%2f..%2f..%2fkeys/x`,
  ]) {
    const r = await app.request(p, { headers: { cookie } });
    const body = await r.text();
    assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
    assert.ok(!body.includes('TOPSECRET') && !body.includes(secret.trim()), p);
  }
});

test('the TV view is the Tracker, large and without forms', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY, [{ title: 'On air', state: 'run' }]);
  const html = await (await app.request('/tv', { headers: { cookie } })).text();
  assert.match(html, /On air/);
  assert.match(html, /<meta name="joserah-mode" content="tv">/);
  assert.match(html, /html\{font-size:28px\}/);
});

test('listPages finds the kinds and the reports', (t) => {
  return signedIn(t).then(({ deps }) => {
    const dir = trackerPage(deps.workspace, DAY);
    fs.writeFileSync(path.join(dir, 'notes.md'), '# n');
    const p = listPages(deps.workspace);
    assert.equal(p.length, 1);
    assert.equal(p[0].kind, 'tracker');
    assert.deepEqual(p[0].reports, ['notes.md']);
    assert.equal(p[0].url, `/p/${DAY}/daily-tracker/`);
  });
});
```

Add to `server/test/helpers.ts`:

```ts
import { createApp, type App } from '../src/app.ts';

export function trackerPage(ws: string, day: string, rows: Array<{ title: string; state: string; small?: string }> = []): string {
  const dir = path.join(ws, '.joserah', 'desk', 'artifacts', day, 'daily-tracker');
  const tool = path.join(REPO_ROOT, 'tools', 'tracker.js');
  const run = (args: string[]) => { const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
  run(['init', dir, '--title', 'Daily Tracker', '--lang', 'en']);
  for (const r of rows) run(['row', dir, '--title', r.title, '--state', r.state, ...(r.small ? ['--small', r.small] : [])]);
  return dir;
}

export async function signedIn(t: TestContext, over: Partial<AppDeps> = {}): Promise<{ app: App; deps: AppDeps; cookie: string }> {
  const deps = baseDeps(t, over);
  readyAuth(deps);
  const app = createApp(deps);
  return { app, deps, cookie: await login(app) };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-concurrency=1 server/test/markdown.test.ts server/test/pages.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/markdown.ts`.

- [ ] **Step 3: Write the implementation**

`server/src/markdown.ts`:

```ts
import { Marked, type RendererObject } from 'marked';
import { esc } from './layout.ts';

export function safeHref(href: string, resolve?: (h: string) => string | null): string | null {
  const h = String(href ?? '').trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (!h || h.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  if (h.startsWith('#')) return h;
  return resolve ? resolve(h) : h;
}

export function renderMarkdown(md: string, opts: { resolveHref?: (h: string) => string | null } = {}): string {
  const renderer: RendererObject = {
    html(token) { return esc(token.text); },
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href, opts.resolveHref);
      return href ? `<a href="${esc(href)}"${/^https?:/i.test(href) ? ' rel="noopener noreferrer"' : ''}>${inner}</a>` : inner;
    },
    image(token) {
      const src = safeHref(token.href, opts.resolveHref);
      return src && !/^mailto:/i.test(src) ? `<img src="${esc(src)}" alt="${esc(token.text)}" loading="lazy">` : esc(token.text);
    },
  };
  const m = new Marked({ gfm: true, async: false, renderer });
  return m.parse(md) as string;
}
```

`server/src/pages.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { toolPath, localDay } from './paths.ts';
import { dailyTrackerLib } from './cjs.ts';
import { TV_CSS } from './layout.ts';

export const ARTIFACTS = '.joserah/desk/artifacts';
export type PageKind = 'tracker' | 'trail' | 'case' | 'static';
export interface PageInfo { day: string; folder: string; kind: PageKind; title: string; url: string; mtimeMs: number; reports: string[] }
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SEG_RE = /^[^\\/:*?"<>|\0]{1,160}$/;
const SOURCES: Record<Exclude<PageKind, 'static'>, { file: string; args: (d: string) => string[] }> = {
  tracker: { file: 'rows.json', args: (d) => [toolPath('tracker.js'), d] },
  trail: { file: 'trail.json', args: (d) => [toolPath('trail.js'), 'render', d] },
  case: { file: 'cases.json', args: (d) => [toolPath('case.js'), 'render', d] },
};

function within(base: string, p: string): string | null {
  let real: string, root: string;
  try { real = fs.realpathSync(p); root = fs.realpathSync(base); } catch { return null; }
  const r = path.relative(root, real);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? real : null;
}

export function pageDir(ws: string, day: string, folder: string): string | null {
  if (!DAY_RE.test(day) || !FOLDER_RE.test(folder) || folder.includes('..')) return null;
  const d = within(path.join(ws, ARTIFACTS), path.join(ws, ARTIFACTS, day, folder));
  return d && fs.existsSync(path.join(d, 'index.html')) ? d : null;
}

export function kindOf(dir: string): PageKind {
  for (const k of ['tracker', 'trail', 'case'] as const) if (fs.existsSync(path.join(dir, SOURCES[k].file))) return k;
  return 'static';
}

function titleOf(file: string): string {
  try { const m = /<title>([^<]*)<\/title>/i.exec(fs.readFileSync(file, 'utf8')); return m ? m[1].trim() : path.basename(path.dirname(file)); } catch { return path.basename(path.dirname(file)); }
}

export function listPages(ws: string, days = 14): PageInfo[] {
  const base = path.join(ws, ARTIFACTS);
  let dayDirs: string[] = [];
  try { dayDirs = fs.readdirSync(base).filter((d) => DAY_RE.test(d)).sort().reverse().slice(0, days); } catch { return []; }
  const out: PageInfo[] = [];
  for (const day of dayDirs) {
    let folders: string[] = [];
    try { folders = fs.readdirSync(path.join(base, day), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { continue; }
    for (const folder of folders) {
      const dir = pageDir(ws, day, folder);
      if (!dir) continue;
      const index = path.join(dir, 'index.html');
      out.push({ day, folder, kind: kindOf(dir), title: titleOf(index), url: `/p/${day}/${folder}/`, mtimeMs: fs.statSync(index).mtimeMs,
        reports: fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'tracker.md').sort() });
    }
  }
  return out;
}

export function ensureFresh(dir: string): { rendered: boolean; error?: string } {
  const kind = kindOf(dir);
  if (kind === 'static') return { rendered: false };
  const src = path.join(dir, SOURCES[kind].file); const index = path.join(dir, 'index.html');
  try { if (fs.statSync(src).mtimeMs <= fs.statSync(index).mtimeMs) return { rendered: false }; } catch { return { rendered: false }; }
  const r = spawnSync(process.execPath, SOURCES[kind].args(dir), { encoding: 'utf8', timeout: 20000, windowsHide: true });
  return r.status === 0 ? { rendered: true } : { rendered: false, error: (r.stderr || r.stdout || '').trim().split('\n')[0] };
}

export function resolveAsset(pageDirAbs: string, sub: string): string | null {
  const segs = sub.split('/');
  if (!segs.length || segs.some((s) => !SEG_RE.test(s) || s === '.' || s === '..' || s.startsWith('.'))) return null;
  const p = within(pageDirAbs, path.join(pageDirAbs, ...segs));
  return p && fs.statSync(p).isFile() ? p : null;
}

export function todayTrackerPage(ws: string): { day: string; folder: string } | null {
  const day = localDay();
  const d = dailyTrackerLib.dailyTracker(ws, day);
  return d ? { day, folder: path.basename(d) } : null;
}

export function preparePage(html: string, o: { page: string; mode: 'page' | 'tv' }): string {
  let head = `<meta name="joserah-page" content="${o.page}"><meta name="joserah-mode" content="${o.mode}">`;
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) head = '<meta name="viewport" content="width=device-width, initial-scale=1">' + head;
  if (o.mode === 'tv') head += `<style id="tv">${TV_CSS}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
}
```

`server/src/routes/pages.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Context } from 'hono';
import type { App, Env } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { pageDir, ensureFresh, resolveAsset, todayTrackerPage, preparePage, listPages } from '../pages.ts';
import { renderMarkdown } from '../markdown.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

export function serveIndex(dir: string, page: string, mode: 'page' | 'tv'): string {
  ensureFresh(dir);
  return preparePage(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), { page, mode });
}

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  app.get('/', (c) => {
    const L = LABELS[lang()];
    const items = listPages(deps.workspace).map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> <span class="muted">${esc(p.day)} · ${esc(p.kind)}</span>${p.reports.map((r) => ` · <a href="${esc(p.url + encodeURIComponent(r))}">${esc(r)}</a>`).join('')}</li>`).join('');
    return c.html(shell({ title: 'Joserah', lang: lang(), body: `<h1>${esc(L.pages)}</h1><ul>${items}</ul>` }));
  });
  app.get('/p/tracker', (c) => {
    const t = todayTrackerPage(deps.workspace);
    if (t) return c.redirect(`/p/${t.day}/${t.folder}/`, 302);
    return c.html(shell({ title: LABELS[lang()].tracker, lang: lang(), body: `<p>${esc(LABELS[lang()].noTracker)}</p>` }));
  });
  app.get('/tv', (c) => {
    const t = todayTrackerPage(deps.workspace);
    const dir = t && pageDir(deps.workspace, t.day, t.folder);
    if (!t || !dir) return c.html(shell({ title: 'TV', lang: lang(), nav: false, head: '<meta http-equiv="refresh" content="60">', body: `<p>${esc(LABELS[lang()].noTracker)}</p>` }));
    return c.html(serveIndex(dir, `${t.day}/${t.folder}`, 'tv'));
  });
  app.get('/p/:day/:folder', (c) => c.redirect(`/p/${c.req.param('day')}/${c.req.param('folder')}/`, 302));
  const inPage = (c: Context<Env>) => {
    const { day, folder } = c.req.param();
    const dir = pageDir(deps.workspace, day, folder);
    if (!dir) return c.notFound();
    const prefix = `/p/${day}/${folder}/`;
    let sub: string;
    try { sub = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length)); } catch { return c.notFound(); }
    if (sub === '' || sub === 'index.html') return c.html(serveIndex(dir, `${day}/${folder}`, 'page'));
    const file = resolveAsset(dir, sub);
    if (!file) return c.notFound();
    if (file.endsWith('.md')) {
      const html = renderMarkdown(fs.readFileSync(file, 'utf8'), { resolveHref: (h) => (h.includes('..') ? null : prefix + h) });
      return c.html(shell({ title: path.basename(file), lang: lang(), body: html }));
    }
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return c.body(fs.readFileSync(file), 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' });
    return c.body(fs.readFileSync(file), 200, { 'Content-Type': type });
  };
  app.get('/p/:day/:folder/', inPage);   // explicit: Hono is strict about the trailing slash
  app.get('/p/:day/:folder/*', inPage);
}
```

Register it in `createApp` after `authRoutes(app, deps)`: `pagesRoutes(app, deps);` (import `{ register as pagesRoutes } from './routes/pages.ts'`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `markdown` (3), `pages` (7) and every earlier test.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test
git commit -m "server: pages from the tools, markdown reports, TV view, traversal guard"
```

---

### Task 6: Answers, the artifact shim and the event stream

The page scripts written for the artifact runtime run unchanged: the shim gives them `window.claude.use("db")` (the `answers` collection over HTTP + SSE) and `window.claude.hot` (a snapshot carried across a reload). Answers are merged by document id and owner, under a lock both the server and the terminal take, so neither writer loses or overwrites the other (§8, B5).

**Files:**
- Create: `tools/lib/answers.js`, `tests/answers.test.js`
- Create: `server/src/shim.ts`, `server/src/routes/db.ts`, `server/src/routes/events.ts`
- Modify: `server/src/cjs.ts` (add `answersLib`), `server/src/store.ts` (add `putAnswer`), `server/src/deps.ts` (add `store`, `bus`), `server/src/pages.ts` (`preparePage` adds the shim tag), `server/src/app.ts` (register), `server/main.ts` (create bus and store, `store.start()`), `server/test/helpers.ts` (`baseDeps` builds a bus and a store)
- Test: `server/test/db.test.ts`, `server/test/sse.test.ts`, `server/test/shim.test.ts`

**Interfaces:**
- Consumes: `Store`, `EventBus` (Task 3); `pageDir`, `preparePage` (Task 5).
- Produces:
  - `tools/lib/answers.js` (CommonJS, no dependencies): `FILE = 'answers.json'`; `ID_RE`; `isReplyId(id)`; `read(dir) → { version: 1, docs: { [id]: Doc } }`; `put(dir, id, doc, author: 'owner' | 'assistant') → { ok: true, doc } | { ok: false, code: 'bad-id' | 'bad-doc' | 'not-yours' }`; `list(dir, { onlyNew }) → Array<{ id, ...Doc }>` (oldest first); `markRead(dir, id) → { ok, doc } | { ok: false, code: 'not-found' | 'not-yours' }`; `reply(dir, baseId, note, nowMs?) → { ok, id, doc }`; `newCounts(workspace, days?) → Array<{ page: 'YYYY-MM-DD/folder', dir, count }>`; `withLock(dir, fn)`. Doc fields: `row, key, label, note, at` (strings), `state` (`new` | `read` | `reply`), `from` (`"assistant"` on replies only).
  - `Store.putAnswer(page: string, id: string, doc: unknown): { ok: true; doc: Record<string, unknown> } | { ok: false; code: string }` (owner writes only).
  - `shim.ts`: `SHIM_JS: string` (served at `/_/shim.js`); `preparePage` now also inserts `<script src="/_/shim.js"></script>` right after the two meta tags, before any page script.
  - Routes: `GET /api/db/:day/:folder/answers` → `{ docs: [{ id, data }] }`; `PUT /api/db/:day/:folder/answers/:id` → `200 {ok:true}` | `400 {error:'bad-id'|'bad-doc'}` | `409 {error:'not-yours'}` | `404`; `GET /api/stamp/:day/:folder` → `{ stamp: number }`; `GET /api/me` → `{ ok: true }`; `GET /events` (SSE; `Last-Event-ID` resumes; too old → `{type:"reset"}`).

- [ ] **Step 1: Write the failing tests — the shared answers library**

`tests/answers.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { tmpdir, PLUGIN_ROOT } = require('./helpers');
const A = require('../tools/lib/answers');

test('owner put merges by field and never deletes a missing one', (t) => {
  const d = tmpdir(t);
  assert.ok(A.put(d, 'a-x-1', { row: 'X', key: 'A', label: 'one', note: 'because', at: '2026-10-06T08:00:00Z' }, 'owner').ok);
  assert.ok(A.markRead(d, 'a-x-1').ok);
  const r = A.put(d, 'a-x-1', { key: 'B', at: '2026-10-06T08:05:00Z' }, 'owner');
  assert.deepEqual(r.doc, { row: 'X', key: 'B', label: 'one', note: 'because', at: '2026-10-06T08:05:00Z', state: 'new' });
});

test('an owner write never replaces an assistant document', (t) => {
  const d = tmpdir(t);
  const rep = A.reply(d, 'a-x-1', 'Done, see the page.', Date.UTC(2026, 9, 6, 8));
  assert.ok(rep.ok);
  assert.match(rep.id, /^a-x-1--r[a-z0-9]+$/);
  assert.deepEqual(A.put(d, rep.id, { note: 'overwrite' }, 'owner'), { ok: false, code: 'not-yours' });
  assert.equal(A.read(d).docs[rep.id].note, 'Done, see the page.');
  assert.deepEqual(A.put(d, 'a-x-1', { note: 'x' }, 'assistant'), { ok: false, code: 'not-yours' });
});

test('bad ids and bad documents are refused', (t) => {
  const d = tmpdir(t);
  for (const id of ['', '../x', 'A-UPPER', 'a/b', 'x'.repeat(161)]) assert.equal(A.put(d, id, { note: 'n' }, 'owner').code, 'bad-id', id);
  assert.equal(A.put(d, 'a-1', { note: 5 }, 'owner').code, 'bad-doc');
  assert.equal(A.put(d, 'a-1', ['x'], 'owner').code, 'bad-doc');
});

test('list --new and newCounts', (t) => {
  const ws = tmpdir(t);
  const d = path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-06', 'daily-tracker');
  fs.mkdirSync(d, { recursive: true });
  A.put(d, 'a-1', { note: 'n1', at: '2026-10-06T08:00:00Z' }, 'owner');
  A.put(d, 'a-2', { note: 'n2', at: '2026-10-06T08:01:00Z' }, 'owner');
  A.markRead(d, 'a-1');
  assert.deepEqual(A.list(d, { onlyNew: true }).map((x) => x.id), ['a-2']);
  assert.deepEqual(A.newCounts(ws).map(({ page, count }) => ({ page, count })), [{ page: '2026-10-06/daily-tracker', count: 1 }]);
});

test('two writers lose nothing', async (t) => {
  const d = tmpdir(t);
  const lib = path.join(PLUGIN_ROOT, 'tools', 'lib', 'answers.js').replace(/\\/g, '/');
  const writer = (tag, author) => new Promise((resolve, reject) => {
    const code = `const A=require(${JSON.stringify(lib)});for(let i=0;i<40;i++){const r=${author === 'owner'
      ? `A.put(process.argv[1],'a-${tag}-'+i,{note:'n'+i},'owner')`
      : `A.reply(process.argv[1],'a-base-'+i,'r'+i,1700000000000+i*1000+${tag === 'r' ? 0 : 500})`};if(!r.ok)process.exit(2)}`;
    const p = spawn(process.execPath, ['-e', code, d], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`writer ${tag} exit ${c}`))));
  });
  await Promise.all([writer('o', 'owner'), writer('r', 'assistant'), writer('p', 'owner')]);
  const docs = A.read(d).docs;
  assert.equal(Object.keys(docs).length, 120);
  assert.ok(!fs.existsSync(path.join(d, 'answers.json.lock')));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/answers.test.js`
Expected: FAIL — `Cannot find module '../tools/lib/answers'`.

- [ ] **Step 3: Write `tools/lib/answers.js`**

```js
'use strict';
/**
 * answers.js (lib) — the answers a page collects, kept in answers.json beside the page's rows.json.
 * Two writers share it: the server (the owner's answers from the page) and the terminal
 * (tools/answers.js: the assistant's replies and read marks). Every write takes answers.json.lock,
 * re-reads, merges by document id and field, and replaces the file atomically, so neither writer loses
 * the other's work. An owner document never becomes the assistant's and the reverse (spec §8: "Answers
 * never overwrite"). Ids are the page's: slugId ("a-<slug>-<hash>"), a note "<id>--n<time>", a reply
 * "<id>--r<time>". No dependencies.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'answers.json';
const ID_RE = /^[a-z0-9-]{1,160}$/;
const FIELDS = ['row', 'key', 'label', 'note', 'at'];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const isReplyId = (id) => /--r[a-z0-9]+$/.test(id);

function withLock(dir, fn) {
  const lock = path.join(dir, FILE + '.lock');
  const until = Date.now() + 5000;
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`answers: ${lock} is held by another writer`);
      sleep(10 + Math.floor(Math.random() * 20));
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

function read(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    if (j && typeof j.docs === 'object' && j.docs && !Array.isArray(j.docs)) return { version: 1, docs: j.docs };
  } catch { /* missing or broken: start empty, the next write repairs it */ }
  return { version: 1, docs: {} };
}

function write(dir, store) {
  const p = path.join(dir, FILE);
  const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, p); return; } catch (e) {
      if (i >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      sleep(20 * (i + 1));
    }
  }
}

function clean(doc) {
  const out = {};
  for (const k of FIELDS) {
    if (doc[k] === undefined) continue;
    if (typeof doc[k] !== 'string') return null;
    out[k] = doc[k].slice(0, k === 'note' ? 2000 : 300);
  }
  return out;
}

function put(dir, id, doc, author) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, code: 'bad-id' };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, code: 'bad-doc' };
  const c = clean(doc);
  if (!c) return { ok: false, code: 'bad-doc' };
  if ((author === 'assistant') !== isReplyId(id)) return { ok: false, code: 'not-yours' };
  fs.mkdirSync(dir, { recursive: true });
  return withLock(dir, () => {
    const s = read(dir);
    const cur = s.docs[id];
    if (cur && (cur.from === 'assistant') !== (author === 'assistant')) return { ok: false, code: 'not-yours' };
    const next = author === 'assistant' ? { ...cur, ...c, from: 'assistant', state: 'reply' } : { ...cur, ...c, state: 'new' };
    if (!next.at) next.at = new Date().toISOString();
    s.docs[id] = next;
    write(dir, s);
    return { ok: true, doc: next };
  });
}

function list(dir, { onlyNew = false } = {}) {
  return Object.entries(read(dir).docs).map(([id, d]) => ({ id, ...d }))
    .filter((d) => !onlyNew || d.state === 'new')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));
}

function markRead(dir, id) {
  return withLock(dir, () => {
    const s = read(dir);
    const d = s.docs[id];
    if (!d) return { ok: false, code: 'not-found' };
    if (d.from === 'assistant') return { ok: false, code: 'not-yours' };
    s.docs[id] = { ...d, state: 'read' };
    write(dir, s);
    return { ok: true, doc: s.docs[id] };
  });
}

function reply(dir, baseId, note, nowMs = Date.now()) {
  const base = String(baseId).split('--')[0];
  const id = `${base}--r${nowMs.toString(36)}`;
  const row = (read(dir).docs[baseId] || read(dir).docs[base] || {}).row;
  const r = put(dir, id, { ...(row ? { row } : {}), note: String(note), at: new Date(nowMs).toISOString() }, 'assistant');
  return r.ok ? { ...r, id } : r;
}

function newCounts(workspace, days = 2) {
  const base = path.join(workspace, '.joserah', 'desk', 'artifacts');
  let dayDirs = [];
  try { dayDirs = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, days); } catch { return []; }
  const out = [];
  for (const day of dayDirs) {
    let folders = [];
    try { folders = fs.readdirSync(path.join(base, day), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { continue; }
    for (const f of folders) {
      const dir = path.join(base, day, f);
      if (!fs.existsSync(path.join(dir, FILE))) continue;
      const count = list(dir, { onlyNew: true }).length;
      if (count) out.push({ page: `${day}/${f}`, dir, count });
    }
  }
  return out;
}

module.exports = { FILE, ID_RE, isReplyId, read, put, list, markRead, reply, newCounts, withLock };
```

Run: `node --test tests/answers.test.js`
Expected: PASS (5).

- [ ] **Step 4: Write the failing server tests**

`server/test/db.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { signedIn, trackerPage, ORIGIN, REPO_ROOT } from './helpers.ts';
import type { BusEvent } from '../src/events.ts';
import { answersLib } from '../src/cjs.ts';

const DAY = '2026-10-06';
const put = (cookie: string, id: string, body: unknown) => ({ method: 'PUT', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('PUT then GET an answer, and subscribers hear it', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  const seen: BusEvent[] = []; deps.bus.subscribe((_i, e) => seen.push(e));
  const r = await app.request(`/api/db/${DAY}/daily-tracker/answers/a-x-1`, put(cookie, 'a-x-1', { row: 'X', key: 'A', note: 'yes', at: '2026-10-06T08:00:00Z', state: 'new' }));
  assert.equal(r.status, 200);
  const g = await (await app.request(`/api/db/${DAY}/daily-tracker/answers`, { headers: { cookie } })).json();
  assert.deepEqual(g.docs, [{ id: 'a-x-1', data: { row: 'X', key: 'A', note: 'yes', at: '2026-10-06T08:00:00Z', state: 'new' } }]);
  assert.deepEqual(seen.filter((e) => e.type === 'answers'), [{ type: 'answers', page: `${DAY}/daily-tracker` }]);
});

test('an owner write never replaces an assistant document (route)', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  const rep = answersLib.reply(dir, 'a-x-1', 'assistant text');
  assert.ok(rep.ok && rep.id);
  const r = await app.request(`/api/db/${DAY}/daily-tracker/answers/${rep.id}`, put(cookie, rep.id!, { note: 'mine now' }));
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'not-yours' });
});

test('bad id is 400, unknown page is 404', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  assert.equal((await app.request(`/api/db/${DAY}/daily-tracker/answers/BAD`, put(cookie, 'BAD', { note: 'x' }))).status, 400);
  assert.equal((await app.request(`/api/db/${DAY}/nope/answers/a-1`, put(cookie, 'a-1', { note: 'x' }))).status, 404);
});

test('two writers lose nothing (browser PUTs while the terminal replies)', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const dir = trackerPage(deps.workspace, DAY);
  const lib = path.join(REPO_ROOT, 'tools', 'lib', 'answers.js').replace(/\\/g, '/');
  const cli = new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', `const A=require(${JSON.stringify(lib)});for(let i=0;i<30;i++){if(!A.reply(process.argv[1],'a-b-'+i,'r',1700000000000+i).ok)process.exit(2)}`, dir], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`exit ${c}`))));
  });
  for (let i = 0; i < 30; i++) assert.equal((await app.request(`/api/db/${DAY}/daily-tracker/answers/a-o-${i}`, put(cookie, `a-o-${i}`, { note: 'n' }))).status, 200);
  await cli;
  const docs = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8')).docs;
  assert.equal(Object.keys(docs).length, 60);
});
```

`server/test/sse.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedIn } from './helpers.ts';

async function readUntil(res: Response, pred: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let text = '';
  const deadline = Date.now() + 3000;
  while (!pred(text) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  await reader.cancel();
  return text;
}

test('events stream live and resume after Last-Event-ID', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const first = deps.bus.publish({ type: 'changed', path: 'a' });
  deps.bus.publish({ type: 'changed', path: 'b' });
  const res = await app.request('/events', { headers: { cookie, 'last-event-id': String(first) } });
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const text = await readUntil(res, (s) => s.includes('"path":"b"'));
  assert.match(text, /data: {"type":"changed","path":"b"}/);
  assert.match(text, /^id: 2$/m);
  assert.ok(!text.includes('"path":"a"'));
});

test('an id older than the buffer gets a reset', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  for (let i = 0; i < 1005; i++) deps.bus.publish({ type: 'jobs' });
  const text = await readUntil(await app.request('/events', { headers: { cookie, 'last-event-id': '1' } }), (s) => s.includes('reset'));
  assert.match(text, /"type":"reset"/);
});

test('events need a session', async (t) => {
  const { app } = await signedIn(t);
  assert.equal((await app.request('/events')).status, 401);
});
```

`server/test/shim.test.ts` — runs `SHIM_JS` in a small fake browser with `node:vm`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SHIM_JS } from '../src/shim.ts';
import { preparePage } from '../src/pages.ts';

type Fetch = (url: string, init?: { method?: string; body?: string }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;
function browser(o: { page?: string; mode?: string; fetch: Fetch; session?: Record<string, string> }) {
  const appended: Array<{ id: string; text: string; href?: string }> = [];
  const store = new Map(Object.entries(o.session ?? {}));
  const el = (tag: string) => { const e: Record<string, unknown> & { children: unknown[] } = { tag, children: [], style: {}, setAttribute() {}, appendChild(c: unknown) { this.children.push(c); return c; } }; return e; };
  const document = {
    documentElement: { lang: 'en' }, readyState: 'complete',
    querySelector: (sel: string) => (sel.includes('joserah-page') && o.page ? { getAttribute: () => o.page } : sel.includes('joserah-mode') ? { getAttribute: () => o.mode ?? 'page' } : null),
    getElementById: (id: string) => appended.find((a) => a.id === id) ?? null,
    createElement: el, createTextNode: (text: string) => ({ text }),
    body: { appendChild: (b: { id: string; children: Array<{ text?: string; textContent?: string; href?: string }> }) => { appended.push({ id: b.id, text: b.children.map((c) => c.text ?? c.textContent ?? '').join(''), href: b.children.find((c) => c.href)?.href }); } },
  };
  const window: Record<string, unknown> = {
    document, location: { pathname: '/p/2026-10-06/daily-tracker/', search: '', reload() { window.reloaded = true; } },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    fetch: o.fetch, setTimeout, clearTimeout, setInterval: () => 0, Date, JSON, encodeURIComponent, Promise,
  };
  window.window = window;
  vm.runInNewContext(SHIM_JS, window);
  return { window, appended, store };
}
const res = (status: number, body: unknown = {}) => Promise.resolve({ status, ok: status < 300, json: () => Promise.resolve(body) });

test('shim: db set() PUTs to the page\'s answers', async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const { window } = browser({ page: '2026-10-06/daily-tracker', fetch: (url, init) => { calls.push({ url, ...init }); return res(200, { ok: true }); } });
  const claude = window.claude as { use(n: string): Promise<{ collection(n: string): { doc(id: string): { set(a: unknown): Promise<void> } } }> };
  const db = await claude.use('db');
  await db.collection('answers').doc('a-x-1').set({ key: 'A' });
  assert.equal(calls[0].url, '/api/db/2026-10-06/daily-tracker/answers/a-x-1');
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, '{"key":"A"}');
});

test('shim shows the signed-out banner on 401', async () => {
  const { window, appended } = browser({ page: '2026-10-06/daily-tracker', fetch: () => res(401, { error: 'signed-out' }) });
  const claude = window.claude as { use(n: string): Promise<{ collection(n: string): { doc(id: string): { set(a: unknown): Promise<void> } } }> };
  const db = await claude.use('db');
  await assert.rejects(db.collection('answers').doc('a-x-1').set({}), (e: { code: string }) => e.code === 'signed-out');
  assert.equal(appended.length, 1);
  assert.match(appended[0].text, /Signed out/);
  assert.equal(appended[0].href, '/login?next=%2Fp%2F2026-10-06%2Fdaily-tracker%2F');
});

test('shim: hot data comes back after a reload and ready() hands it over', () => {
  const saved = JSON.stringify({ state: { p: 'x' }, sig: { k: 1 } });
  const { window, store } = browser({ page: '2026-10-06/daily-tracker', fetch: () => res(200), session: { 'jh:hot:/p/2026-10-06/daily-tracker/': saved } });
  const hot = (window.claude as { hot: { data: unknown; ready(cb: (h: unknown) => void): void } }).hot;
  assert.deepEqual(hot.data, { state: { p: 'x' }, sig: { k: 1 } });
  let got: unknown = null; hot.ready((h) => { got = h; });
  assert.deepEqual(got, { state: { p: 'x' }, sig: { k: 1 } });
  assert.equal(store.size, 0, 'used once');
});

test('shim: the TV view has no database', async () => {
  const { window } = browser({ page: '2026-10-06/daily-tracker', mode: 'tv', fetch: () => res(200) });
  await assert.rejects((window.claude as { use(n: string): Promise<unknown> }).use('db'));
});

test('preparePage puts the shim before any page script', () => {
  const h = preparePage('<html><head><script>window.x=1</script></head><body></body></html>', { page: 'd/f', mode: 'page' });
  assert.ok(h.indexOf('/_/shim.js') < h.indexOf('window.x=1'));
});
```

Update `baseDeps` in `server/test/helpers.ts`: build `const bus = new EventBus(); const store = new Store(workspace, bus);` and include `bus, store` in the returned deps.

- [ ] **Step 5: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/db.test.ts server/test/sse.test.ts server/test/shim.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/shim.ts`; db and sse tests fail with 404.

- [ ] **Step 6: Write the server side**

`server/src/cjs.ts` — add:

```ts
export interface AnswerDoc { row?: string; key?: string; label?: string; note?: string; at?: string; state?: string; from?: string }
export type AnswerResult = { ok: true; doc: AnswerDoc; id?: string } | { ok: false; code: string };
export const answersLib = require('../../tools/lib/answers.js') as {
  FILE: string; ID_RE: RegExp; isReplyId(id: string): boolean;
  read(dir: string): { version: 1; docs: Record<string, AnswerDoc> };
  put(dir: string, id: string, doc: unknown, author: 'owner' | 'assistant'): AnswerResult;
  list(dir: string, o?: { onlyNew?: boolean }): Array<AnswerDoc & { id: string }>;
  markRead(dir: string, id: string): AnswerResult;
  reply(dir: string, baseId: string, note: string, nowMs?: number): AnswerResult;
  newCounts(workspace: string, days?: number): Array<{ page: string; dir: string; count: number }>;
};
```

`server/src/store.ts` — add the method (import `answersLib` from `./cjs.ts`):

```ts
  putAnswer(page: string, id: string, doc: unknown) {
    const relFile = `.joserah/desk/artifacts/${page}/answers.json`;
    const dir = path.dirname(this.abs(relFile));
    const r = answersLib.put(dir, id, doc, 'owner');
    if (r.ok) { this.#remember(relFile); this.#bus.publish({ type: 'answers', page }); }
    return r;
  }
```

`server/src/deps.ts` — add `store: Store; bus: EventBus;` (type imports).

`server/src/shim.ts`:

```ts
// The artifact runtime's window.claude, served by this server (spec §1 part 3). ES5 on purpose: TVs and
// old phones run it. Page scripts (tracker.js STATE_JS, ANSWER_JS, MOTION_JS) call use("db") and hot.*.
export const SHIM_JS = `(function(){
var W=window,D=W.document,m=D.querySelector('meta[name="joserah-page"]'),page=m?m.getAttribute('content'):'';
var mm=D.querySelector('meta[name="joserah-mode"]'),mode=mm?mm.getAttribute('content'):'page';
var tr=String(D.documentElement.lang||'').slice(0,2)==='tr',KEY='jh:hot:'+W.location.pathname,data={},snaps=[],listeners=[];
try{var s=W.sessionStorage.getItem(KEY);if(s){data=JSON.parse(s)||{};W.sessionStorage.removeItem(KEY)}}catch(e){}
function banner(){if(D.getElementById('jh-out'))return;var b=D.createElement('div');b.id='jh-out';b.setAttribute('role','alert');
b.style.cssText='position:fixed;left:0;right:0;top:0;z-index:99;padding:12px 16px;background:#fff3cd;color:#111;font:16px/1.4 system-ui,sans-serif;border-bottom:1px solid #111';
b.appendChild(D.createTextNode(tr?'Oturum kapandı — ':'Signed out — '));var a=D.createElement('a');a.href='/login?next='+encodeURIComponent(W.location.pathname+W.location.search);
a.textContent=tr?'yeniden giriş yapın':'sign in again';b.appendChild(a);(D.body||D.documentElement).appendChild(b)}
function api(method,url,body){return W.fetch(url,{method:method,credentials:'same-origin',headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined})
.then(function(r){if(r.status===401){banner();throw{code:'signed-out'}}if(r.status===409)throw{code:'conflict'};if(r.status===400)throw{code:'invalid_argument'};if(!r.ok)throw{code:'http-'+r.status};return r.json()})}
function snapshot(){return api('GET','/api/db/'+page+'/answers').then(function(j){var docs=[];var l=(j&&j.docs)||[];for(var i=0;i<l.length;i++)(function(d){docs.push({id:d.id,exists:true,data:function(){return d.data}})})(l[i]);return{docs:docs}})}
function refresh(){snapshot().then(function(s){for(var i=0;i<listeners.length;i++)try{listeners[i][0](s)}catch(e){}},function(e){for(var i=0;i<listeners.length;i++)if(listeners[i][1])try{listeners[i][1](e)}catch(x){}})}
var col={doc:function(id){return{set:function(a){return api('PUT','/api/db/'+page+'/answers/'+encodeURIComponent(id),a).then(function(){})}}},
onSnapshot:function(cb,err){var l=[cb,err];listeners.push(l);refresh();return function(){var i=listeners.indexOf(l);if(i>=0)listeners.splice(i,1)}}};
var db={collection:function(n){if(n!=='answers')throw{code:'invalid_argument'};return col}};
W.claude={use:function(name){if(name!=='db'||mode==='tv'||!page)return Promise.reject({code:'capability_disabled'});return Promise.resolve(db)},
hot:{data:data,snapshot:function(fn){snaps.push(fn)},ready:function(cb){try{cb(data)}catch(e){}}}};
function reload(){var out={};for(var i=0;i<snaps.length;i++){try{var v=snaps[i]();if(v&&typeof v==='object')for(var k in v)out[k]=v[k]}catch(e){}}
try{W.sessionStorage.setItem(KEY,JSON.stringify(out))}catch(e){}W.location.reload()}
var t=0,loaded=Date.now();function soon(){clearTimeout(t);t=setTimeout(reload,Math.max(400,1500-(Date.now()-loaded)))}
if(!page)return;var folder='.joserah/desk/artifacts/'+page+'/';
function onEvent(e){if(!e)return;if(e.type==='answers'&&e.page===page)refresh();else if(e.type==='changed'&&String(e.path).indexOf(folder)===0)soon();else if(e.type==='reset')soon()}
var polling=false,stamp=null;function poll(){if(polling)return;polling=true;setInterval(function(){api('GET','/api/stamp/'+page).then(function(j){if(stamp!==null&&j.stamp!==stamp)reload();stamp=j.stamp},function(){})},10000)}
if(typeof W.EventSource==='undefined'){poll();return}
var fails=0,es=new W.EventSource('/events');es.onmessage=function(m){fails=0;try{onEvent(JSON.parse(m.data))}catch(x){}};
es.onerror=function(){fails++;if(es.readyState===2){api('GET','/api/me').then(function(){poll()},function(){})}else if(fails>=3){es.close();poll()}};
})();`;
```

In `server/src/pages.ts` `preparePage`, append the script tag to `head` right after the two meta tags:

```ts
  let head = `<meta name="joserah-page" content="${o.page}"><meta name="joserah-mode" content="${o.mode}"><script src="/_/shim.js"></script>`;
```

`server/src/routes/db.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { jsonError } from '../app.ts';
import { pageDir } from '../pages.ts';
import { answersLib } from '../cjs.ts';
import { SHIM_JS } from '../shim.ts';

export function register(app: App, deps: AppDeps): void {
  app.get('/_/shim.js', (c) => c.body(SHIM_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }));
  app.get('/api/me', (c) => c.json({ ok: true }));
  app.get('/api/db/:day/:folder/answers', (c) => {
    const dir = pageDir(deps.workspace, c.req.param('day'), c.req.param('folder'));
    if (!dir) return jsonError(c, 404, 'not-found');
    return c.json({ docs: answersLib.list(dir).map(({ id, ...data }) => ({ id, data })) });
  });
  app.put('/api/db/:day/:folder/answers/:id', async (c) => {
    const { day, folder, id } = c.req.param();
    if (!pageDir(deps.workspace, day, folder)) return jsonError(c, 404, 'not-found');
    let body: unknown;
    try { body = await c.req.json(); } catch { return jsonError(c, 400, 'bad-doc'); }
    const r = deps.store.putAnswer(`${day}/${folder}`, id, body);
    if (r.ok) return c.json({ ok: true });
    return jsonError(c, r.code === 'not-yours' ? 409 : 400, r.code);
  });
  app.get('/api/stamp/:day/:folder', (c) => {
    const dir = pageDir(deps.workspace, c.req.param('day'), c.req.param('folder'));
    if (!dir) return jsonError(c, 404, 'not-found');
    const stamp = ['index.html', 'rows.json', 'trail.json', 'cases.json'].reduce((m, f) => { try { return Math.max(m, fs.statSync(path.join(dir, f)).mtimeMs); } catch { return m; } }, 0);
    return c.json({ stamp });
  });
}
```

`server/src/routes/events.ts`:

```ts
import { streamSSE } from 'hono/streaming';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import type { BusEvent } from '../events.ts';

export function register(app: App, deps: AppDeps): void {
  app.get('/events', (c) => {
    const lastRaw = c.req.header('last-event-id') ?? c.req.query('last');
    const last = lastRaw === undefined ? NaN : Number(lastRaw);
    return streamSSE(c, async (stream) => {
      const queue: Array<{ id: number; event: BusEvent }> = [];
      let wake: (() => void) | null = null;
      const off = deps.bus.subscribe((id, event) => { queue.push({ id, event }); wake?.(); });
      stream.onAbort(() => { off(); wake?.(); });
      if (Number.isFinite(last)) {
        const missed = deps.bus.since(last);
        if (missed === null) queue.unshift({ id: deps.bus.lastId(), event: { type: 'reset' } });
        else queue.unshift(...missed.filter((m) => !queue.some((q) => q.id === m.id)));
      } else {
        await stream.writeSSE({ id: String(deps.bus.lastId()), data: '{"type":"hello"}' });
      }
      let ping = Date.now();
      while (!stream.aborted) {
        while (queue.length) { const m = queue.shift()!; await stream.writeSSE({ id: String(m.id), data: JSON.stringify(m.event) }); }
        await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 25000); wake = () => { clearTimeout(timer); resolve(); }; });
        wake = null;
        if (Date.now() - ping >= 25000) { await stream.write(': ping\n\n'); ping = Date.now(); }
      }
      off();
    });
  });
}
```

Register `dbRoutes(app, deps)` and `eventsRoutes(app, deps)` in `createApp` after `pagesRoutes`.

`server/main.ts` — create the bus and the store before `createApp`, then start polling once the server listens:

```ts
import { EventBus } from './src/events.ts';
import { Store } from './src/store.ts';
import { localDay } from './src/paths.ts';
// ...
const bus = new EventBus();
const store = new Store(workspace, bus, { pollDirs: () => {
  const d = new Date(); const y = new Date(d.getTime() - 86400000);
  return [`.joserah/desk/artifacts/${localDay(d)}`, `.joserah/desk/artifacts/${localDay(y)}`, '.joserah/knowledge'];
} });
// deps gets: store, bus
// in the serve() callback, after the URL line:
store.start();
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts" && node --test tests/answers.test.js`
Expected: PASS — `db` (4), `sse` (3), `shim` (5), every earlier test; `answers` (5).

- [ ] **Step 8: Run the existing suite**

Run: `node --test tests/*.test.js 2>&1 | tail -3`
Expected: `# fail 0`.

- [ ] **Step 9: Commit**

```bash
git add tools/lib/answers.js tests/answers.test.js server/src server/main.ts server/test
git commit -m "server: answers merged by owner under a shared lock, artifact shim, event stream"
```

---

### Task 7: Answers CLI and the session brief line

The terminal door reads and answers what the owner wrote on a page: `tools/answers.js` replaces ArtifactData for answers, and the session brief carries one line with counts and pointers (never the answers themselves).

**Files:**
- Create: `tools/answers.js`
- Modify: `hooks/session-brief.js` (one new line source, `answersLine`), `tests/answers.test.js` (CLI and brief tests)

**Interfaces:**
- Consumes: `tools/lib/answers.js` (Task 6).
- Produces:
  - `node tools/answers.js list <page-dir> [--new] [--json]` — text: one line per document `<id> · <state> · <HH:MM> · <key or -> · <row or -> · <note, first 120 chars>`; `--json`: the array. Exit 0.
  - `node tools/answers.js mark <page-dir> <id> read` — prints `marked: <id>`; exit 1 with `answers: not-found|not-yours` on refusal.
  - `node tools/answers.js reply <page-dir> <id> --note "<text>"` — prints `reply: <reply id>`; exit 1 on refusal.
  - `node tools/answers.js pages <workspace> [--days N]` — one line per page with new answers: `<YYYY-MM-DD/folder> · <count> new · <absolute dir>`; prints nothing when none.
  - Session brief: `[answers] …` line when any page of the last 2 days has new answers.

- [ ] **Step 1: Write the failing tests** (append to `tests/answers.test.js`)

```js
const { runTool, HERMETIC_CONFIG_DIR } = require('./helpers');
const { spawnSync } = require('child_process');

function pageWith(t) {
  const ws = path.join(tmpdir(t), 'ws');
  runTool('scaffold.js', ['--target', ws, '--workspace', 'w', '--owner', 'O', '--language', 'en', '--role', 'r']);
  const d = path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-06', 'daily-tracker');
  fs.mkdirSync(d, { recursive: true });
  A.put(d, 'a-q-1', { row: 'Pick a cable', key: 'B', note: 'the short one', at: '2026-10-06T08:00:00Z' }, 'owner');
  return { ws, d };
}

test('answers.js list, reply and mark', (t) => {
  const { d } = pageWith(t);
  let r = runTool('answers.js', ['list', d, '--new']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^a-q-1 · new · \d\d:\d\d · B · Pick a cable · the short one$/m);
  r = runTool('answers.js', ['reply', d, 'a-q-1', '--note', 'Ordered the short one.']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^reply: a-q-1--r[a-z0-9]+$/m);
  r = runTool('answers.js', ['mark', d, 'a-q-1', 'read']);
  assert.match(r.stdout, /^marked: a-q-1$/m);
  r = runTool('answers.js', ['list', d, '--new', '--json']);
  assert.deepEqual(JSON.parse(r.stdout), []);
  r = runTool('answers.js', ['mark', d, 'a-nope', 'read']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /answers: not-found/);
});

test('answers.js pages lists counts and paths, nothing when none', (t) => {
  const { ws, d } = pageWith(t);
  let r = runTool('answers.js', ['pages', ws]);
  assert.equal(r.stdout.trim(), `2026-10-06/daily-tracker · 1 new · ${d}`);
  A.markRead(d, 'a-q-1');
  r = runTool('answers.js', ['pages', ws]);
  assert.equal(r.stdout, '');
});

test('the session brief carries one [answers] line with counts and pointers, no bodies', (t) => {
  const { ws } = pageWith(t);
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'session-brief.js')],
    { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HERMETIC_CONFIG_DIR, CLAUDE_PLUGIN_ROOT: '', JOSERAH_NOW: '2026-10-06T09:00:00' } });
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  const line = ctx.split('\n').find((l) => l.startsWith('[answers]'));
  assert.ok(line, ctx);
  assert.match(line, /1 new answer/);
  assert.match(line, /2026-10-06\/daily-tracker/);
  assert.match(line, /answers\.js" list /);
  assert.ok(!line.includes('the short one'), 'pointers, never bodies');
});
```

(`session-brief.js` uses the real clock for "today"; `newCounts` looks at the two newest day folders whatever their date, so the test is clock-independent. `JOSERAH_NOW` is passed only so the journal stub it writes has a stable name.)

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/answers.test.js`
Expected: FAIL — `answers.js` CLI tests exit 1 with `Cannot find module`; the brief test fails `line` undefined.

- [ ] **Step 3: Write `tools/answers.js`**

```js
#!/usr/bin/env node
/**
 * answers.js — read and answer what the owner wrote on a page served by the Joserah server.
 *
 *   node tools/answers.js list <page-dir> [--new] [--json]
 *   node tools/answers.js mark <page-dir> <id> read
 *   node tools/answers.js reply <page-dir> <id> --note "<text>"
 *   node tools/answers.js pages <workspace> [--days N]
 *
 * <page-dir> is the page's folder (.joserah/desk/artifacts/<day>/<folder>); answers.json sits beside its
 * rows.json. Replies are "<id>--r<time>" documents from the assistant; an owner document is never changed
 * except its read mark (tools/lib/answers.js). No dependencies.
 */
'use strict';
const path = require('path');
const A = require('./lib/answers');

function die(msg) { process.stderr.write(`answers: ${msg}\n`); process.exit(1); }
const hm = (iso) => { const d = new Date(iso); return isNaN(d) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, 2); return v; };
const has = (name) => { const i = rest.indexOf(name); if (i < 0) return false; rest.splice(i, 1); return true; };

if (cmd === 'list') {
  const onlyNew = has('--new'); const json = has('--json'); const dir = rest[0];
  if (!dir) die('usage: answers.js list <page-dir> [--new] [--json]');
  const docs = A.list(path.resolve(dir), { onlyNew });
  if (json) process.stdout.write(JSON.stringify(docs, null, 2) + '\n');
  else for (const d of docs) process.stdout.write(`${d.id} · ${d.state || '-'} · ${hm(d.at)} · ${d.key || '-'} · ${flat(d.row) || '-'} · ${flat(d.note).slice(0, 120)}\n`);
} else if (cmd === 'mark') {
  const [dir, id, what] = rest;
  if (!dir || !id || what !== 'read') die('usage: answers.js mark <page-dir> <id> read');
  const r = A.markRead(path.resolve(dir), id);
  if (!r.ok) die(r.code);
  process.stdout.write(`marked: ${id}\n`);
} else if (cmd === 'reply') {
  const note = flag('--note'); const [dir, id] = rest;
  if (!dir || !id || !note) die('usage: answers.js reply <page-dir> <id> --note "<text>"');
  const r = A.reply(path.resolve(dir), id, note);
  if (!r.ok) die(r.code);
  process.stdout.write(`reply: ${r.id}\n`);
} else if (cmd === 'pages') {
  const days = Number(flag('--days') || 2); const ws = rest[0];
  if (!ws) die('usage: answers.js pages <workspace> [--days N]');
  for (const p of A.newCounts(path.resolve(ws), days)) process.stdout.write(`${p.page} · ${p.count} new · ${p.dir}\n`);
} else {
  die('usage: answers.js list|mark|reply|pages …');
}
```

- [ ] **Step 4: Add the brief line to `hooks/session-brief.js`**

After `newDayLine` (around line 449), add:

```js
// 0.19.0: answers the owner left on a page served by the Joserah server. Counts and pointers only —
// the session reads the answers through tools/answers.js when it acts on them (spec §2, §7).
function answersLine(root, cfg) {
  let pages;
  try { pages = require('../tools/lib/answers').newCounts(root, 2); } catch (e) { return null; }
  if (!pages.length) return null;
  const n = pages.reduce((s, p) => s + p.count, 0);
  const tool = path.join(__dirname, '..', 'tools', 'answers.js');
  const where = pages.map((p) => `${p.page} (${p.count})`).join(', ');
  const first = pages[0].dir;
  return isTurkish(cfg.dialogueLanguage)
    ? `[answers] Sayfalarda ${n} yeni cevap var: ${where}. Oku: node "${tool}" list "${first}" --new; cevapla: node "${tool}" reply "${first}" <id> --note "…"; sonra mark <id> read.`
    : `[answers] ${n} new answer${n === 1 ? '' : 's'} on the pages: ${where}. Read: node "${tool}" list "${first}" --new; reply: node "${tool}" reply "${first}" <id> --note "…"; then mark <id> read.`;
}
```

and where the other lines are assembled:

```js
const answers = answersLine(ROOT, cfg);
// ...
if (newDay) parts.push('\n' + newDay);
if (answers) parts.push('\n' + answers);
```

(In the Turkish branch the count still reads "N yeni cevap"; the test runs an English workspace.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/answers.test.js && node --test tests/*.test.js 2>&1 | tail -3`
Expected: `answers` 8 passing; full suite `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add tools/answers.js hooks/session-brief.js tests/answers.test.js
git commit -m "answers: terminal CLI and a session brief line for answers left on a page"
```

---

### Task 8: Engine — the claude CLI behind one interface

**Files:**
- Create: `server/src/engine.ts`, `server/src/engines/claude-cli.ts`
- Create: `server/test/fixtures/fake-claude.mjs`, `server/test/fixtures/stream-ok.jsonl`
- Test: `server/test/engine.test.ts`

**Interfaces:**
- Consumes: `config.ts` `JobType`.
- Produces:
  - `engine.ts`:
    ```ts
    export interface EngineJob { id: string; type: JobType; target: 'server'; brief: string; model: string; cwd: string; budgetUsd: number; resumeSessionId?: string; restricted: boolean; writeArea: string[]; allowTools?: string[] }
    export type EngineEvent =
      | { kind: 'init'; sessionId: string; model: string; cliVersion: string; tools: string[] }
      | { kind: 'text'; text: string } | { kind: 'tool'; name: string } | { kind: 'turn' } | { kind: 'denied'; tool: string }
      | { kind: 'result'; ok: boolean; subtype: string; text: string; costUsd: number | null; turns: number | null; denials: string[]; sessionId: string | null }
      | { kind: 'other'; type: string } | { kind: 'bad-line'; text: string } | { kind: 'stderr'; text: string };
    export interface EngineItem { raw: string; event: EngineEvent }
    export interface EngineRun { readonly pid: number | undefined; events: AsyncIterable<EngineItem>; cancel(): Promise<void>; done: Promise<{ code: number | null; signal: string | null; spawnError: string | null }> }
    export interface EngineHealth { installed: boolean; version: string | null; signedIn: boolean; detail: string }
    export interface Engine { readonly name: string; start(job: EngineJob): EngineRun; health(): Promise<EngineHealth> }
    ```
  - `engines/claude-cli.ts`: `claudeArgs(job: EngineJob): string[]`, `parseLine(line: string): EngineEvent[]`, `jobEnv(src?: NodeJS.ProcessEnv, jobId?: string): NodeJS.ProcessEnv`, `killTree(pid: number): Promise<void>`, `class ClaudeCliEngine implements Engine { constructor(o?: { command?: string; prefixArgs?: string[]; extraEnv?: Record<string, string> }) }`.
  - Test helper (in `engine.test.ts`, reused by later tests through `server/test/helpers.ts`): `fakeEngine(extraEnv?: Record<string, string>): ClaudeCliEngine` — `command: process.execPath`, `prefixArgs: [<fixtures>/fake-claude.mjs]`. Add it to helpers in this task.

- [ ] **Step 1: Write the fixtures**

`server/test/fixtures/stream-ok.jsonl` — shaped on a real 2.1.289 stream recorded 2026-10-06 (keys kept, content neutral; `SESSION` is replaced by the fake):

```
{"type":"system","subtype":"init","cwd":"/w","session_id":"SESSION","tools":["Read","Write"],"model":"claude-sonnet-test","permissionMode":"acceptEdits","claude_code_version":"2.1.289","uuid":"u1"}
{"type":"system","subtype":"thinking_tokens","estimated_tokens":10,"session_id":"SESSION","uuid":"u2"}
{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"thinking","thinking":""}]},"parent_tool_use_id":null,"session_id":"SESSION","uuid":"u3"}
{"type":"assistant","message":{"id":"m2","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"notes.md"}}]},"parent_tool_use_id":null,"session_id":"SESSION","uuid":"u4"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"x"}]},"parent_tool_use_id":null,"session_id":"SESSION","uuid":"u5"}
{"type":"rate_limit_event","rate_limit_info":{},"uuid":"u6","session_id":"SESSION"}
{"type":"assistant","message":{"id":"m3","role":"assistant","content":[{"type":"text","text":"Done. password=hunter2hunter2 was never used."}]},"parent_tool_use_id":null,"session_id":"SESSION","uuid":"u7"}
{"type":"result","subtype":"success","is_error":false,"num_turns":2,"result":"Done.","total_cost_usd":0.0123,"permission_denials":[],"session_id":"SESSION","uuid":"u8"}
{"type":"system","subtype":"task_summary","detail":"","uuid":"u9","session_id":"SESSION"}
```

`server/test/fixtures/fake-claude.mjs`:

```js
#!/usr/bin/env node
// Stands in for the claude CLI in tests. Records argv and stdin, writes or deletes files on request,
// then plays a scripted stream. FAKE_CLAUDE_MODE: ok | deny | budget | crash | hang | turns | echo | resume-fail.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const env = process.env;
const args = process.argv.slice(2);
if (env.FAKE_CLAUDE_ARGS_OUT) fs.writeFileSync(env.FAKE_CLAUDE_ARGS_OUT, JSON.stringify(args));
if (args[0] === '--version') { console.log('2.1.289 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: env.FAKE_CLAUDE_SIGNED_IN !== '0', authMethod: 'claude.ai' })); process.exit(0); }

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const stdin = Buffer.concat(chunks);
if (env.FAKE_CLAUDE_STDIN_OUT) fs.writeFileSync(env.FAKE_CLAUDE_STDIN_OUT, stdin);

const mode = env.FAKE_CLAUDE_MODE || 'ok';
const r = args.indexOf('--resume');
const sid = r >= 0 ? args[r + 1] : (env.FAKE_CLAUDE_SESSION || '00000000-0000-4000-8000-000000000001');
const lines = fs.readFileSync(path.join(import.meta.dirname, 'stream-ok.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l.replaceAll('SESSION', sid)));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

for (const spec of (env.FAKE_CLAUDE_WRITE || '').split(';').filter(Boolean)) {
  const i = spec.indexOf(':'); const rel = spec.slice(0, i);
  fs.mkdirSync(path.dirname(rel), { recursive: true }); fs.writeFileSync(rel, spec.slice(i + 1));
}
for (const rel of (env.FAKE_CLAUDE_DELETE || '').split(';').filter(Boolean)) fs.rmSync(rel, { force: true });

if (mode === 'resume-fail' && r >= 0) { process.stderr.write(`No conversation found with session ID: ${sid}\n`); process.exit(1); }
if (mode === 'crash') { out(lines[0]); process.stderr.write('boom\n'); process.exit(3); }
if (mode === 'hang') {
  out(lines[0]);
  const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  if (env.FAKE_CLAUDE_PIDS) fs.writeFileSync(env.FAKE_CLAUDE_PIDS, JSON.stringify([process.pid, g.pid]));
  setInterval(() => {}, 1000);
} else if (mode === 'turns') {
  out(lines[0]);
  let i = 0;
  setInterval(() => {
    out({ type: 'assistant', session_id: sid, message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }] } });
    out({ type: 'user', session_id: sid, message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'x' }] } });
    i += 1;
  }, 5);
} else {
  for (const o of lines) {
    if (o.type === 'result') {
      if (mode === 'deny') {
        out({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'toolu_d', session_id: sid });
        o.permission_denials = [{ tool_name: 'Bash', tool_use_id: 'toolu_d', tool_input: { command: 'make' } }];
      }
      if (mode === 'budget') { o.subtype = 'error_max_budget_usd'; o.is_error = true; o.result = ''; }
      if (mode === 'echo') o.result = stdin.toString('utf8');
    }
    out(o);
  }
  process.stdout.write('this line is not json\n');
  process.exit(0);
}
```

- [ ] **Step 2: Write the failing test**

Add to `server/test/helpers.ts`:

```ts
import { ClaudeCliEngine } from '../src/engines/claude-cli.ts';
export const FAKE_CLAUDE = path.join(SERVER_ROOT, 'test', 'fixtures', 'fake-claude.mjs');
export function fakeEngine(extraEnv: Record<string, string> = {}): ClaudeCliEngine {
  return new ClaudeCliEngine({ command: process.execPath, prefixArgs: [FAKE_CLAUDE], extraEnv });
}
```

`server/test/engine.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { claudeArgs, parseLine, jobEnv } from '../src/engines/claude-cli.ts';
import type { EngineJob, EngineItem } from '../src/engine.ts';
import { fakeEngine, tmpdir, SERVER_ROOT } from './helpers.ts';

const job = (o: Partial<EngineJob> = {}): EngineJob => ({ id: 'j1', type: 'task', target: 'server', brief: 'b', model: 'sonnet', cwd: process.cwd(), budgetUsd: 2, restricted: false, writeArea: [], ...o });
async function collect(run: { events: AsyncIterable<EngineItem> }): Promise<EngineItem[]> { const out: EngineItem[] = []; for await (const x of run.events) out.push(x); return out; }

test('claudeArgs: a general job', () => {
  assert.deepEqual(claudeArgs(job()), ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--max-budget-usd', '2.00', '--permission-prompts', 'none', '--permission-mode', 'acceptEdits']);
});

test('claudeArgs: a restricted job writes only in its area, allow rules last', () => {
  assert.deepEqual(claudeArgs(job({ type: 'ingest', restricted: true, writeArea: ['.joserah/knowledge'], budgetUsd: 0.5 })), [
    '-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--max-budget-usd', '0.50', '--permission-prompts', 'none',
    '--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob,Edit,Write',
    '--allowedTools', 'Edit(.joserah/knowledge/**)', 'Write(.joserah/knowledge/**)',
  ]);
  assert.deepEqual(claudeArgs(job({ type: 'query', restricted: true })).slice(-6), ['--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob']);
});

test('claudeArgs: resume and an owner-approved tool', () => {
  const a = claudeArgs(job({ resumeSessionId: 'sid-1', allowTools: ['Bash'] }));
  assert.deepEqual(a.slice(a.indexOf('--resume'), a.indexOf('--resume') + 2), ['--resume', 'sid-1']);
  assert.deepEqual(a.slice(-2), ['--allowedTools', 'Bash']);
});

test('parseLine maps every recorded line, never throws', () => {
  const lines = fs.readFileSync(path.join(SERVER_ROOT, 'test', 'fixtures', 'stream-ok.jsonl'), 'utf8').trim().split('\n');
  const kinds = lines.flatMap((l) => parseLine(l.replaceAll('SESSION', 's1'))).map((e) => e.kind);
  assert.deepEqual(kinds, ['init', 'other', 'tool', 'turn', 'other', 'text', 'result', 'other']);
  const init = parseLine(lines[0].replaceAll('SESSION', 's1'))[0];
  assert.deepEqual(init, { kind: 'init', sessionId: 's1', model: 'claude-sonnet-test', cliVersion: '2.1.289', tools: ['Read', 'Write'] });
  const res = parseLine(lines[7].replaceAll('SESSION', 's1'))[0];
  assert.deepEqual(res, { kind: 'result', ok: true, subtype: 'success', text: 'Done.', costUsd: 0.0123, turns: 2, denials: [], sessionId: 's1' });
  assert.deepEqual(parseLine('not json'), [{ kind: 'bad-line', text: 'not json' }]);
  assert.deepEqual(parseLine(''), []);
  assert.deepEqual(parseLine('{"type":"system","subtype":"permission_denied","tool_name":"Bash"}'), [{ kind: 'denied', tool: 'Bash' }]);
  assert.deepEqual(parseLine('[1,2]'), [{ kind: 'other', type: 'unknown' }]);
});

test('stdin carries Turkish, quotes and newlines', async (t) => {
  const out = path.join(tmpdir(t), 'stdin.bin');
  const text = `"Şu dosyayı" 'özetle'\nsonra… çğıöşü İ $HOME \`x\` %PATH%`;
  const run = fakeEngine({ FAKE_CLAUDE_STDIN_OUT: out }).start(job({ brief: text }));
  await collect(run); await run.done;
  assert.ok(fs.readFileSync(out).equals(Buffer.from(text, 'utf8')));
});

test('a run streams init, text, result and a bad line', async () => {
  const run = fakeEngine().start(job());
  const items = await collect(run);
  const done = await run.done;
  assert.equal(done.code, 0);
  const kinds = items.map((i) => i.event.kind);
  assert.ok(kinds.includes('init') && kinds.includes('text') && kinds.includes('result') && kinds.includes('bad-line'));
  assert.ok(items.every((i) => typeof i.raw === 'string'));
});

test('cancel kills the whole process tree', async (t) => {
  const pids = path.join(tmpdir(t), 'pids.json');
  const run = fakeEngine({ FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_PIDS: pids }).start(job());
  const it = run.events[Symbol.asyncIterator]();
  await it.next();
  for (let i = 0; i < 100 && !fs.existsSync(pids); i++) await new Promise((r) => setTimeout(r, 50));
  const [parent, child] = JSON.parse(fs.readFileSync(pids, 'utf8')) as number[];
  await run.cancel();
  await run.done;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 50 && (alive(parent) || alive(child)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(!alive(parent), 'cli gone');
  assert.ok(!alive(child), 'its child gone too');
});

test('a missing binary ends the run with a spawn error, not a throw', async () => {
  const { ClaudeCliEngine } = await import('../src/engines/claude-cli.ts');
  const run = new ClaudeCliEngine({ command: 'definitely-not-claude-xyz' }).start(job());
  await collect(run);
  const d = await run.done;
  assert.match(d.spawnError ?? '', /ENOENT/);
});

test('jobEnv keeps only the allowlist', () => {
  const e = jobEnv({ PATH: '/bin', HOME: '/h', JOSERAH_STATE_DIR: '/s', JOSERAH_NOW: 'x', MY_SECRET: 's', GITHUB_TOKEN: 't', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c', AWS_SECRET_ACCESS_KEY: 'a' }, 'j9');
  assert.deepEqual(Object.keys(e).sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR', 'HOME', 'JOSERAH_JOB_ID', 'PATH', ...(process.platform === 'win32' ? [] : ['LANG'])].sort());
  assert.equal(e.JOSERAH_JOB_ID, 'j9');
});

test('health reads the version and the sign-in state', async () => {
  assert.deepEqual(await fakeEngine().health(), { installed: true, version: '2.1.289', signedIn: true, detail: 'signed in' });
  const out = await fakeEngine({ FAKE_CLAUDE_SIGNED_IN: '0' }).health();
  assert.equal(out.signedIn, false);
  assert.equal(out.detail, 'not signed in');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test --test-concurrency=1 server/test/engine.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/engines/claude-cli.ts`.

- [ ] **Step 4: Write the implementation**

`server/src/engine.ts` — exactly the interface block above (types only, plus `import type { JobType } from './config.ts';`).

`server/src/engines/claude-cli.ts`:

```ts
import { spawn, spawnSync, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { Engine, EngineEvent, EngineHealth, EngineItem, EngineJob, EngineRun } from '../engine.ts';

const run = promisify(execFile);
type J = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});

export function claudeArgs(job: EngineJob): string[] {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--model', job.model, '--max-budget-usd', job.budgetUsd.toFixed(2), '--permission-prompts', 'none'];
  if (job.resumeSessionId) a.push('--resume', job.resumeSessionId);
  const allow: string[] = [];
  if (job.restricted) {
    const writes = job.writeArea.length > 0;
    a.push('--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools', writes ? 'Read,Grep,Glob,Edit,Write' : 'Read,Grep,Glob');
    for (const area of job.writeArea) allow.push(`Edit(${area}/**)`, `Write(${area}/**)`);
  } else {
    a.push('--permission-mode', 'acceptEdits');
  }
  allow.push(...(job.allowTools ?? []));
  if (allow.length) a.push('--allowedTools', ...allow); // takes several values: always last
  return a;
}

export function parseLine(line: string): EngineEvent[] {
  const t = line.trim();
  if (!t) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch { return [{ kind: 'bad-line', text: t.slice(0, 500) }]; }
  const j = obj(parsed); const type = str(j.type); const sub = str(j.subtype);
  if (type === 'system' && sub === 'init') return [{ kind: 'init', sessionId: str(j.session_id), model: str(j.model), cliVersion: str(j.claude_code_version), tools: arr(j.tools).map(str) }];
  if (type === 'system' && sub === 'permission_denied') return [{ kind: 'denied', tool: str(j.tool_name) }];
  if (type === 'assistant') return arr(obj(j.message).content).flatMap((b): EngineEvent[] => {
    const o = obj(b);
    if (o.type === 'text' && str(o.text)) return [{ kind: 'text', text: str(o.text) }];
    if (o.type === 'tool_use') return [{ kind: 'tool', name: str(o.name) }];
    return [];
  });
  if (type === 'user') return arr(obj(j.message).content).some((b) => obj(b).type === 'tool_result') ? [{ kind: 'turn' }] : [];
  if (type === 'result') return [{
    kind: 'result', ok: sub === 'success' && j.is_error !== true, subtype: sub, text: str(j.result),
    costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null, turns: typeof j.num_turns === 'number' ? j.num_turns : null,
    denials: arr(j.permission_denials).map((d) => str(obj(d).tool_name)).filter(Boolean), sessionId: str(j.session_id) || null,
  }];
  return [{ kind: 'other', type: type || 'unknown' }];
}

const KEEP = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'TZ',
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH', 'DISABLE_AUTOUPDATER', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];
export function jobEnv(src: NodeJS.ProcessEnv = process.env, jobId?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of KEEP) if (src[k] !== undefined) out[k] = src[k];
  if (jobId) out.JOSERAH_JOB_ID = jobId;
  if (process.platform !== 'win32' && !out.LANG) out.LANG = 'C.UTF-8';
  return out;
}

export function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); return Promise.resolve(); }
  try { process.kill(-pid, 'SIGTERM'); } catch { return Promise.resolve(); }
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      try { process.kill(-pid, 0); } catch { resolve(); return; }
      if (Date.now() - start > 3000) { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } resolve(); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
}

class Queue<T> {
  #items: T[] = []; #waiters: Array<(r: IteratorResult<T>) => void> = []; #closed = false;
  push(v: T): void { const w = this.#waiters.shift(); if (w) w({ value: v, done: false }); else this.#items.push(v); }
  close(): void { this.#closed = true; for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true } as IteratorResult<T>); }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => (this.#items.length ? Promise.resolve({ value: this.#items.shift()!, done: false }) : this.#closed ? Promise.resolve({ value: undefined, done: true } as IteratorResult<T>) : new Promise((r) => this.#waiters.push(r))) };
  }
}

export class ClaudeCliEngine implements Engine {
  readonly name = 'claude-cli';
  #cmd: string; #prefix: string[]; #extra: Record<string, string>;
  constructor(o: { command?: string; prefixArgs?: string[]; extraEnv?: Record<string, string> } = {}) {
    this.#cmd = o.command ?? 'claude'; this.#prefix = o.prefixArgs ?? []; this.#extra = o.extraEnv ?? {};
  }

  start(job: EngineJob): EngineRun {
    const q = new Queue<EngineItem>();
    const child = spawn(this.#cmd, [...this.#prefix, ...claudeArgs(job)], {
      cwd: job.cwd, env: { ...jobEnv(process.env, job.id), ...this.#extra }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: true, shell: false,
    });
    let spawnError: string | null = null;
    const done = new Promise<{ code: number | null; signal: string | null; spawnError: string | null }>((resolve) => {
      child.on('error', (e) => { spawnError = `${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}`.trim(); q.close(); resolve({ code: null, signal: null, spawnError }); });
      child.on('close', (code, signal) => { q.close(); resolve({ code, signal, spawnError }); });
    });
    child.stdin?.on('error', () => { /* the CLI may exit before reading all of stdin */ });
    child.stdin?.end(Buffer.from(job.brief, 'utf8'));
    if (child.stdout) createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (raw) => { for (const event of parseLine(raw)) q.push({ raw, event }); });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => q.push({ raw: '', event: { kind: 'stderr', text: text.slice(0, 2000) } }));
    return { pid: child.pid, events: q, done, cancel: () => (child.pid ? killTree(child.pid) : Promise.resolve()) };
  }

  async health(): Promise<EngineHealth> {
    const opts = { env: { ...jobEnv(process.env), ...this.#extra }, timeout: 15000, windowsHide: true };
    let version: string | null = null;
    try { version = /(\d+\.\d+\.\d+)/.exec((await run(this.#cmd, [...this.#prefix, '--version'], opts)).stdout)?.[1] ?? null; }
    catch { return { installed: false, version: null, signedIn: false, detail: 'Claude Code is not installed or not on PATH' }; }
    try {
      const j = JSON.parse((await run(this.#cmd, [...this.#prefix, 'auth', 'status', '--json'], opts)).stdout) as { loggedIn?: boolean };
      return { installed: true, version, signedIn: j.loggedIn === true, detail: j.loggedIn === true ? 'signed in' : 'not signed in' };
    } catch (e) { return { installed: true, version, signedIn: false, detail: `sign-in state unknown: ${(e as Error).message.split('\n')[0]}` }; }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test --test-concurrency=1 server/test/engine.test.ts`
Expected: PASS (10). On Windows the tree test proves `taskkill /T`; on Linux, `kill(-pid)`.

- [ ] **Step 6: Run the full server suite**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add server/src/engine.ts server/src/engines server/test/fixtures server/test/engine.test.ts server/test/helpers.ts
git commit -m "server: claude CLI engine behind one interface: stdin brief, stream parsing, tree cancel, env allowlist"
```

---

### Task 9: Job runner — queue on disk, limits, records, Tracker rows

**Files:**
- Create: `server/src/briefs.ts`, `server/src/tracker-bridge.ts`, `server/src/jobs.ts`
- Modify: `server/src/deps.ts` (add `jobs`, `engine`), `server/main.ts` (build engine and runner, `ensureJobIgnores`, `rotateLogs`, `recover`, refresh health), `server/test/helpers.ts` (`runnerFor`)
- Test: `server/test/briefs.test.ts`, `server/test/tracker-bridge.test.ts`, `server/test/jobs.test.ts`

**Interfaces:**
- Consumes: `Engine`, `EngineJob`, `EngineEvent` (Task 8); `Store`, `EventBus` (Task 3); `config.ts` `JOB_TYPES`, `RESTRICTED_TYPES`, `modelFor`, `ServerConfig`; `cjs.ts` `redactions`, `dailyTrackerLib`; `paths.ts` `toolPath`, `localDay`, `hhmm`, `now`.
- Produces:
  - `briefs.ts`: `BRIEF_PREFIX: string`, `BRIEF_MAX = 4000`, `cut(text: string, max: number): string` (appends ` [cut]` when it cuts), `ruleFor(type: JobType): string`, `composeBrief(b: { task: string; type: JobType; rule?: string; pointers?: string[] }): string`.
  - `tracker-bridge.ts`: `interface TrackerBridge { row(o: { title: string; state: 'run' | 'you' | 'wait' | 'ok'; small?: string; url?: string; label?: string }): boolean; crew(o: { role: string; job: string; state: 'work' | 'owner' | 'idle'; row?: string; reason?: string }): boolean; rowState(title: string): string | null; dir(): string }`; `cliTracker(workspace: string, lang: 'tr' | 'en'): TrackerBridge`; `roleFor(type: JobType): 'builder' | 'scout' | 'architect'`; `JOB_TEXT: Record<'tr' | 'en', {...}>`.
  - `jobs.ts`: `type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'needs-approval' | 'refused'`; `interface ChangedFile { status: 'A' | 'M' | 'D' | 'R'; path: string }`; `interface JobRecord` (fields below); `class Refused extends Error { code: string }`; `interface Checkpointer { before(job: JobRecord): { ok: true; commit: string } | { ok: false; reason: string }; after(job: JobRecord): { changed: ChangedFile[]; flags: string[] } }`; `noCheckpoint`; `writeAreaFor(type: JobType): string[]`; `jobsDir(day: string): string`; `ensureJobIgnores(workspace: string): boolean`; `rotateLogs(store: Store, days: number, today?: Date): string[]`; `class JobRunner` with `submit(input: SubmitInput): JobRecord`, `reply(id: string, text: string): JobRecord`, `approve(id: string): JobRecord`, `cancel(id: string): Promise<JobRecord | undefined>`, `get(id: string): JobRecord | undefined`, `list(day?: string): JobRecord[]`, `running(): JobRecord[]`, `recover(): void`, `idle(): Promise<void>`, `onEnd(fn: (job: JobRecord) => void): void`, `logTail(id: string, n?: number): unknown[]`.
  - `interface SubmitInput { type?: string; text: string; parentId?: string; resumeSessionId?: string; allowTools?: string[]; pointers?: string[]; fallbackOf?: string; budgetUsd?: number; model?: string }`.
  - `JobRecord`: `{ id; day; type: JobType; target: 'server'; text; state: JobState; createdAt; startedAt?; endedAt?; model; budgetUsd; rowTitle; parentId?; resumeSessionId?; allowTools?: string[]; fallbackOf?; pointers?: string[]; sessionId?; cliVersion?; turns: number; costUsd?: number | null; resultText?; error?; denials?: string[]; checkpoint?; changed?: ChangedFile[]; flags?: string[]; overlap?: boolean }`.
  - Files: `.joserah/desk/jobs/<day>/<id>.job.json` (live record, every state change), `<id>.jsonl` (redacted raw stream), `<id>.md` (digest).
  - Test helper: `runnerFor(t, o?: { env?: Record<string,string>; config?: Partial<ServerConfig>; git?: boolean; checkpoint?: Checkpointer }): { runner: JobRunner; deps: AppDeps; ws: string }`.

- [ ] **Step 1: Write the failing tests — briefs and the Tracker bridge**

`server/test/briefs.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_PREFIX, composeBrief, cut, BRIEF_MAX } from '../src/briefs.ts';

test('every brief starts with the same stable prefix', () => {
  const a = composeBrief({ task: 'Summarise the week', type: 'digest' });
  const b = composeBrief({ task: 'Fix the link checker', type: 'code', pointers: ['tools/verify-links.js'] });
  assert.ok(a.startsWith(BRIEF_PREFIX + '\n') && b.startsWith(BRIEF_PREFIX + '\n'));
});

test('pointers are paths, never .html pages, and long input is cut with a marker', () => {
  const b = composeBrief({ task: 'x'.repeat(5000), type: 'task', pointers: ['a.md', '.joserah/desk/artifacts/d/f/index.html', 'p'.repeat(400)] });
  assert.ok(!/[\w./-]+\.html\b/.test(b), 'no html path in a brief');
  assert.match(b, /\[cut\]/);
  assert.ok(b.length <= BRIEF_MAX + 6);
  assert.equal(cut('abcdef', 3), 'abc [cut]');
  assert.equal(cut('abc', 3), 'abc');
});
```

`server/test/tracker-bridge.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cliTracker, roleFor } from '../src/tracker-bridge.ts';
import { tmpWorkspace } from './helpers.ts';

test.beforeEach(() => { process.env.JOSERAH_NOW = '2026-10-06T09:00:00'; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('creates today\'s Daily Tracker, then upserts a row and a strip entry', (t) => {
  const ws = tmpWorkspace(t);
  const tr = cliTracker(ws, 'en');
  assert.ok(tr.row({ title: 'Summarise the week · 09:00', state: 'run', small: 'Running.' }));
  assert.ok(tr.crew({ role: 'builder', job: 'Summarise the week · 09:00', state: 'work', row: 'Summarise the week · 09:00' }));
  assert.equal(tr.rowState('Summarise the week · 09:00'), 'run');
  assert.equal(tr.dir(), path.join(ws, '.joserah', 'desk', 'artifacts', '2026-10-06', 'daily-tracker'));
  const store = JSON.parse(fs.readFileSync(path.join(tr.dir(), 'rows.json'), 'utf8'));
  assert.equal(store.crew[0].state, 'work');
  assert.ok(tr.crew({ role: 'builder', job: 'Summarise the week · 09:00', state: 'idle' }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tr.dir(), 'rows.json'), 'utf8')).crew[0].state, 'idle');
});

test('a Tracker failure returns false, never throws', (t) => {
  const tr = cliTracker(tmpWorkspace(t), 'en');
  assert.equal(tr.crew({ role: 'builder', job: 'x', state: 'work', row: 'no such row' }), false);
});

test('job types map to strip roles', () => {
  assert.equal(roleFor('research'), 'scout');
  assert.equal(roleFor('review'), 'architect');
  assert.equal(roleFor('code'), 'builder');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/briefs.test.ts server/test/tracker-bridge.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write `briefs.ts` and `tracker-bridge.ts`**

`server/src/briefs.ts`:

```ts
import type { JobType } from './config.ts';

// The stable prefix (§7 "cache-friendly prompts"): identical bytes for every job, volatile parts after it.
export const BRIEF_PREFIX = [
  'You are running one job for the owner of this Joserah workspace, started from its web server.',
  'Work from the files and read only what the task needs; never paste whole files into your answer.',
  'Pages are made by tools, never by you: do not write or re-read any .html file. This job\'s Tracker row is kept by the server; do not edit the Tracker.',
  'Never print a secret; the vault holds them.',
  'End with a short plain-text result: what you did, what waits on the owner, which files you changed.',
].join('\n');
export const BRIEF_MAX = 4000;

export function cut(text: string, max: number): string { return text.length <= max ? text : `${text.slice(0, max)} [cut]`; }

const RULES: Partial<Record<JobType, string>> = {
  ingest: 'Write only under .joserah/knowledge/. Cite the source by its imports/ path. A value that lives on another page is linked to its home, never copied. Do not mark the source compiled and do not edit the index or the log: the server does both.',
  query: 'Answer only from .joserah/knowledge/; cite every page you used by its path; say "not found in the wiki" when it does not hold the answer.',
  lint: 'Do not edit pages. Quote conflicting sentences exactly and write them to .joserah/knowledge/.lint/conflicts.json as [{"a":{"path","quote"},"b":{"path","quote"},"note"}].',
  answers: 'Read the new answers with the answers tool named below, act on each, reply to each with one line, then mark it read.',
};
export function ruleFor(type: JobType): string { return RULES[type] ?? 'A number carries its kind and its source (claim lines, AGENTS.md §4).'; }

export function composeBrief(b: { task: string; type: JobType; rule?: string; pointers?: string[] }): string {
  const parts = [BRIEF_PREFIX, '', `## Job (${b.type})`, cut(b.task.trim(), 2000), '', '## Rule', cut(b.rule ?? ruleFor(b.type), 400)];
  const ptrs = (b.pointers ?? []).filter((p) => !/\.html?$/i.test(p)).map((p) => `- ${cut(p, 200)}`);
  if (ptrs.length) parts.push('', '## Files', ...ptrs.slice(0, 20), ...(ptrs.length > 20 ? [`- ${ptrs.length - 20} more [cut]`] : []));
  const out = parts.join('\n');
  return out.length <= BRIEF_MAX ? out : `${out.slice(0, BRIEF_MAX)}\n[cut]`;
}
```

`server/src/tracker-bridge.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { JobType } from './config.ts';
import { toolPath, localDay } from './paths.ts';
import { dailyTrackerLib } from './cjs.ts';

export interface TrackerBridge {
  row(o: { title: string; state: 'run' | 'you' | 'wait' | 'ok'; small?: string; url?: string; label?: string }): boolean;
  crew(o: { role: string; job: string; state: 'work' | 'owner' | 'idle'; row?: string; reason?: string }): boolean;
  rowState(title: string): string | null;
  dir(): string;
}

export function roleFor(type: JobType): 'builder' | 'scout' | 'architect' {
  if (type === 'research' || type === 'query') return 'scout';
  if (type === 'plan' || type === 'review') return 'architect';
  return 'builder';
}

export const JOB_TEXT = {
  tr: { queued: 'Sırada; makine boşalınca başlar.', running: 'Çalışıyor.', page: 'iş sayfası', cost: 'tahmini maliyet', stopped: 'Durdu', next: 'Sonraki: iş sayfasında Yeniden dene.',
    interrupted: 'Sunucu yeniden başlarken yarıda kaldı. Sonraki: iş sayfasında Yeniden dene.', approval: 'İzin istedi', approvalNext: 'Sonraki: iş sayfasında izin verin ya da bırakın.',
    cancelled: 'Sizin isteğinizle durduruldu. Sonraki: gerekirse iş sayfasında Yeniden dene.', check: 'Değişiklikleri kontrol edin', checkNext: 'Sonraki: iş sayfasındaki dosya listesine bakın; yanlışsa son kayıt noktasından geri alınır.', empty: 'İş bitti ama sonuç yazmadı. Sonraki: iş sayfasına bakın.' },
  en: { queued: 'In the queue; starts when the machine is free.', running: 'Running.', page: 'job page', cost: 'estimated cost', stopped: 'Stopped', next: 'Next: Retry on the job page.',
    interrupted: 'The server restarted while it ran. Next: Retry on the job page.', approval: 'It asked for permission', approvalNext: 'Next: allow it on the job page, or leave it.',
    cancelled: 'Stopped at your request. Next: Retry on the job page if needed.', check: 'Check the changes', checkNext: 'Next: look at the file list on the job page; the checkpoint undoes them if wrong.', empty: 'The job ended without a result. Next: look at the job page.' },
} as const;

export function cliTracker(workspace: string, lang: 'tr' | 'en'): TrackerBridge {
  const tool = toolPath('tracker.js');
  const exec = (args: string[]) => { const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true }); if (r.status !== 0) process.stderr.write(`tracker: ${(r.stderr || r.stdout).trim().split('\n')[0]}\n`); return r.status === 0; };
  const dir = (): string => {
    const day = localDay();
    const found = dailyTrackerLib.dailyTracker(workspace, day);
    if (found) return found;
    const d = path.join(workspace, '.joserah', 'desk', 'artifacts', day, 'daily-tracker');
    exec(['init', d, '--title', 'Daily Tracker', '--lang', lang]);
    return d;
  };
  return {
    dir,
    row(o) { return exec(['row', dir(), '--title', o.title, '--state', o.state, ...(o.small ? ['--small', o.small] : []), ...(o.url ? ['--url', o.url] : []), ...(o.label ? ['--label', o.label] : [])]); },
    crew(o) { return exec(['crew', dir(), '--role', o.role, '--job', o.job, '--state', o.state, ...(o.reason ? ['--reason', o.reason] : []), ...(o.row !== undefined ? ['--row', o.row] : [])]); },
    rowState(title) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir(), 'rows.json'), 'utf8'));
        const rows: Array<{ title?: string; state?: string }> = Array.isArray(j) ? j : j.rows ?? [];
        const k = title.trim().toLowerCase();
        return rows.find((r) => String(r.title ?? '').trim().toLowerCase() === k)?.state ?? null;
      } catch { return null; }
    },
  };
}
```

Run: `node --test --test-concurrency=1 server/test/briefs.test.ts server/test/tracker-bridge.test.ts`
Expected: PASS (2 + 3).

- [ ] **Step 4: Write the failing runner tests**

Add to `server/test/helpers.ts`:

```ts
import { JobRunner, type Checkpointer } from '../src/jobs.ts';
import { cliTracker } from '../src/tracker-bridge.ts';
import type { ServerConfig } from '../src/config.ts';

export function runnerFor(t: TestContext, o: { env?: Record<string, string>; config?: Partial<ServerConfig>; git?: boolean; checkpoint?: Checkpointer } = {}) {
  const ws = tmpWorkspace(t, { git: o.git });
  const cfg: ServerConfig = { ...DEFAULT_CONFIG, ...(o.config ?? {}) };
  const deps = baseDeps(t, { workspace: ws, config: () => cfg });
  const runner = new JobRunner({ workspace: ws, store: deps.store, bus: deps.bus, engine: fakeEngine(o.env), config: () => cfg,
    tracker: cliTracker(ws, 'en'), checkpoint: o.checkpoint, jobUrl: (id) => `${ORIGIN}/jobs/${id}`, lang: 'en' });
  deps.jobs = runner;
  return { runner, deps, ws };
}
```

`server/test/jobs.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runnerFor, tmpdir } from './helpers.ts';
import { JobRunner, ensureJobIgnores, rotateLogs, Refused, type JobRecord } from '../src/jobs.ts';
import { cliTracker } from '../src/tracker-bridge.ts';
import { fakeEngine, ORIGIN } from './helpers.ts';

const DAY = '2026-10-06';
const FAKE_SID = '00000000-0000-4000-8000-000000000001';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const rowsOf = (ws: string) => { const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8')); return { rows: Array.isArray(j) ? j : j.rows, crew: Array.isArray(j) ? [] : j.crew }; };
const rec = (ws: string, j: JobRecord) => JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/jobs', j.day, `${j.id}.job.json`), 'utf8'));

test('a job runs, keeps its session id, logs redacted, writes its digest and closes its row', async (t) => {
  const { runner, ws } = runnerFor(t);
  const job = runner.submit({ type: 'digest', text: 'Summarise the week' });
  assert.equal(job.state, 'queued');
  assert.equal(job.target, 'server');
  assert.equal(job.model, 'haiku');
  await runner.idle();
  const r = rec(ws, job);
  assert.equal(r.state, 'done');
  assert.equal(r.sessionId, FAKE_SID, 'taken from the raw event before redaction');
  assert.equal(r.cliVersion, '2.1.289');
  assert.equal(r.costUsd, 0.0123);
  const log = fs.readFileSync(path.join(ws, '.joserah/desk/jobs', DAY, `${job.id}.jsonl`), 'utf8');
  assert.ok(!log.includes('hunter2hunter2'), 'redacted');
  const md = fs.readFileSync(path.join(ws, '.joserah/desk/jobs', DAY, `${job.id}.md`), 'utf8');
  assert.match(md, /^# Job /m); assert.match(md, /Cost estimate: \$0\.0123 \(CLI estimate\)/); assert.match(md, /Claude Code: 2\.1\.289/);
  const { rows, crew } = rowsOf(ws);
  const row = rows.find((x: { title: string }) => x.title === job.rowTitle);
  assert.equal(row.state, 'ok');
  assert.equal(row.url, `${ORIGIN}/jobs/${job.id}`);
  assert.equal(crew.find((c: { job: string }) => c.job === job.rowTitle).state, 'idle', 'strip cleared at the end');
});

test('denied tool calls end needs-approval with an owner row', async (t) => {
  const { runner, ws } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'deny' } });
  const job = runner.submit({ type: 'task', text: 'Build it' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'needs-approval');
  assert.deepEqual(runner.get(job.id)!.denials, ['Bash']);
  const row = rowsOf(ws).rows.find((x: { title: string }) => x.title === job.rowTitle);
  assert.equal(row.state, 'you');
  assert.match(row.small, /Bash/);
});

test('the money cap ends a job failed with the reason', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'budget' } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.match(runner.get(job.id)!.error!, /money cap \$2\.00/);
});

test('the turn limit stops a runaway job', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'turns' }, config: { jobMaxTurns: 5 } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.match(runner.get(job.id)!.error!, /turn limit 5/);
});

test('the timeout stops a hung job', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'hang' }, config: { jobTimeoutMin: 0.005 } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.match(runner.get(job.id)!.error!, /timeout/);
});

test('the owner cancels a running job', async (t) => {
  const { runner, ws } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'hang' } });
  const job = runner.submit({ type: 'task', text: 'x' });
  for (let i = 0; i < 100 && runner.get(job.id)!.state !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
  await runner.cancel(job.id);
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'cancelled');
  assert.equal(rowsOf(ws).rows.find((x: { title: string }) => x.title === job.rowTitle).state, 'you');
});

test('a crash ends failed with the first stderr line', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'crash' } });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.equal(runner.get(job.id)!.state, 'failed');
  assert.equal(runner.get(job.id)!.error, 'boom');
});

test('one job at a time by default; the second waits', async (t) => {
  const { runner } = runnerFor(t);
  const a = runner.submit({ type: 'task', text: 'first' });
  const b = runner.submit({ type: 'task', text: 'second' });
  assert.equal(runner.get(b.id)!.state, 'queued');
  await runner.idle();
  assert.ok(runner.get(b.id)!.startedAt! >= runner.get(a.id)!.endedAt!);
  assert.notEqual(a.rowTitle, b.rowTitle);
});

test('recover marks running jobs interrupted and keeps the queue', async (t) => {
  const { runner, ws, deps } = runnerFor(t);
  const tracker = cliTracker(ws, 'en');
  const mk = (id: string, state: string): JobRecord => ({ id, day: DAY, type: 'task', target: 'server', text: id, state: state as JobRecord['state'], createdAt: `${DAY}T08:00:0${id.slice(-1)}.000Z`, model: 'sonnet', budgetUsd: 2, rowTitle: `${id} · 08:00`, turns: 0 });
  tracker.row({ title: 'j-running · 08:00', state: 'run' });
  tracker.crew({ role: 'builder', job: 'j-running · 08:00', state: 'work', row: 'j-running · 08:00' });
  deps.store.writeJson(`.joserah/desk/jobs/${DAY}/j-running.job.json`, mk('j-running', 'running'));
  deps.store.writeJson(`.joserah/desk/jobs/${DAY}/j-queued2.job.json`, mk('j-queued2', 'queued'));
  runner.recover();
  await runner.idle();
  assert.equal(runner.get('j-running')!.state, 'interrupted');
  assert.equal(runner.get('j-queued2')!.state, 'done', 'queued jobs still run');
  const { rows, crew } = rowsOf(ws);
  assert.equal(rows.find((x: { title: string }) => x.title === 'j-running · 08:00').state, 'you');
  assert.equal(crew.find((c: { job: string }) => c.job === 'j-running · 08:00').state, 'idle');
});

test('reply resumes the same session', async (t) => {
  const argsOut = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_ARGS_OUT: argsOut } });
  const a = runner.submit({ type: 'task', text: 'first' });
  await runner.idle();
  const b = runner.reply(a.id, 'and also the second part');
  await runner.idle();
  const args = JSON.parse(fs.readFileSync(argsOut, 'utf8')) as string[];
  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', FAKE_SID]);
  assert.equal(runner.get(b.id)!.parentId, a.id);
  assert.equal(runner.get(b.id)!.state, 'done');
});

test('reply falls back to a fresh job from the digest when resume fails', async (t) => {
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'resume-fail' } });
  const a = runner.submit({ type: 'task', text: 'first' });
  await runner.idle();
  const b = runner.reply(a.id, 'more');
  await runner.idle();
  assert.equal(runner.get(b.id)!.state, 'failed');
  const fresh = runner.list().find((j) => j.fallbackOf === b.id)!;
  assert.ok(fresh, 'a fresh job was started');
  assert.equal(fresh.state, 'done');
  assert.ok(fresh.pointers!.some((p) => p.endsWith(`${a.id}.md`)));
});

test('approve resumes with the denied tool allowed; restricted types may not widen', async (t) => {
  const argsOut = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_MODE: 'deny', FAKE_CLAUDE_ARGS_OUT: argsOut } });
  const a = runner.submit({ type: 'task', text: 'build' });
  await runner.idle();
  runner.approve(a.id);
  await runner.idle();
  const args = JSON.parse(fs.readFileSync(argsOut, 'utf8')) as string[];
  assert.deepEqual(args.slice(-2), ['--allowedTools', 'Bash']);
  const q = runner.submit({ type: 'query', text: 'what?' });
  await runner.idle();
  assert.throws(() => runner.approve(q.id), (e: unknown) => e instanceof Refused && (e as Refused).code === 'restricted');
});

test('bad input is refused', (t) => {
  const { runner, ws } = runnerFor(t);
  assert.throws(() => runner.submit({ type: 'nope', text: 'x' }), (e: unknown) => (e as Refused).code === 'bad-type');
  assert.throws(() => runner.submit({ type: 'task', text: '   ' }), (e: unknown) => (e as Refused).code === 'bad-text');
  fs.rmSync(path.join(ws, '.joserah', 'config.json'));
  assert.throws(() => runner.submit({ type: 'task', text: 'x' }), (e: unknown) => (e as Refused).code === 'no-workspace');
  assert.equal(ensureJobIgnores(ws), false, 'no .gitignore written into a folder that is not a workspace yet');
});

test('job logs stay out of the backup; old raw logs are rotated', (t) => {
  const { ws, deps } = runnerFor(t);
  assert.equal(ensureJobIgnores(ws), true);
  assert.equal(ensureJobIgnores(ws), false, 'only once');
  const gi = fs.readFileSync(path.join(ws, '.gitignore'), 'utf8');
  assert.match(gi, /^\.joserah\/desk\/jobs\/\*\*\/\*\.jsonl$/m);
  assert.match(gi, /^\.joserah\/desk\/jobs\/\*\*\/\*\.job\.json$/m);
  deps.store.write('.joserah/desk/jobs/2026-08-01/j-old.jsonl', '{}\n');
  deps.store.write('.joserah/desk/jobs/2026-08-01/j-old.md', '# Job');
  deps.store.write(`.joserah/desk/jobs/${DAY}/j-new.jsonl`, '{}\n');
  assert.deepEqual(rotateLogs(deps.store, 30, new Date(`${DAY}T09:00:00`)), ['.joserah/desk/jobs/2026-08-01/j-old.jsonl']);
  assert.ok(fs.existsSync(path.join(ws, '.joserah/desk/jobs/2026-08-01/j-old.md')), 'the digest stays');
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/jobs.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/jobs.ts`.

- [ ] **Step 6: Write `server/src/jobs.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Engine, EngineEvent, EngineJob, EngineRun } from './engine.ts';
import type { Store } from './store.ts';
import type { EventBus, JobEventView } from './events.ts';
import { JOB_TYPES, RESTRICTED_TYPES, modelFor, type JobType, type ServerConfig } from './config.ts';
import { localDay, hhmm, now } from './paths.ts';
import { redactions } from './cjs.ts';
import { composeBrief } from './briefs.ts';
import { roleFor, JOB_TEXT, type TrackerBridge } from './tracker-bridge.ts';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'needs-approval' | 'refused';
export interface ChangedFile { status: 'A' | 'M' | 'D' | 'R'; path: string }
export interface JobRecord {
  id: string; day: string; type: JobType; target: 'server'; text: string; state: JobState;
  createdAt: string; startedAt?: string; endedAt?: string; model: string; budgetUsd: number; rowTitle: string;
  parentId?: string; resumeSessionId?: string; allowTools?: string[]; fallbackOf?: string; pointers?: string[];
  sessionId?: string; cliVersion?: string; turns: number; costUsd?: number | null; resultText?: string; error?: string;
  denials?: string[]; checkpoint?: string; changed?: ChangedFile[]; flags?: string[]; overlap?: boolean;
}
export interface SubmitInput { type?: string; text: string; parentId?: string; resumeSessionId?: string; allowTools?: string[]; pointers?: string[]; fallbackOf?: string; budgetUsd?: number; model?: string }
export class Refused extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface Checkpointer {
  before(job: JobRecord): { ok: true; commit: string } | { ok: false; reason: string };
  after(job: JobRecord): { changed: ChangedFile[]; flags: string[] };
}
export const noCheckpoint: Checkpointer = { before: () => ({ ok: true, commit: '' }), after: () => ({ changed: [], flags: [] }) };
export interface RunnerOptions { workspace: string; store: Store; bus: EventBus; engine: Engine; config: () => ServerConfig; tracker: TrackerBridge; checkpoint?: Checkpointer; jobUrl: (id: string) => string; lang: 'tr' | 'en' }

const END: readonly JobState[] = ['done', 'failed', 'cancelled', 'interrupted', 'needs-approval', 'refused'];
const redact = (s: string) => redactions.redact(s).text;
const firstLine = (s: string) => s.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? '';
export const jobsDir = (day: string) => `.joserah/desk/jobs/${day}`;
export function writeAreaFor(type: JobType): string[] { return type === 'ingest' ? ['.joserah/knowledge'] : type === 'lint' ? ['.joserah/knowledge/.lint'] : []; }

const IGNORES = ['.joserah/desk/jobs/**/*.jsonl', '.joserah/desk/jobs/**/*.job.json'];
export function ensureJobIgnores(workspace: string): boolean {
  // Only a real workspace: on an empty Docker volume the scaffold must write .gitignore first (its secret rules).
  if (!fs.existsSync(path.join(workspace, '.joserah', 'config.json'))) return false;
  const p = path.join(workspace, '.gitignore');
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORES.filter((l) => !have.has(l));
  if (!missing.length) return false;
  fs.writeFileSync(p, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# Joserah server: raw job logs and live job records stay out of the backup\n${missing.join('\n')}\n`);
  return true;
}

export function rotateLogs(store: Store, days: number, today: Date = now()): string[] {
  const base = store.abs('.joserah/desk/jobs');
  const limit = localDay(new Date(today.getTime() - days * 86400000));
  const gone: string[] = [];
  let dayDirs: string[] = [];
  try { dayDirs = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < limit); } catch { return gone; }
  for (const d of dayDirs) for (const f of fs.readdirSync(path.join(base, d)).filter((n) => n.endsWith('.jsonl'))) {
    store.remove(`.joserah/desk/jobs/${d}/${f}`); gone.push(`.joserah/desk/jobs/${d}/${f}`);
  }
  return gone;
}

export class JobRunner {
  #o: RunnerOptions;
  #jobs = new Map<string, JobRecord>();
  #queue: string[] = [];
  #active = new Set<string>();
  #live = new Map<string, { run: EngineRun; stop?: 'cancel' | 'timeout' | 'turn-limit' }>();
  #idleWaiters: Array<() => void> = [];
  #ends: Array<(job: JobRecord) => void> = [];
  constructor(o: RunnerOptions) { this.#o = o; }

  onEnd(fn: (job: JobRecord) => void): void { this.#ends.push(fn); }
  get(id: string): JobRecord | undefined { return this.#jobs.get(id); }
  list(day?: string): JobRecord[] { return [...this.#jobs.values()].filter((j) => !day || j.day === day).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  running(): JobRecord[] { return [...this.#jobs.values()].filter((j) => j.state === 'running'); }
  logTail(id: string, n = 200): unknown[] {
    const j = this.#jobs.get(id); if (!j) return [];
    const text = this.#o.store.read(`${jobsDir(j.day)}/${j.id}.jsonl`) ?? '';
    return text.trim().split('\n').slice(-n).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  }

  submit(input: SubmitInput): JobRecord {
    const type = (input.type ?? 'task') as JobType;
    if (!(JOB_TYPES as readonly string[]).includes(type)) throw new Refused('bad-type', `unknown job type: ${input.type}`);
    const text = String(input.text ?? '').trim();
    if (!text || text.length > 8000) throw new Refused('bad-text', 'a job needs a text of 1 to 8000 characters');
    if (!fs.existsSync(path.join(this.#o.workspace, '.joserah', 'config.json'))) throw new Refused('no-workspace', 'there is no workspace here yet — finish the setup wizard first');
    const cfg = this.#o.config();
    const t = now();
    const id = `j-${localDay(t).replaceAll('-', '')}-${hhmm(t).replace(':', '')}-${crypto.randomBytes(3).toString('hex')}`;
    const job: JobRecord = { id, day: localDay(t), type, target: 'server', text, state: 'queued', createdAt: t.toISOString(),
      model: input.model ?? modelFor(cfg, type), budgetUsd: input.budgetUsd ?? cfg.jobBudgetUsd, rowTitle: this.#titleFor(text, t), turns: 0,
      parentId: input.parentId, resumeSessionId: input.resumeSessionId, allowTools: input.allowTools, fallbackOf: input.fallbackOf, pointers: input.pointers };
    this.#jobs.set(id, job);
    this.#save(job);
    this.#o.tracker.row({ title: job.rowTitle, state: 'wait', small: JOB_TEXT[this.#o.lang].queued, url: this.#o.jobUrl(id), label: JOB_TEXT[this.#o.lang].page });
    this.#queue.push(id);
    this.#o.bus.publish({ type: 'jobs' });
    queueMicrotask(() => this.#pump());
    return job;
  }

  reply(id: string, text: string): JobRecord {
    const p = this.#jobs.get(id);
    if (!p) throw new Refused('not-found', `no job ${id}`);
    if (!p.sessionId) return this.submit({ type: p.type, text, parentId: id, pointers: [`${jobsDir(p.day)}/${p.id}.md`] });
    return this.submit({ type: p.type, text, parentId: id, resumeSessionId: p.sessionId });
  }

  approve(id: string): JobRecord {
    const p = this.#jobs.get(id);
    if (!p) throw new Refused('not-found', `no job ${id}`);
    if (RESTRICTED_TYPES.includes(p.type)) throw new Refused('restricted', `${p.type} jobs keep their fixed tools`);
    if (p.state !== 'needs-approval' || !p.denials?.length) throw new Refused('not-waiting', 'this job is not waiting for an approval');
    return this.submit({ type: p.type, text: `The owner allowed: ${p.denials.join(', ')}. Continue the job.`, parentId: id, resumeSessionId: p.sessionId, allowTools: p.denials });
  }

  async cancel(id: string): Promise<JobRecord | undefined> {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    if (job.state === 'queued') {
      this.#queue = this.#queue.filter((q) => q !== id);
      job.state = 'cancelled'; job.endedAt = now().toISOString();
      this.#save(job); this.#digest(job); this.#closeRow(job); this.#o.bus.publish({ type: 'jobs' });
      return job;
    }
    const live = this.#live.get(id);
    if (live) { live.stop = 'cancel'; await live.run.cancel(); }
    return job;
  }

  recover(): void {
    const base = this.#o.store.abs('.joserah/desk/jobs');
    let days: string[] = [];
    try { days = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-7); } catch { /* no jobs yet */ }
    const queued: JobRecord[] = [];
    for (const d of days) for (const f of fs.readdirSync(path.join(base, d)).filter((n) => n.endsWith('.job.json'))) {
      const job = this.#o.store.readJson<JobRecord>(`${jobsDir(d)}/${f}`);
      if (!job?.id) continue;
      this.#jobs.set(job.id, job);
      if (job.state === 'running') {
        job.state = 'interrupted'; job.error = 'the server restarted while the job ran'; job.endedAt = now().toISOString();
        this.#save(job); this.#digest(job); this.#closeRow(job);
        this.#o.tracker.crew({ role: roleFor(job.type), job: job.rowTitle, state: 'idle' });
      } else if (job.state === 'queued') queued.push(job);
    }
    this.#queue.push(...queued.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((j) => j.id));
    this.#pump();
  }

  idle(): Promise<void> { return this.#isIdle() ? Promise.resolve() : new Promise((r) => this.#idleWaiters.push(r)); }
  #isIdle(): boolean { return this.#queue.length === 0 && this.#active.size === 0; }
  #checkIdle(): void { if (this.#isIdle()) for (const w of this.#idleWaiters.splice(0)) w(); }

  #titleFor(text: string, t: Date): string {
    const short = text.replace(/\s+/g, ' ').slice(0, 70);
    const base = `${short}${text.length > 70 ? '…' : ''} · ${hhmm(t)}`;
    const taken = new Set([...this.#jobs.values()].filter((j) => j.day === localDay(t)).map((j) => j.rowTitle.toLowerCase()));
    let title = base; for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${base} (${n})`;
    return title;
  }

  #save(job: JobRecord): void { this.#o.store.writeJson(`${jobsDir(job.day)}/${job.id}.job.json`, job); }
  #emit(job: JobRecord, event: JobEventView): void { this.#o.bus.publish({ type: 'job', id: job.id, event }); }

  #pump(): void {
    const max = this.#o.config().maxConcurrentJobs;
    while (this.#active.size < max && this.#queue.length) {
      const id = this.#queue.shift()!;
      const job = this.#jobs.get(id);
      if (!job || job.state !== 'queued') continue;
      this.#active.add(id);
      if (this.#active.size > 1) for (const a of this.#active) { const j = this.#jobs.get(a); if (j) j.overlap = true; }
      void this.#run(job).catch((e: Error) => { job.state = 'failed'; job.error = `server error: ${e.message}`; this.#finish(job); })
        .finally(() => { this.#active.delete(id); this.#pump(); this.#checkIdle(); });
    }
    this.#checkIdle();
  }

  async #run(job: JobRecord): Promise<void> {
    const cp = (this.#o.checkpoint ?? noCheckpoint).before(job);
    if (!cp.ok) { job.state = 'refused'; job.error = cp.reason; return this.#finish(job); }
    job.checkpoint = cp.commit || undefined;
    job.state = 'running'; job.startedAt = now().toISOString();
    this.#save(job);
    const T = JOB_TEXT[this.#o.lang];
    this.#o.tracker.row({ title: job.rowTitle, state: 'run', small: T.running, url: this.#o.jobUrl(job.id), label: T.page });
    this.#o.tracker.crew({ role: roleFor(job.type), job: job.rowTitle, state: 'work', row: job.rowTitle });
    this.#emit(job, { kind: 'state', state: 'running' });
    const cfg = this.#o.config();
    const ej: EngineJob = { id: job.id, type: job.type, target: 'server', model: job.model, cwd: this.#o.workspace, budgetUsd: job.budgetUsd,
      brief: job.resumeSessionId ? job.text : composeBrief({ task: job.text, type: job.type, pointers: job.pointers }),
      resumeSessionId: job.resumeSessionId, restricted: RESTRICTED_TYPES.includes(job.type), writeArea: writeAreaFor(job.type), allowTools: job.allowTools };
    const run = this.#o.engine.start(ej);
    const live: { run: EngineRun; stop?: 'cancel' | 'timeout' | 'turn-limit' } = { run };
    this.#live.set(job.id, live);
    const timer = setTimeout(() => { live.stop = 'timeout'; void run.cancel(); }, cfg.jobTimeoutMin * 60000);
    const log = `${jobsDir(job.day)}/${job.id}.jsonl`;
    let result: Extract<EngineEvent, { kind: 'result' }> | null = null;
    const denied = new Set<string>();
    let stderr = '';
    for await (const { raw, event } of run.events) {
      if (event.kind === 'init' && !job.sessionId) { job.sessionId = event.sessionId; job.cliVersion = event.cliVersion; this.#save(job); }
      if (raw) this.#o.store.append(log, redact(raw) + '\n');
      if (event.kind === 'stderr') { stderr += event.text; this.#o.store.append(log, JSON.stringify({ type: 'stderr', text: redact(event.text) }) + '\n'); }
      else if (event.kind === 'text') this.#emit(job, { kind: 'text', text: redact(event.text) });
      else if (event.kind === 'tool') this.#emit(job, { kind: 'tool', name: event.name });
      else if (event.kind === 'turn') { job.turns += 1; if (job.turns > cfg.jobMaxTurns && !live.stop) { live.stop = 'turn-limit'; void run.cancel(); } }
      else if (event.kind === 'denied') denied.add(event.tool);
      else if (event.kind === 'result') { result = event; for (const d of event.denials) denied.add(d); }
    }
    const exit = await run.done;
    clearTimeout(timer);
    this.#live.delete(job.id);
    const r = result as Extract<EngineEvent, { kind: 'result' }> | null;
    job.denials = [...denied];
    job.costUsd = r?.costUsd ?? null;
    job.resultText = redact(r?.text ?? '');
    if (live.stop === 'cancel') job.state = 'cancelled';
    else if (live.stop === 'timeout') { job.state = 'failed'; job.error = `timeout after ${cfg.jobTimeoutMin} min`; }
    else if (live.stop === 'turn-limit') { job.state = 'failed'; job.error = `turn limit ${cfg.jobMaxTurns} reached`; }
    else if (exit.spawnError) { job.state = 'failed'; job.error = `could not start Claude Code: ${exit.spawnError}`; }
    else if (!r) { job.state = 'failed'; job.error = redact(firstLine(stderr)) || `ended without a result (exit ${exit.code})`; }
    else if (r.subtype === 'error_max_budget_usd') { job.state = 'failed'; job.error = `money cap $${job.budgetUsd.toFixed(2)} reached`; }
    else if (denied.size) job.state = 'needs-approval';
    else if (!r.ok) { job.state = 'failed'; job.error = r.subtype || 'error'; }
    else job.state = 'done';
    this.#finish(job);
    if (job.state === 'failed' && job.resumeSessionId && !job.sessionId && !job.fallbackOf && job.parentId) {
      const p = this.#jobs.get(job.parentId);
      this.submit({ type: job.type, text: job.text, fallbackOf: job.id, parentId: job.parentId, pointers: p ? [`${jobsDir(p.day)}/${p.id}.md`] : [] });
    }
  }

  #finish(job: JobRecord): void {
    if (job.startedAt) { // a job that never started has nothing to diff
      const a = (this.#o.checkpoint ?? noCheckpoint).after(job);
      job.changed = a.changed; job.flags = [...(job.flags ?? []), ...a.flags];
    }
    job.endedAt = now().toISOString();
    for (const fn of this.#ends) { try { fn(job); } catch (e) { job.flags = [...(job.flags ?? []), `bookkeeping failed: ${(e as Error).message}`]; } }
    this.#save(job); this.#digest(job); this.#closeRow(job);
    this.#o.tracker.crew({ role: roleFor(job.type), job: job.rowTitle, state: 'idle' });
    this.#emit(job, { kind: 'result', ok: job.state === 'done', text: job.resultText || job.error || '', costUsd: job.costUsd ?? null });
    this.#o.bus.publish({ type: 'jobs' });
  }

  #closeRow(job: JobRecord): void {
    const T = JOB_TEXT[this.#o.lang];
    const url = this.#o.jobUrl(job.id);
    const cost = typeof job.costUsd === 'number' ? ` · ${T.cost} $${job.costUsd.toFixed(4)}` : '';
    let state: 'ok' | 'you' = 'you'; let small: string;
    if (job.state === 'done' && job.flags?.length) small = `${T.check}: ${job.flags.slice(0, 3).join('; ')}. ${T.checkNext}`;
    else if (job.state === 'done' && !job.resultText) small = T.empty;
    else if (job.state === 'done') { state = 'ok'; small = `${firstLine(job.resultText ?? '')}${cost}`; }
    else if (job.state === 'needs-approval') small = `${T.approval}: ${(job.denials ?? []).join(', ')}. ${T.approvalNext}`;
    else if (job.state === 'interrupted') small = T.interrupted;
    else if (job.state === 'cancelled') small = T.cancelled;
    else small = `${T.stopped}: ${job.error ?? job.state}. ${T.next}`;
    this.#o.tracker.row({ title: job.rowTitle, state, small, url, label: T.page });
  }

  #digest(job: JobRecord): void {
    const lines = [`# Job ${job.id}`, '',
      `- Task: ${job.text.replace(/\s+/g, ' ').slice(0, 300)}`,
      `- Type: ${job.type} · model ${job.model} · target ${job.target}${job.parentId ? ` · follows ${job.parentId}` : ''}`,
      `- State: ${job.state}${job.error ? ` — ${job.error}` : ''}`,
      `- Started: ${job.startedAt ?? '-'} · ended: ${job.endedAt ?? '-'} · tool turns: ${job.turns}`,
      `- Result: ${(job.resultText ?? '').replace(/\s+/g, ' ').slice(0, 1000) || '-'}`,
      `- Changed files: ${job.changed?.length ? job.changed.map((c) => `${c.status} ${c.path}`).join(', ') : 'none'}`,
      ...(job.flags?.length ? [`- Flags: ${job.flags.join('; ')}`] : []),
      `- Cost estimate: ${typeof job.costUsd === 'number' ? `$${job.costUsd.toFixed(4)} (CLI estimate)` : 'unknown'}`,
      `- Claude Code: ${job.cliVersion ?? 'unknown'}`, `- Session: ${job.sessionId ?? '-'}`, ''];
    this.#o.store.write(`${jobsDir(job.day)}/${job.id}.md`, lines.join('\n'));
  }
}
```


- [ ] **Step 7: Wire it into the server**

`server/src/deps.ts` — add `engine: Engine; jobs: JobRunner;` (type imports). In `server/test/helpers.ts` `baseDeps`, default `engine: fakeEngine()` and `jobs` to a `JobRunner` built like `runnerFor` (so route tests have one); keep `runnerFor` for job tests.

`server/main.ts` — after the store:

```ts
import { ClaudeCliEngine } from './src/engines/claude-cli.ts';
import { JobRunner, ensureJobIgnores, rotateLogs } from './src/jobs.ts';
import { cliTracker } from './src/tracker-bridge.ts';
import { workspaceLang } from './src/config.ts';
// ...
const engine = new ClaudeCliEngine({ command: process.env.JOSERAH_CLAUDE_BIN || 'claude' });
const lang = workspaceLang(workspace);
const jobs = new JobRunner({ workspace, store, bus, engine, config: () => cfg, tracker: cliTracker(workspace, lang), jobUrl: (id) => `${baseUrl}/jobs/${id}`, lang });
// deps gets: engine, jobs
// in the serve() callback:
if (ensureJobIgnores(workspace)) console.log('Added the job-log lines to the workspace .gitignore.');
rotateLogs(store, cfg.rawLogDays);
jobs.recover();
const refresh = async () => { const h = await engine.health(); deps.health.signedIn = h.signedIn; deps.engineHealth = h; };
void refresh(); setInterval(() => void refresh(), 5 * 60000).unref();
jobs.onEnd((j) => { deps.health.lastJobOk = j.state === 'done'; });
```

and add `engineHealth: EngineHealth | null` to `AppDeps` (default `null` in `baseDeps`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `briefs` (2), `tracker-bridge` (3), `jobs` (14) and every earlier test.

- [ ] **Step 9: Commit**

```bash
git add server/src server/main.ts server/test
git commit -m "server: job runner with a persisted queue, limits, redacted logs, digests and Tracker rows"
```

---

### Task 10: Checkpoint before, diff after (§8)

Jobs write through the CLI, not through the Store, so the Store is not the only writer while a job runs. Before each job the server commits the workspace (a checkpoint the owner can return to); after it, it lists what changed and raises an owner row for any deletion or any write outside the job type's area. `imports/` is outside git (rule 4, outside the backup), so it gets its own size-and-mtime manifest.

**Files:**
- Create: `server/src/checkpoint.ts`
- Modify: `server/main.ts` (pass `new GitCheckpointer(workspace)` to the runner), `server/test/helpers.ts` (`runnerFor` accepts `git: true` and a checkpointer)
- Test: `server/test/checkpoint.test.ts`

**Interfaces:**
- Consumes: `Checkpointer`, `ChangedFile`, `JobRecord`, `writeAreaFor` (Task 9); `RESTRICTED_TYPES`.
- Produces: `changed` never lists `.joserah/desk/jobs/**` (the server's own records) and lists each path once; `PROTECTED: string[]`; `SERVER_WRITES: string[]`; `matches(glob: string, p: string): boolean` (`dir/**` = the folder and everything under it; anything else exact); `assess(type: JobType, changed: ChangedFile[]): string[]`; `class GitCheckpointer implements Checkpointer { constructor(workspace: string) }`. Checkpoint commits are authored `Joserah Server <server@joserah.invalid>`, message `checkpoint: before job <id>` + blank line + `Joserah Server`; hooks are not skipped.

- [ ] **Step 1: Write the failing tests**

`server/test/checkpoint.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assess, matches, GitCheckpointer } from '../src/checkpoint.ts';
import { runnerFor, git } from './helpers.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const rowOf = (ws: string, title: string) => { const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8')); return (Array.isArray(j) ? j : j.rows).find((r: { title: string }) => r.title === title); };

test('assess: deletions and writes outside the area are flagged; server writes are not', () => {
  assert.ok(matches('imports/**', 'imports/a/b.pdf'));
  assert.ok(!matches('imports/**', 'importsx/a'));
  assert.ok(matches('AGENTS.md', 'AGENTS.md'));
  assert.deepEqual(assess('ingest', [{ status: 'A', path: '.joserah/knowledge/wiki/topics/x.md' }]), []);
  assert.deepEqual(assess('ingest', [{ status: 'M', path: 'notes/x.md' }]), ['wrote outside its area: notes/x.md']);
  assert.deepEqual(assess('task', [{ status: 'M', path: 'notes/x.md' }]), []);
  assert.deepEqual(assess('task', [{ status: 'M', path: 'AGENTS.md' }]), ['wrote outside its area: AGENTS.md']);
  assert.deepEqual(assess('task', [{ status: 'D', path: 'notes/x.md' }]), ['deleted notes/x.md']);
  assert.deepEqual(assess('task', [{ status: 'M', path: '.joserah/desk/jobs/2026-10-06/j.md' }, { status: 'M', path: '.joserah/desk/artifacts/2026-10-06/daily-tracker/rows.json' }]), []);
});

test('the checkpoint commits the owner\'s pending work before the job', (t) => {
  const { ws, runner } = runnerFor(t, { git: true });
  void runner;
  fs.writeFileSync(path.join(ws, 'pending.md'), 'unsaved work');
  const cp = new GitCheckpointer(ws);
  const r = cp.before({ id: 'j-1' } as never);
  assert.ok(r.ok);
  assert.match(git(ws, 'log', '-1', '--format=%an|%s'), /^Joserah Server\|checkpoint: before job j-1/);
  assert.equal(git(ws, 'status', '--porcelain'), '');
});

test('a deletion raises an owner row', async (t) => {
  const { ws, runner } = runnerFor(t, { git: true, env: { FAKE_CLAUDE_DELETE: 'notes-to-delete.md' }, checkpointer: true });
  fs.writeFileSync(path.join(ws, 'notes-to-delete.md'), 'x'); git(ws, 'add', '-A'); git(ws, 'commit', '-q', '-m', 'n');
  const job = runner.submit({ type: 'task', text: 'tidy' });
  await runner.idle();
  const j = runner.get(job.id)!;
  assert.equal(j.state, 'done');
  assert.ok(j.changed!.some((c) => c.status === 'D' && c.path === 'notes-to-delete.md'));
  assert.deepEqual(j.flags, ['deleted notes-to-delete.md']);
  const row = rowOf(ws, job.rowTitle);
  assert.equal(row.state, 'you');
  assert.match(row.small, /deleted notes-to-delete\.md/);
});

test('an ingest job writing outside the knowledge folder is flagged', async (t) => {
  const { runner } = runnerFor(t, { git: true, env: { FAKE_CLAUDE_WRITE: 'notes/escape.md:hi;.joserah/knowledge/wiki/topics/ok.md:fine' }, checkpointer: true });
  const job = runner.submit({ type: 'ingest', text: 'ingest x' });
  await runner.idle();
  const j = runner.get(job.id)!;
  assert.deepEqual(j.changed!.map((c) => c.path).filter((p) => !p.startsWith('.joserah/desk/')).sort(), ['.joserah/knowledge/wiki/topics/ok.md', 'notes/escape.md']);
  assert.deepEqual(j.flags, ['wrote outside its area: notes/escape.md']);
});

test('changes inside imports/ are seen although imports/ is not in git', async (t) => {
  const { ws, runner } = runnerFor(t, { git: true, env: { FAKE_CLAUDE_DELETE: 'imports/2026-10-01-upload/a.txt' }, checkpointer: true });
  fs.mkdirSync(path.join(ws, 'imports/2026-10-01-upload'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'imports/2026-10-01-upload/a.txt'), 'raw');
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  assert.ok(runner.get(job.id)!.flags!.includes('deleted imports/2026-10-01-upload/a.txt'));
});

test('a workspace that is not a git repository refuses jobs with the reason', async (t) => {
  const { ws, runner } = runnerFor(t, { git: false, checkpointer: true });
  const job = runner.submit({ type: 'task', text: 'x' });
  await runner.idle();
  const j = runner.get(job.id)!;
  assert.equal(j.state, 'refused');
  assert.match(j.error!, /not a git repository/);
  assert.equal(rowOf(ws, job.rowTitle).state, 'you');
});
```

Update `runnerFor` in `server/test/helpers.ts`: accept `checkpointer?: boolean` and pass `checkpoint: o.checkpointer ? new GitCheckpointer(ws) : o.checkpoint`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/checkpoint.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/checkpoint.ts`.

- [ ] **Step 3: Write `server/src/checkpoint.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Checkpointer, ChangedFile, JobRecord } from './jobs.ts';
import { writeAreaFor } from './jobs.ts';
import { RESTRICTED_TYPES, type JobType } from './config.ts';
import { rel } from './paths.ts';

export const PROTECTED = ['imports/**', 'keys/**', '.joserah/config.json', '.joserah/server.json', '.claude/**', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', '.gitignore'];
export const SERVER_WRITES = ['.joserah/desk/jobs/**', '.joserah/desk/artifacts/**'];

export function matches(glob: string, p: string): boolean {
  if (glob.endsWith('/**')) { const d = glob.slice(0, -3); return p === d || p.startsWith(`${d}/`); }
  return p === glob;
}

export function assess(type: JobType, changed: ChangedFile[]): string[] {
  const flags: string[] = [];
  const area = writeAreaFor(type);
  for (const c of changed) {
    if (SERVER_WRITES.some((g) => matches(g, c.path))) continue;
    if (c.status === 'D') { flags.push(`deleted ${c.path}`); continue; }
    const outside = RESTRICTED_TYPES.includes(type) ? !area.some((a) => matches(`${a}/**`, c.path)) : PROTECTED.some((g) => matches(g, c.path));
    if (outside) flags.push(`wrote outside its area: ${c.path}`);
  }
  return flags;
}

const ID = ['-c', 'user.name=Joserah Server', '-c', 'user.email=server@joserah.invalid'];

export class GitCheckpointer implements Checkpointer {
  #ws: string;
  #imports = new Map<string, Map<string, string>>();
  constructor(workspace: string) { this.#ws = workspace; }

  #git(...args: string[]) { return spawnSync('git', [...ID, ...args], { cwd: this.#ws, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); }

  #manifest(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string) => {
      let es: fs.Dirent[]; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        if (out.size > 20000) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) { const s = fs.statSync(p); out.set(rel(this.#ws, p), `${s.size}:${Math.round(s.mtimeMs)}`); }
      }
    };
    walk(path.join(this.#ws, 'imports'));
    return out;
  }

  before(job: JobRecord): { ok: true; commit: string } | { ok: false; reason: string } {
    if (this.#git('rev-parse', '--is-inside-work-tree').status !== 0) return { ok: false, reason: 'the workspace is not a git repository — the setup wizard can create one' };
    const add = this.#git('add', '-A');
    if (add.status !== 0) return { ok: false, reason: `checkpoint failed: ${(add.stderr || '').trim().split('\n')[0]}` };
    const c = this.#git('commit', '--allow-empty', '-q', '-m', `checkpoint: before job ${job.id}`, '-m', 'Joserah Server');
    if (c.status !== 0) return { ok: false, reason: `checkpoint commit failed: ${(c.stderr || c.stdout || '').trim().split('\n')[0]}` };
    this.#imports.set(job.id, this.#manifest());
    return { ok: true, commit: this.#git('rev-parse', 'HEAD').stdout.trim() };
  }

  after(job: JobRecord): { changed: ChangedFile[]; flags: string[] } {
    const changed: ChangedFile[] = [];
    if (job.checkpoint) {
      const d = this.#git('diff', '--name-status', '--no-renames', '-z', job.checkpoint);
      const parts = d.stdout.split('\0').filter(Boolean);
      for (let i = 0; i + 1 < parts.length; i += 2) changed.push({ status: (parts[i][0] as ChangedFile['status']) ?? 'M', path: parts[i + 1] });
      for (const p of this.#git('ls-files', '--others', '--exclude-standard', '-z').stdout.split('\0').filter(Boolean)) changed.push({ status: 'A', path: p });
    }
    const before = this.#imports.get(job.id);
    if (before) {
      const now = this.#manifest();
      for (const [p, sig] of now) if (!before.has(p)) changed.push({ status: 'A', path: p }); else if (before.get(p) !== sig) changed.push({ status: 'M', path: p });
      for (const p of before.keys()) if (!now.has(p)) changed.push({ status: 'D', path: p });
      this.#imports.delete(job.id);
    }
    // The job records are the server's own bookkeeping, never the job's work; one entry per path.
    const seen = new Set<string>();
    const out = changed.filter((c) => !matches('.joserah/desk/jobs/**', c.path) && !seen.has(c.path) && seen.add(c.path));
    return { changed: out, flags: assess(job.type, out) };
  }
}
```

`server/main.ts`: pass `checkpoint: new GitCheckpointer(workspace)` to `new JobRunner({...})`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 server/test/checkpoint.test.ts server/test/jobs.test.ts`
Expected: PASS (6 + 14).

- [ ] **Step 5: Commit**

```bash
git add server/src/checkpoint.ts server/main.ts server/test
git commit -m "server: checkpoint commit before each job, changed files and owner rows after"
```

---

### Task 11: Job routes, the home screen and the job page

**Files:**
- Create: `server/src/routes/jobs.ts`, `server/src/routes/home.ts`, `server/src/client.ts`
- Modify: `server/src/routes/pages.ts` (remove its `/` route — home owns it), `server/src/app.ts` (register `jobsRoutes`, `homeRoutes`)
- Test: `server/test/jobs-routes.test.ts`, `server/test/home.test.ts`

**Interfaces:**
- Consumes: `JobRunner`, `Refused`, `JobRecord` (Task 9); `listPages` (Task 5); `shell`, `esc`, `LABELS` (Task 4); `deps.engineHealth`.
- Produces:
  - API: `POST /api/jobs {text, type?}` → `201 {id}` | `400 {error:'bad-type'|'bad-text'}` | `503 {error:'engine', reason}`; `GET /api/jobs[?day=]` → `{jobs: JobRecord[]}`; `GET /api/jobs/:id` → `{job, stream: StreamLine[]}`; `POST /api/jobs/:id/cancel|retry|approve` and `POST /api/jobs/:id/reply {text}` → `200/201 {id}` | `404 {error:'not-found'}` | `403 {error:'restricted'}` | `409 {error:'not-waiting'}`.
  - `type StreamLine = { kind: 'text' | 'tool'; text: string }`; `streamLines(entries: unknown[]): StreamLine[]` (in `routes/jobs.ts`).
  - Pages: `GET /` (home: job box, running jobs with their live last line, the live Tracker, the page list), `GET /jobs` (today's and recent jobs), `GET /jobs/:id` (the job page).
  - `client.ts`: `APP_JS` served at `/_/app.js`: posts the job box, follows `/events` and updates elements with `data-job="<id>"` (`.state`, `.last`), appends to `ol.stream[data-job]`.

- [ ] **Step 1: Write the failing tests**

`server/test/jobs-routes.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedIn, ORIGIN } from './helpers.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const post = (cookie: string, body?: unknown) => ({ method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('a job given from the browser runs and can be read back', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  deps.engineHealth = { installed: true, version: '2.1.289', signedIn: true, detail: 'signed in' };
  const r = await app.request('/api/jobs', post(cookie, { text: 'Summarise the week', type: 'digest' }));
  assert.equal(r.status, 201);
  const { id } = await r.json();
  await deps.jobs.idle();
  const g = await (await app.request(`/api/jobs/${id}`, { headers: { cookie } })).json();
  assert.equal(g.job.state, 'done');
  assert.equal(g.job.target, 'server');
  assert.ok(g.stream.some((l: { kind: string; text: string }) => l.kind === 'text' && /Done\./.test(l.text)));
  assert.ok(!JSON.stringify(g).includes('hunter2hunter2'));
});

test('jobs cannot start while Claude Code is not signed in', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  deps.engineHealth = { installed: true, version: '2.1.289', signedIn: false, detail: 'not signed in' };
  const r = await app.request('/api/jobs', post(cookie, { text: 'x' }));
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'engine', reason: 'not signed in' });
});

test('refusals map to statuses', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  assert.equal((await app.request('/api/jobs', post(cookie, { text: 'x', type: 'nope' }))).status, 400);
  assert.equal((await app.request('/api/jobs', post(cookie, { text: '' }))).status, 400);
  assert.equal((await app.request('/api/jobs/j-nope', { headers: { cookie } })).status, 404);
  assert.equal((await app.request('/api/jobs/j-nope/cancel', post(cookie))).status, 404);
  const q = deps.jobs.submit({ type: 'query', text: 'q' }); await deps.jobs.idle();
  assert.equal((await app.request(`/api/jobs/${q.id}/approve`, post(cookie))).status, 403);
  const a = deps.jobs.submit({ type: 'task', text: 't' }); await deps.jobs.idle();
  assert.equal((await app.request(`/api/jobs/${a.id}/approve`, post(cookie))).status, 409);
});

test('reply and retry start follow-up jobs', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const a = deps.jobs.submit({ type: 'task', text: 'first' }); await deps.jobs.idle();
  const r1 = await app.request(`/api/jobs/${a.id}/reply`, post(cookie, { text: 'and more' }));
  assert.equal(r1.status, 201);
  const r2 = await app.request(`/api/jobs/${a.id}/retry`, post(cookie));
  assert.equal(r2.status, 201);
  await deps.jobs.idle();
  const kids = deps.jobs.list().filter((j) => j.parentId === a.id);
  assert.equal(kids.length, 2);
});
```

`server/test/home.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedIn, trackerPage } from './helpers.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('home has the job box, the live Tracker, running jobs and the pages', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  trackerPage(deps.workspace, DAY);
  const html = await (await app.request('/', { headers: { cookie } })).text();
  assert.match(html, /<form id="job"/);
  assert.match(html, /<iframe[^>]+src="\/p\/tracker"/);
  assert.match(html, /<ul id="running"/);
  assert.match(html, /\/p\/2026-10-06\/daily-tracker\//);
  assert.match(html, /<script src="\/_\/app\.js"><\/script>/);
  assert.match(html, /width=device-width/);
});

test('the job box is disabled with the reason when Claude Code is not ready', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  deps.engineHealth = { installed: false, version: null, signedIn: false, detail: 'Claude Code is not installed or not on PATH' };
  const html = await (await app.request('/', { headers: { cookie } })).text();
  assert.match(html, /<fieldset disabled>/);
  assert.match(html, /Claude Code is not installed or not on PATH/);
});

test('the job page escapes what the owner typed and labels the cost an estimate', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const j = deps.jobs.submit({ type: 'task', text: '<img src=x onerror=alert(1)> do it' });
  await deps.jobs.idle();
  const html = await (await app.request(`/jobs/${j.id}`, { headers: { cookie } })).text();
  assert.ok(!html.includes('<img src=x onerror'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; do it/);
  assert.match(html, /\$0\.0123 \(estimate\)/);
  assert.match(html, /<ol class="stream" data-job="/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/jobs-routes.test.ts server/test/home.test.ts`
Expected: FAIL — 404s (routes missing).

- [ ] **Step 3: Write the implementation**

`server/src/routes/jobs.ts`:

```ts
import type { Context } from 'hono';
import type { App, Env } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { jsonError } from '../app.ts';
import { Refused } from '../jobs.ts';

export type StreamLine = { kind: 'text' | 'tool'; text: string };
export function streamLines(entries: unknown[]): StreamLine[] {
  const out: StreamLine[] = [];
  for (const e of entries) {
    const o = (e ?? {}) as { type?: string; message?: { content?: Array<{ type?: string; text?: string; name?: string }> } };
    if (o.type !== 'assistant') continue;
    for (const b of o.message?.content ?? []) {
      if (b.type === 'text' && b.text) out.push({ kind: 'text', text: b.text });
      if (b.type === 'tool_use' && b.name) out.push({ kind: 'tool', text: b.name });
    }
  }
  return out;
}

function refusal(c: Context<Env>, e: unknown) {
  if (!(e instanceof Refused)) throw e;
  const status = e.code === 'not-found' ? 404 : e.code === 'restricted' ? 403 : e.code === 'not-waiting' ? 409 : e.code === 'daily-budget' ? 429 : 400;
  return jsonError(c, status, e.code, { message: e.message });
}

export function register(app: App, deps: AppDeps): void {
  const engineReady = (c: Context<Env>) => {
    const h = deps.engineHealth;
    return h && (!h.installed || !h.signedIn) ? jsonError(c, 503, 'engine', { reason: h.detail }) : null;
  };
  app.post('/api/jobs', async (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    let b: { text?: unknown; type?: unknown };
    try { b = await c.req.json(); } catch { return jsonError(c, 400, 'bad-text'); }
    try { return c.json({ id: deps.jobs.submit({ text: String(b.text ?? ''), type: typeof b.type === 'string' ? b.type : undefined }).id }, 201); } catch (e) { return refusal(c, e); }
  });
  app.get('/api/jobs', (c) => c.json({ jobs: deps.jobs.list(c.req.query('day')) }));
  app.get('/api/jobs/:id', (c) => {
    const j = deps.jobs.get(c.req.param('id'));
    if (!j) return jsonError(c, 404, 'not-found');
    return c.json({ job: j, stream: streamLines(deps.jobs.logTail(j.id, 400)) });
  });
  app.post('/api/jobs/:id/cancel', async (c) => {
    const j = await deps.jobs.cancel(c.req.param('id'));
    return j ? c.json({ id: j.id }) : jsonError(c, 404, 'not-found');
  });
  app.post('/api/jobs/:id/reply', async (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    let b: { text?: unknown };
    try { b = await c.req.json(); } catch { return jsonError(c, 400, 'bad-text'); }
    try { return c.json({ id: deps.jobs.reply(c.req.param('id'), String(b.text ?? '')).id }, 201); } catch (e) { return refusal(c, e); }
  });
  app.post('/api/jobs/:id/retry', (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    const p = deps.jobs.get(c.req.param('id'));
    if (!p) return jsonError(c, 404, 'not-found');
    try { return c.json({ id: deps.jobs.submit({ type: p.type, text: p.text, parentId: p.id, pointers: p.pointers }).id }, 201); } catch (e) { return refusal(c, e); }
  });
  app.post('/api/jobs/:id/approve', (c) => {
    const blocked = engineReady(c); if (blocked) return blocked;
    try { return c.json({ id: deps.jobs.approve(c.req.param('id')).id }, 201); } catch (e) { return refusal(c, e); }
  });
}
```

`server/src/client.ts`:

```ts
// Home and job pages: the job box and the live job lines. ES5, textContent only.
export const APP_JS = `(function(){
var D=document;function $(s,r){return (r||D).querySelector(s)}function all(s){return D.querySelectorAll(s)}
function post(url,body){return fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(j){if(r.status===401)location.href='/login?next='+encodeURIComponent(location.pathname);if(!r.ok)throw j;return j})})}
var f=$('#job');if(f)f.addEventListener('submit',function(e){e.preventDefault();var t=$('textarea',f),ty=$('select',f),err=$('.err',f);err.textContent='';
post('/api/jobs',{text:t.value,type:ty?ty.value:'task'}).then(function(j){location.href='/jobs/'+j.id},function(x){err.textContent=(x&&(x.reason||x.message||x.error))||'error'})});
Array.prototype.forEach.call(all('button[data-act]'),function(b){b.addEventListener('click',function(){var id=b.getAttribute('data-id'),act=b.getAttribute('data-act'),body={};
if(act==='reply'){var ta=$('#reply-text');body.text=ta?ta.value:'';}post('/api/jobs/'+id+'/'+act,body).then(function(j){location.href='/jobs/'+j.id},function(x){alert((x&&(x.message||x.error))||'error')})})});
if(typeof EventSource==='undefined')return;var es=new EventSource('/events');
es.onmessage=function(m){var e;try{e=JSON.parse(m.data)}catch(x){return}
if(e.type==='job'){Array.prototype.forEach.call(all('[data-job="'+e.id+'"]'),function(el){var ev=e.event||{};
if(el.tagName==='OL'&&(ev.kind==='text'||ev.kind==='tool')){var li=D.createElement('li');li.className=ev.kind;li.textContent=ev.kind==='tool'?'· '+ev.name:ev.text;el.appendChild(li)}
var st=$('.state',el);if(st&&ev.kind==='state')st.textContent=ev.state;if(st&&ev.kind==='result')st.textContent=ev.ok?'done':'ended';
var last=$('.last',el);if(last&&(ev.kind==='text'||ev.kind==='tool'))last.textContent=ev.kind==='tool'?'· '+ev.name:String(ev.text).slice(0,160)})}
if(e.type==='jobs'&&$('#running')&&!($('#job textarea')&&$('#job textarea').value))location.reload()};
})();`;
```

`server/src/routes/home.ts`:

```ts
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import type { JobRecord } from '../jobs.ts';
import { JOB_TYPES, workspaceLang } from '../config.ts';
import { listPages } from '../pages.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { APP_JS } from '../client.ts';
import { streamLines } from './jobs.ts';

const CSS = '<style>#job textarea{min-height:6em}.jobs li,.stream li{padding:6px 0;border-bottom:1px solid var(--line)}.stream .tool{color:var(--muted)}iframe.trk{width:100%;height:70vh;border:1px solid var(--line)}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}</style>';
const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(4)}` : '—');

export function jobLine(j: JobRecord): string {
  return `<li data-job="${esc(j.id)}"><a href="/jobs/${esc(j.id)}">${esc(j.rowTitle)}</a> · <span class="state">${esc(j.state)}</span><br><span class="last muted"></span></li>`;
}

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  app.get('/_/app.js', (c) => c.body(APP_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }));
  app.get('/', (c) => {
    const L = LABELS[lang()]; const h = deps.engineHealth;
    const blocked = h && (!h.installed || !h.signedIn) ? h.detail : '';
    const running = deps.jobs.list().filter((j) => j.state === 'running' || j.state === 'queued');
    const pages = listPages(deps.workspace).map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> <span class="muted">${esc(p.day)}</span>${p.reports.map((r) => ` · <a href="${esc(p.url + encodeURIComponent(r))}">${esc(r)}</a>`).join('')}</li>`).join('');
    const body = `<h2>${esc(L.newJob)}</h2>
<form id="job"><fieldset${blocked ? ' disabled' : ''}>${blocked ? `<p class="err">${esc(L.disabled)}: ${esc(blocked)}</p>` : ''}
<textarea name="text" required maxlength="8000"></textarea>
<div class="row"><select name="type">${JOB_TYPES.map((t) => `<option${t === 'task' ? ' selected' : ''}>${t}</option>`).join('')}</select><button>${esc(L.send)}</button><span class="err"></span></div></fieldset></form>
<h2>${esc(L.running)}</h2><ul id="running" class="jobs">${running.length ? running.map(jobLine).join('') : `<li class="muted">${esc(L.none)}</li>`}</ul>
<h2>${esc(L.tracker)}</h2><iframe class="trk" src="/p/tracker" title="${esc(L.tracker)}"></iframe>
<h2>${esc(L.pages)}</h2><ul>${pages}</ul>`;
    return c.html(shell({ title: 'Joserah', lang: lang(), head: CSS, body: body + '<script src="/_/app.js"></script>' }));
  });
  app.get('/jobs', (c) => {
    const L = LABELS[lang()];
    return c.html(shell({ title: L.jobs, lang: lang(), head: CSS, body: `<h1>${esc(L.jobs)}</h1><ul class="jobs">${deps.jobs.list().slice(0, 100).map(jobLine).join('')}</ul><script src="/_/app.js"></script>` }));
  });
  app.get('/jobs/:id', (c) => {
    const L = LABELS[lang()]; const j = deps.jobs.get(c.req.param('id'));
    if (!j) return c.notFound();
    const lines = streamLines(deps.jobs.logTail(j.id, 400)).map((l) => `<li class="${l.kind}">${esc(l.kind === 'tool' ? `· ${l.text}` : l.text)}</li>`).join('');
    const btn = (act: string, label: string) => `<button data-act="${act}" data-id="${esc(j.id)}">${esc(label)}</button>`;
    const acts = [
      ...(j.state === 'running' || j.state === 'queued' ? [btn('cancel', L.cancel)] : []),
      ...(j.state === 'needs-approval' ? [btn('approve', L.approve)] : []),
      ...(['failed', 'interrupted', 'cancelled', 'refused'].includes(j.state) ? [btn('retry', L.retry)] : []),
    ].join(' ');
    const body = `<h1>${esc(j.rowTitle)}</h1>
<p data-job="${esc(j.id)}"><span class="state">${esc(j.state)}</span> · ${esc(j.type)} · ${esc(j.model)} · ${esc(money(j.costUsd))} (${esc(L.estimate)})${j.error ? ` · <span class="err">${esc(j.error)}</span>` : ''}</p>
<p>${esc(j.text)}</p><div class="row">${acts}</div>
${j.resultText ? `<h2>${esc(L.result)}</h2><p>${esc(j.resultText)}</p>` : ''}
${j.changed?.length ? `<h2>${esc(L.changed)}</h2><ul>${j.changed.map((f) => `<li>${esc(f.status)} ${esc(f.path)}</li>`).join('')}</ul>` : ''}
${j.flags?.length ? `<ul class="err">${j.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
<ol class="stream" data-job="${esc(j.id)}">${lines}</ol>
${['done', 'failed', 'needs-approval', 'interrupted'].includes(j.state) ? `<p><textarea id="reply-text" maxlength="8000"></textarea></p><p>${btn('reply', L.reply)}</p>` : ''}
<script src="/_/app.js"></script>`;
    return c.html(shell({ title: j.rowTitle, lang: lang(), head: CSS, body }));
  });
}
```

In `server/src/routes/pages.ts`, delete the `app.get('/', …)` block and the now-unused `listPages` import. In `createApp`, register `homeRoutes` and `jobsRoutes` after `eventsRoutes`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `jobs-routes` (4), `home` (3) and all earlier tests (the Task 5 `listPages` test is unaffected; no test used the old `/`).

- [ ] **Step 5: Commit**

```bash
git add server/src server/test
git commit -m "server: job routes, home screen with job box and live Tracker, job page"
```

---

### Task 12: Knowledge wiki — library, CLI and browser (§6)

The wiki is `.joserah/knowledge/` (LLM-owned pages with claim lines); raw sources are `imports/` (never edited); the schema is `AGENTS.md` + `conventions.md`. This task makes the wiki visible and gives the zero-token operations one library that both the server and the terminal use.

**Files:**
- Create: `tools/lib/wiki.js`, `tools/wiki.js`, `tests/wiki.test.js`
- Create: `server/src/routes/wiki.ts`
- Modify: `server/src/cjs.ts` (add `wikiLib`), `server/src/app.ts` (register), `server/src/client.ts` (ask and upload forms — Task 13 uses them; add the handlers now)
- Test: `server/test/wiki.test.ts`

**Interfaces:**
- Consumes: `tools/lib/note-format.js` (`parseFrontmatter`, `parseClaims`, `findClaimAnomalies`, `extractWikilinks`); `renderMarkdown`, `safeHref` (Task 5).
- Produces:
  - `tools/lib/wiki.js` (CommonJS, no dependencies): `KNOWLEDGE = '.joserah/knowledge'`, `SIZE_LIMIT = 48 * 1024`, `STALE_RAW_DAYS = 7`; `scan(workspace) → Page[]` with `Page = { rel, title, type, description, body, links: string[], wikilinks: string[], bytes, mtimeMs, sha1, hasFrontmatter, unclosed }` (`rel` relative to the knowledge folder, `/` separators); `resolveLink(fromRel, href) → { kind: 'page', rel } | { kind: 'outside', rel } | null` (`outside` = workspace-relative path outside the knowledge folder); `resolveWikilink(pages, name) → rel | null`; `backlinks(pages) → Map<rel, rel[]>`; `buildIndex(pages) → string`; `logLine(op, title, day) → string`; `claims(pages) → Array<Claim & { page }>`; `fold(s) → string`; `search(pages, q, limit?) → Array<{ rel, title, snippet }>`; `readSources(workspace) → { version: 1, sources: Record<string, { status: 'raw' | 'compiled' | 'quarantined'; added: string; sha1?: string; job?: string; compiled_to?: string[] }> }`; `lint(workspace, { now?: Date }) → Finding[]` with `Finding = { kind: 'broken-link' | 'orphan' | 'frontmatter' | 'stale-raw' | 'superseded' | 'claim' | 'duplicate-slug' | 'size'; rel: string; line?: number; detail: string }`.
  - `node tools/wiki.js index <workspace>` → writes `.joserah/knowledge/wiki/index.md` when it changed; prints `index: N pages (written|unchanged)`.
  - `node tools/wiki.js lint <workspace> [--json]` → one line per finding `kind · rel[:line] · detail`, then `findings: N`; exit 0.
  - `node tools/wiki.js log <workspace> --op ingest|query|lint --title "<text>"` → appends `## [YYYY-MM-DD] op | title`.
  - Routes: `GET /w/` (index, search box, ask box, upload box, links to claims, checks, log), `GET /w/page/*` (a page with its backlinks), `GET /w/claims`, `GET /w/search?q=`, `GET /w/log`.

- [ ] **Step 1: Write the failing library tests**

`tests/wiki.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir, runTool } = require('./helpers');
const W = require('../tools/lib/wiki');

function kb(t, files) {
  const ws = tmpdir(t);
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(ws, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
  }
  return ws;
}
const K = '.joserah/knowledge/';

test('scan reads titles, links and wikilinks; backlinks follow them', (t) => {
  const ws = kb(t, {
    [K + 'wiki/topics/encoders.md']: '---\ntitle: Encoders\ntype: topic\n---\n\nSee [the unit](../entities/unit-a.md) and [[unit-a]].\n',
    [K + 'wiki/entities/unit-a.md']: '# Unit A\n\nA box.\n',
  });
  const pages = W.scan(ws);
  assert.deepEqual(pages.map((p) => p.rel).sort(), ['wiki/entities/unit-a.md', 'wiki/topics/encoders.md']);
  const enc = pages.find((p) => p.rel === 'wiki/topics/encoders.md');
  assert.equal(enc.title, 'Encoders'); assert.equal(enc.type, 'topic');
  assert.deepEqual(enc.links, ['wiki/entities/unit-a.md']);
  assert.equal(W.resolveWikilink(pages, 'unit-a'), 'wiki/entities/unit-a.md');
  assert.equal(W.resolveWikilink(pages, 'Unit A'), 'wiki/entities/unit-a.md');
  assert.deepEqual(W.backlinks(pages).get('wiki/entities/unit-a.md'), ['wiki/topics/encoders.md']);
});

test('resolveLink stays inside the workspace and names outside targets', () => {
  assert.deepEqual(W.resolveLink('wiki/topics/a.md', '../entities/b.md#x'), { kind: 'page', rel: 'wiki/entities/b.md' });
  assert.deepEqual(W.resolveLink('wiki/entities/a.md', '../../../../imports/2026-10-01-upload/x.pdf'), { kind: 'outside', rel: 'imports/2026-10-01-upload/x.pdf' });
  assert.equal(W.resolveLink('wiki/a.md', 'https://example.invalid'), null);
  assert.equal(W.resolveLink('wiki/a.md', '../../../../../etc/passwd'), null);
});

test('the index has one line per page and skips the generated files', (t) => {
  const ws = kb(t, {
    [K + 'wiki/topics/a.md']: '---\ntitle: Alpha\ntype: topic\ndescription: First page\n---\n',
    [K + 'wiki/index.md']: 'old', [K + 'wiki/log.md']: '# Wiki log\n',
  });
  const text = W.buildIndex(W.scan(ws));
  assert.match(text, /^# Wiki index$/m);
  assert.match(text, /^- \[Alpha\]\(topics\/a\.md\) — topic · First page$/m);
  assert.ok(!/index\.md\)|log\.md\)/.test(text));
  assert.equal(W.logLine('ingest', 'x.pdf', '2026-10-06'), '## [2026-10-06] ingest | x.pdf\n');
});

test('claims carry their page; struck lines are marked', (t) => {
  const ws = kb(t, { [K + 'wiki/entities/enc.md']: '# Enc\n\n- [measurement] latency -> 120 ms\n  condition: 1080p50 · date: 2026-09-01 · source: imports/a.md\n- [calculation] ~~latency -> 90 ms~~\n  superseded: the measurement above\n' });
  const c = W.claims(W.scan(ws));
  assert.equal(c.length, 2);
  assert.equal(c[0].page, 'wiki/entities/enc.md');
  assert.equal(c[1].struck, true);
});

test('search folds Turkish letters and case', (t) => {
  const ws = kb(t, { [K + 'wiki/topics/i.md']: '# İç yayın\n\nSinyal ışığı.\n' });
  const pages = W.scan(ws);
  assert.equal(W.search(pages, 'ic yayin')[0].rel, 'wiki/topics/i.md');
  assert.equal(W.search(pages, 'ISIGI')[0].rel, 'wiki/topics/i.md');
  assert.deepEqual(W.search(pages, 'nothing here'), []);
});

test('lint finds each kind', (t) => {
  const big = '# Big\n\n' + 'x'.repeat(W.SIZE_LIMIT + 10) + '\n';
  const ws = kb(t, {
    [K + 'wiki/topics/a.md']: '# A\n\n[gone](missing.md) [b](../entities/b.md)\n- [measurement] fps -> 50\n  date: 2026-09-01\n- [decision] ~~use x~~\n  date: 2026-09-01\n',
    [K + 'wiki/entities/b.md']: '# B\n\nlinks back to [a](../topics/a.md)\n',
    [K + 'wiki/entities/lonely.md']: '# Lonely\n',
    [K + 'wiki/topics/lonely.md']: '---\ntitle: also lonely\n',
    [K + 'wiki/topics/big.md']: big,
    'imports/2026-09-01-upload/old.txt': 'raw',
  });
  const old = new Date('2026-09-01T00:00:00Z'); fs.utimesSync(path.join(ws, 'imports/2026-09-01-upload/old.txt'), old, old);
  const kinds = new Set(W.lint(ws, { now: new Date('2026-10-06T09:00:00Z') }).map((f) => `${f.kind}:${f.rel}`));
  for (const k of ['broken-link:wiki/topics/a.md', 'orphan:wiki/entities/lonely.md', 'frontmatter:wiki/topics/lonely.md', 'claim:wiki/topics/a.md',
    'superseded:wiki/topics/a.md', 'duplicate-slug:wiki/topics/lonely.md', 'size:wiki/topics/big.md', 'stale-raw:imports/2026-09-01-upload/old.txt']) assert.ok(kinds.has(k), k);
  assert.ok(!kinds.has('orphan:wiki/entities/b.md'));
});

test('wiki.js index writes once, lint prints findings, log appends', (t) => {
  const ws = kb(t, { [K + 'wiki/topics/a.md']: '# A\n' });
  let r = runTool('wiki.js', ['index', ws]);
  assert.match(r.stdout, /^index: 1 pages \(written\)$/m);
  r = runTool('wiki.js', ['index', ws]);
  assert.match(r.stdout, /^index: 1 pages \(unchanged\)$/m);
  r = runTool('wiki.js', ['lint', ws]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^findings: \d+$/m);
  r = runTool('wiki.js', ['log', ws, '--op', 'query', '--title', 'What is A?'], { env: { JOSERAH_NOW: '2026-10-06T09:00:00' } });
  assert.equal(fs.readFileSync(path.join(ws, K, 'wiki/log.md'), 'utf8'), '# Wiki log\n\n## [2026-10-06] query | What is A?\n');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/wiki.test.js`
Expected: FAIL — `Cannot find module '../tools/lib/wiki'`.

- [ ] **Step 3: Write `tools/lib/wiki.js` and `tools/wiki.js`**

`tools/lib/wiki.js`:

```js
'use strict';
/**
 * wiki.js (lib) — the knowledge wiki's zero-token operations (spec §6, Karpathy's LLM wiki): scan the
 * pages under .joserah/knowledge/, resolve links and wikilinks, backlinks, the generated index, the log
 * line, the claims view, search, the source register, and the deterministic lint. Shared by the server
 * and tools/wiki.js. Reads only; writing is the caller's (the server writes through its Store).
 * No dependencies.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFrontmatter, parseClaims, findClaimAnomalies, extractWikilinks } = require('./note-format');

const KNOWLEDGE = '.joserah/knowledge';
const SIZE_LIMIT = 48 * 1024;
const STALE_RAW_DAYS = 7;
const GENERATED = new Set(['wiki/index.md', 'wiki/log.md']);
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const posix = path.posix;

function walk(dir, base, out) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
}

function resolveLink(fromRel, href) {
  const h = String(href).split('#')[0].split('?')[0];
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('/')) return null;
  let target; try { target = posix.normalize(posix.join(posix.dirname(fromRel), decodeURI(h))); } catch { return null; }
  if (!target.startsWith('../')) return { kind: 'page', rel: target };
  const ws = posix.normalize(posix.join(KNOWLEDGE, target));
  return ws.startsWith('../') ? null : { kind: 'outside', rel: ws };
}

function firstLine(body) {
  for (const l of body.split(/\r?\n/)) { const s = l.trim(); if (s && !s.startsWith('#') && !s.startsWith('---')) return s.replace(/[*_`[\]]/g, '').slice(0, 100); }
  return '';
}

function scan(workspace) {
  const base = path.join(workspace, KNOWLEDGE);
  const rels = []; walk(base, base, rels);
  return rels.sort().filter((r) => !GENERATED.has(r)).map((rel) => {
    const abs = path.join(base, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const fm = parseFrontmatter(text);
    const body = fm.body;
    const heading = /^#\s+(.+)$/m.exec(body);
    const links = [];
    for (const m of body.matchAll(LINK_RE)) { const r = resolveLink(rel, m[1]); if (r && r.kind === 'page' && !links.includes(r.rel)) links.push(r.rel); }
    return {
      rel, title: String(fm.data.title || (heading ? heading[1].trim() : posix.basename(rel, '.md'))), type: String(fm.data.type || ''),
      description: String(fm.data.description || firstLine(body)), body, links, wikilinks: extractWikilinks(body),
      bytes: Buffer.byteLength(text), mtimeMs: fs.statSync(abs).mtimeMs, sha1: crypto.createHash('sha1').update(text).digest('hex'),
      hasFrontmatter: fm.hasFrontmatter, unclosed: !fm.hasFrontmatter && /^---\r?\n/.test(text),
    };
  });
}

const slugOf = (rel) => posix.basename(rel, '.md').toLowerCase();
function resolveWikilink(pages, name) {
  const n = String(name).split('|')[0].trim().toLowerCase();
  const bySlug = pages.find((p) => slugOf(p.rel) === n);
  if (bySlug) return bySlug.rel;
  const byTitle = pages.find((p) => p.title.toLowerCase() === n);
  return byTitle ? byTitle.rel : null;
}

function backlinks(pages) {
  const m = new Map();
  for (const p of pages) {
    const targets = new Set([...p.links, ...p.wikilinks.map((w) => resolveWikilink(pages, w)).filter(Boolean)]);
    for (const t of targets) { if (t === p.rel) continue; if (!m.has(t)) m.set(t, []); m.get(t).push(p.rel); }
  }
  return m;
}

function buildIndex(pages) {
  const lines = pages.filter((p) => posix.basename(p.rel) !== 'README.md').map((p) => {
    const link = posix.relative('wiki', p.rel);
    return `- [${p.title}](${link}) — ${p.type || 'page'}${p.description ? ` · ${p.description}` : ''}`;
  });
  return ['# Wiki index', '', 'Generated by the Joserah server from the pages below, one line per page; do not edit by hand.', '', ...lines, ''].join('\n');
}

const logLine = (op, title, day) => `## [${day}] ${op} | ${String(title).replace(/\s+/g, ' ').trim()}\n`;

function claims(pages) { return pages.flatMap((p) => parseClaims(p.body).map((c) => ({ ...c, page: p.rel }))); }

function fold(s) { return String(s).toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i'); }

function search(pages, q, limit = 50) {
  const needle = fold(q).trim();
  if (!needle) return [];
  const hits = [];
  for (const p of pages) {
    const inTitle = fold(p.title).includes(needle);
    const body = fold(p.body); const at = body.indexOf(needle);
    if (!inTitle && at < 0) continue;
    const snippet = at < 0 ? p.description : p.body.slice(Math.max(0, at - 60), at + needle.length + 60).replace(/\s+/g, ' ').trim();
    hits.push({ rel: p.rel, title: p.title, snippet, rank: inTitle ? 0 : 1 });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.rel.localeCompare(b.rel)).slice(0, limit).map(({ rank, ...h }) => h);
}

function readSources(workspace) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(workspace, KNOWLEDGE, 'sources.json'), 'utf8'));
    if (j && typeof j.sources === 'object' && j.sources) return { version: 1, sources: j.sources };
  } catch { /* none yet */ }
  return { version: 1, sources: {} };
}

function rawFiles(workspace) {
  const out = []; const base = path.join(workspace, 'imports');
  const go = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) go(p); else if (e.isFile() && e.name !== 'README.md') out.push(p); } };
  go(base);
  return out.map((p) => ({ rel: path.relative(workspace, p).split(path.sep).join('/'), mtimeMs: fs.statSync(p).mtimeMs }));
}

function lint(workspace, { now = new Date() } = {}) {
  const pages = scan(workspace);
  const out = [];
  const known = new Set(pages.map((p) => p.rel));
  const back = backlinks(pages);
  const slugs = new Map();
  for (const p of pages) {
    if (p.unclosed) out.push({ kind: 'frontmatter', rel: p.rel, line: 1, detail: 'frontmatter opened with --- but never closed' });
    for (const m of p.body.matchAll(LINK_RE)) {
      const r = resolveLink(p.rel, m[1]);
      if (!r) continue;
      const exists = r.kind === 'page' ? known.has(r.rel) || fs.existsSync(path.join(workspace, KNOWLEDGE, r.rel)) : fs.existsSync(path.join(workspace, r.rel));
      if (!exists) out.push({ kind: 'broken-link', rel: p.rel, detail: `links to ${m[1]}, which does not exist` });
    }
    const name = posix.basename(p.rel);
    if (name !== 'README.md' && name !== 'index.md' && !(back.get(p.rel) || []).length) out.push({ kind: 'orphan', rel: p.rel, detail: 'no other page links here' });
    if (name !== 'README.md' && name !== 'index.md') { const s = slugOf(p.rel); if (!slugs.has(s)) slugs.set(s, []); slugs.get(s).push(p.rel); }
    for (const c of parseClaims(p.body)) {
      if (c.struck && !c.fields.superseded) out.push({ kind: 'superseded', rel: p.rel, line: c.line, detail: 'a struck claim names no successor (superseded:)' });
      if (c.type === 'measurement' && !c.fields.condition && !c.struck) out.push({ kind: 'claim', rel: p.rel, line: c.line, detail: 'a measurement without its condition' });
    }
    for (const a of findClaimAnomalies(p.body)) out.push({ kind: 'claim', rel: p.rel, line: a.line, detail: a.detail });
    if (p.bytes > SIZE_LIMIT) out.push({ kind: 'size', rel: p.rel, detail: `${Math.round(p.bytes / 1024)} KB — split it; pages stay under ${SIZE_LIMIT / 1024} KB` });
  }
  for (const [, rels] of slugs) if (rels.length > 1) for (const r of rels) out.push({ kind: 'duplicate-slug', rel: r, detail: `same name as ${rels.filter((x) => x !== r).join(', ')}` });
  const reg = readSources(workspace).sources;
  for (const f of rawFiles(workspace)) {
    if (f.rel.includes('-quarantine/')) continue;
    if (reg[f.rel] && reg[f.rel].status === 'compiled') continue;
    if (now.getTime() - f.mtimeMs > STALE_RAW_DAYS * 86400000) out.push({ kind: 'stale-raw', rel: f.rel, detail: `not compiled into the wiki after ${STALE_RAW_DAYS} days` });
  }
  return out;
}

module.exports = { KNOWLEDGE, SIZE_LIMIT, STALE_RAW_DAYS, scan, resolveLink, resolveWikilink, backlinks, buildIndex, logLine, claims, fold, search, readSources, lint };
```

`tools/wiki.js`:

```js
#!/usr/bin/env node
/**
 * wiki.js — the knowledge wiki's zero-token operations from the terminal (spec §6).
 *
 *   node tools/wiki.js index <workspace>     rewrite .joserah/knowledge/wiki/index.md when it changed
 *   node tools/wiki.js lint <workspace> [--json]
 *   node tools/wiki.js log <workspace> --op ingest|query|lint --title "<text>"
 *
 * Tests may fix the date with JOSERAH_NOW. No dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('./lib/wiki');

const [cmd, wsArg, ...rest] = process.argv.slice(2);
const die = (m) => { process.stderr.write(`wiki: ${m}\n`); process.exit(1); };
if (!wsArg) die('usage: wiki.js index|lint|log <workspace> …');
const ws = path.resolve(wsArg);
const now = process.env.JOSERAH_NOW ? new Date(process.env.JOSERAH_NOW) : new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const opt = (n) => { const i = rest.indexOf(n); return i < 0 ? undefined : rest[i + 1]; };

if (cmd === 'index') {
  const pages = W.scan(ws);
  const p = path.join(ws, W.KNOWLEDGE, 'wiki', 'index.md');
  const text = W.buildIndex(pages);
  const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (old !== text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  process.stdout.write(`index: ${pages.length} pages (${old !== text ? 'written' : 'unchanged'})\n`);
} else if (cmd === 'lint') {
  const f = W.lint(ws, { now });
  if (rest.includes('--json')) process.stdout.write(JSON.stringify(f, null, 2) + '\n');
  else for (const x of f) process.stdout.write(`${x.kind} · ${x.rel}${x.line ? `:${x.line}` : ''} · ${x.detail}\n`);
  process.stdout.write(`findings: ${f.length}\n`);
} else if (cmd === 'log') {
  const op = opt('--op'); const title = opt('--title');
  if (!['ingest', 'query', 'lint'].includes(op) || !title) die('usage: wiki.js log <workspace> --op ingest|query|lint --title "<text>"');
  const p = path.join(ws, W.KNOWLEDGE, 'wiki', 'log.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, '# Wiki log\n\n');
  fs.appendFileSync(p, W.logLine(op, title, day));
} else die(`unknown command ${cmd}`);
```

Run: `node --test tests/wiki.test.js`
Expected: PASS (7).

- [ ] **Step 4: Write the failing server test**

`server/test/wiki.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signedIn } from './helpers.ts';

function put(ws: string, rel: string, text: string) { const p = path.join(ws, '.joserah/knowledge', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

test('the wiki home lists pages and offers search, ask and upload', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/enc.md', '---\ntitle: Encoders\ntype: topic\n---\n\nBody.\n');
  const html = await (await app.request('/w/', { headers: { cookie } })).text();
  assert.match(html, /<a href="\/w\/page\/wiki\/topics\/enc\.md">Encoders<\/a>/);
  assert.match(html, /<form id="ask"/); assert.match(html, /<form id="upload"/); assert.match(html, /action="\/w\/search"/);
});

test('a page renders with resolved links, wikilinks and backlinks', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/enc.md', '# Encoders\n\n[unit](../entities/unit.md) and [[unit]]. <script>x</script>\n');
  put(deps.workspace, 'wiki/entities/unit.md', '---\ntitle: Unit\n---\n\n# Unit\n');
  let html = await (await app.request('/w/page/wiki/topics/enc.md', { headers: { cookie } })).text();
  assert.equal((html.match(/href="\/w\/page\/wiki\/entities\/unit\.md"/g) ?? []).length, 2);
  assert.ok(!html.includes('<script>x'));
  html = await (await app.request('/w/page/wiki/entities/unit.md', { headers: { cookie } })).text();
  assert.match(html, /<a href="\/w\/page\/wiki\/topics\/enc\.md">Encoders<\/a>/, 'backlink');
  assert.ok(!html.includes('title: Unit'), 'frontmatter is not shown as text');
});

test('the claims view shows the measurement beside the calculation and struck lines struck', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/entities/enc.md', '# Enc\n\n- [calculation] Latency -> 90 ms\n  date: 2026-09-01 · source: imports/a.md\n- [measurement] latency -> 120 ms\n  condition: 1080p50 · date: 2026-09-02 · source: imports/b.md\n- [estimate] ~~cost -> 10~~\n  superseded: the offer of 2026-09-03\n');
  const html = await (await app.request('/w/claims', { headers: { cookie } })).text();
  const m = html.indexOf('120 ms'); const c = html.indexOf('90 ms');
  assert.ok(m > 0 && c > m, 'the measurement first, the calculation beside it');
  assert.match(html, /measurement speaks/);
  assert.match(html, /<s>cost -&gt; 10<\/s>/);
  assert.match(html, /1080p50/);
});

test('search folds Turkish letters', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/i.md', '# İç yayın\n');
  const html = await (await app.request('/w/search?q=ic%20yayin', { headers: { cookie } })).text();
  assert.match(html, /\/w\/page\/wiki\/topics\/i\.md/);
});

test('wiki traversal is refused', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/a.md', '# A');
  const secret = fs.readFileSync(path.join(deps.workspace, '.joserah', 'config.json'), 'utf8').trim();
  for (const p of ['/w/page/../../config.json', '/w/page/..%2f..%2fconfig.json', '/w/page/wiki/..%5c..%5c..%5cconfig.json', '/w/page/%2e%2e/%2e%2e/config.json', '/w/page/wiki/a.txt', '/w/page/.lint/x.md']) {
    const r = await app.request(p, { headers: { cookie } });
    const body = await r.text();
    assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
    assert.ok(!body.includes(secret), p);
  }
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `node --test --test-concurrency=1 server/test/wiki.test.ts`
Expected: FAIL — 404 on `/w/`.

- [ ] **Step 6: Write `server/src/routes/wiki.ts`**

Add to `server/src/cjs.ts`:

```ts
export interface WikiPage { rel: string; title: string; type: string; description: string; body: string; links: string[]; wikilinks: string[]; bytes: number; mtimeMs: number; sha1: string; hasFrontmatter: boolean; unclosed: boolean }
export interface WikiFinding { kind: string; rel: string; line?: number; detail: string }
export interface SourceEntry { status: 'raw' | 'compiled' | 'quarantined'; added: string; sha1?: string; job?: string; compiled_to?: string[] }
export const wikiLib = require('../../tools/lib/wiki.js') as {
  KNOWLEDGE: string; SIZE_LIMIT: number;
  scan(ws: string): WikiPage[];
  resolveLink(fromRel: string, href: string): { kind: 'page' | 'outside'; rel: string } | null;
  resolveWikilink(pages: WikiPage[], name: string): string | null;
  backlinks(pages: WikiPage[]): Map<string, string[]>;
  buildIndex(pages: WikiPage[]): string;
  logLine(op: string, title: string, day: string): string;
  claims(pages: WikiPage[]): Array<Claim & { page: string }>;
  fold(s: string): string;
  search(pages: WikiPage[], q: string, limit?: number): Array<{ rel: string; title: string; snippet: string }>;
  readSources(ws: string): { version: 1; sources: Record<string, SourceEntry> };
  lint(ws: string, o?: { now?: Date }): WikiFinding[];
};
```

`server/src/routes/wiki.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { wikiLib, type WikiPage } from '../cjs.ts';
import { renderMarkdown } from '../markdown.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';

const SEG = /^[^\\/:*?"<>|\0]{1,160}$/;
const CSS = '<style>table.claims td,table.claims th{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}tr.struck{color:var(--muted)}.speaks{color:var(--ok)}</style>';

export function pageRel(raw: string): string | null {
  let rel: string; try { rel = decodeURIComponent(raw); } catch { return null; }
  const segs = rel.split('/');
  if (!rel.endsWith('.md') || segs.some((s) => !SEG.test(s) || s === '.' || s === '..' || s.startsWith('.'))) return null;
  return rel;
}

export function wikiHtml(page: WikiPage, pages: WikiPage[]): string {
  const withWikilinks = page.body.replace(/\[\[([^\]]+)\]\]/g, (m, name: string) => {
    const r = wikiLib.resolveWikilink(pages, name);
    const label = name.split('|').pop()!.trim();
    return r ? `[${label}](/w/page/${r})` : label;
  });
  return renderMarkdown(withWikilinks, { resolveHref: (h) => {
    if (h.startsWith('/w/page/')) return h;
    const r = wikiLib.resolveLink(page.rel, h);
    return r && r.kind === 'page' && pages.some((p) => p.rel === r.rel) ? `/w/page/${r.rel}` : null;
  } });
}

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  const nav = (L: (typeof LABELS)['en'] | (typeof LABELS)['tr']) => `<p><a href="/w/claims">${esc(L.claims)}</a> · <a href="/w/lint">${esc(L.lint)}</a> · <a href="/w/log">${esc(L.log)}</a></p>`;
  app.get('/w', (c) => c.redirect('/w/', 302));
  app.get('/w/', (c) => {
    const L = LABELS[lang()]; const pages = wikiLib.scan(deps.workspace);
    const groups = new Map<string, WikiPage[]>();
    for (const p of pages) { const g = p.rel.split('/').slice(0, -1).join('/') || '.'; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(p); }
    const list = [...groups].map(([g, ps]) => `<h3>${esc(g)}</h3><ul>${ps.map((p) => `<li><a href="/w/page/${esc(p.rel)}">${esc(p.title)}</a> <span class="muted">${esc(p.description)}</span></li>`).join('')}</ul>`).join('');
    const body = `<h1>${esc(L.wiki)}</h1>${nav(L)}
<form method="get" action="/w/search"><input name="q" type="search" aria-label="${esc(L.search)}"> <button>${esc(L.search)}</button></form>
<form id="ask"><textarea name="question" required maxlength="4000" aria-label="${esc(L.ask)}"></textarea><button>${esc(L.ask)}</button><span class="err"></span></form>
<form id="upload"><input type="file" name="file" required aria-label="${esc(L.upload)}"> <button>${esc(L.upload)}</button><span class="err"></span></form>${list}<script src="/_/app.js"></script>`;
    return c.html(shell({ title: L.wiki, lang: lang(), head: CSS, body }));
  });
  app.get('/w/page/*', (c) => {
    const rel = pageRel(new URL(c.req.url).pathname.slice('/w/page/'.length));
    if (!rel) return c.notFound();
    const base = fs.realpathSync(path.join(deps.workspace, wikiLib.KNOWLEDGE));
    let real: string; try { real = fs.realpathSync(path.join(base, ...rel.split('/'))); } catch { return c.notFound(); }
    const r = path.relative(base, real);
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return c.notFound();
    const pages = wikiLib.scan(deps.workspace);
    const page = pages.find((p) => p.rel === rel) ?? (rel === 'wiki/index.md' || rel === 'wiki/log.md'
      ? { rel, title: path.posix.basename(rel), type: '', description: '', body: fs.readFileSync(real, 'utf8'), links: [], wikilinks: [], bytes: 0, mtimeMs: 0, sha1: '', hasFrontmatter: false, unclosed: false } : undefined);
    if (!page) return c.notFound();
    const back = (wikiLib.backlinks(pages).get(rel) ?? []).map((b) => pages.find((p) => p.rel === b)!).filter(Boolean);
    const L = LABELS[lang()];
    const body = `${wikiHtml(page, pages)}${back.length ? `<h2>←</h2><ul>${back.map((p) => `<li><a href="/w/page/${esc(p.rel)}">${esc(p.title)}</a></li>`).join('')}</ul>` : ''}${nav(L)}`;
    return c.html(shell({ title: page.title, lang: lang(), head: CSS, body }));
  });
  app.get('/w/claims', (c) => {
    const L = LABELS[lang()];
    const all = wikiLib.claims(wikiLib.scan(deps.workspace));
    const order: Record<string, number> = { measurement: 0, calculation: 1, decision: 2, estimate: 3 };
    const bySubject = new Map<string, typeof all>();
    for (const cl of all) { const k = wikiLib.fold(cl.subject); if (!bySubject.has(k)) bySubject.set(k, []); bySubject.get(k)!.push(cl); }
    const rows = [...bySubject.values()].map((list) => {
      list.sort((a, b) => Number(a.struck) - Number(b.struck) || order[a.type] - order[b.type]);
      const live = list.filter((x) => !x.struck);
      const speaks = live.some((x) => x.type === 'measurement') && live.some((x) => x.type === 'calculation');
      return list.map((x) => {
        const v = esc(`${x.subject}${x.value !== null ? ` -> ${x.value}` : ''}`);
        return `<tr class="${x.struck ? 'struck' : ''}"><td>${esc(x.type)}${speaks && x.type === 'measurement' && !x.struck ? ' <span class="speaks">· measurement speaks</span>' : ''}</td><td>${x.struck ? `<s>${v}</s>` : v}${x.fields.superseded ? `<br><span class="muted">superseded: ${esc(x.fields.superseded)}</span>` : ''}</td><td>${esc(x.fields.condition ?? '')}</td><td>${esc(x.fields.date ?? '')}</td><td>${esc(x.fields.source ?? '')}</td><td><a href="/w/page/${esc(x.page)}">${esc(x.page)}</a></td></tr>`;
      }).join('');
    }).join('');
    return c.html(shell({ title: L.claims, lang: lang(), head: CSS, body: `<h1>${esc(L.claims)}</h1><table class="claims"><tr><th>kind</th><th>claim</th><th>condition</th><th>date</th><th>source</th><th>page</th></tr>${rows}</table>` }));
  });
  app.get('/w/search', (c) => {
    const L = LABELS[lang()]; const q = c.req.query('q') ?? '';
    const hits = wikiLib.search(wikiLib.scan(deps.workspace), q);
    return c.html(shell({ title: L.search, lang: lang(), body: `<h1>${esc(L.search)}: ${esc(q)}</h1><ul>${hits.map((h) => `<li><a href="/w/page/${esc(h.rel)}">${esc(h.title)}</a><br><span class="muted">${esc(h.snippet)}</span></li>`).join('')}</ul>` }));
  });
  app.get('/w/log', (c) => {
    const L = LABELS[lang()];
    const p = path.join(deps.workspace, wikiLib.KNOWLEDGE, 'wiki', 'log.md');
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '# Wiki log\n';
    return c.html(shell({ title: L.log, lang: lang(), body: renderMarkdown(text) }));
  });
}
```

`server/src/client.ts` — append to `APP_JS`, before the `if(typeof EventSource…` line:

```js
var ask=$('#ask');if(ask)ask.addEventListener('submit',function(e){e.preventDefault();var err=$('.err',ask);err.textContent='';
post('/api/query',{question:$('textarea',ask).value}).then(function(j){location.href='/jobs/'+j.id},function(x){err.textContent=(x&&(x.reason||x.message||x.error))||'error'})});
var up=$('#upload');if(up)up.addEventListener('submit',function(e){e.preventDefault();var err=$('.err',up),fd=new FormData(up);err.textContent='';
fetch('/api/ingest',{method:'POST',credentials:'same-origin',body:fd}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j})})
.then(function(j){location.href=j.id?'/jobs/'+j.id:'/'},function(x){err.textContent=(x&&(x.message||x.error))||'error'})});
```

Register `wikiRoutes(app, deps)` in `createApp`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts" && node --test tests/wiki.test.js`
Expected: PASS — `wiki` (5) server, `wiki` (7) tools, all earlier.

- [ ] **Step 8: Commit**

```bash
git add tools/lib/wiki.js tools/wiki.js tests/wiki.test.js server/src server/test
git commit -m "wiki: zero-token library and CLI; wiki browser with backlinks, claims view and search"
```

---

### Task 13: Ingest and query (§6, B3, B9)

A file dropped in the browser is scanned before any model reads it; a credential-shaped hit is held in a quarantine folder with an owner row and no job. A clean file is copied verbatim into `imports/`, registered, and handed to a restricted ingest job; when it ends, the server (zero tokens) marks the source compiled, rebuilds the index and appends the log. A question goes to a restricted, read-only query job; a good answer is filed back as a page by the server.

**Files:**
- Create: `server/src/routes/ingest.ts`, `server/src/wiki-books.ts`
- Modify: `server/src/routes/home.ts` (the "file it" form on a done query job), `server/src/client.ts` (its handler), `server/src/app.ts` (register), `server/main.ts` (`jobs.onEnd(ingestBookkeeping(...))`)
- Test: `server/test/ingest.test.ts`

**Interfaces:**
- Consumes: `Store.importVerbatim`, `Store.write`, `Store.writeJson`, `Store.append` (Task 3); `JobRunner.submit`, `onEnd` (Task 9); `wikiLib` (Task 12); `redactions.SPECIFIC`; `TrackerBridge.row` (Task 9).
- Produces:
  - `wiki-books.ts`: `MAX_UPLOAD = 25 * 1024 * 1024`; `safeName(name: string): string | null`; `scanUpload(bytes: Uint8Array): string[]` (names of the patterns hit, never the match); `rebuildIndex(store: Store, workspace: string): boolean`; `appendLog(store: Store, op: 'ingest' | 'query' | 'lint', title: string): void`; `setSource(store: Store, workspace: string, rel: string, patch: Partial<SourceEntry>): void`; `ingestBookkeeping(o: { store: Store; workspace: string }): (job: JobRecord) => void`; `fileAnswer(o: { store: Store; workspace: string; job: JobRecord; title: string }): string` (returns the new page's workspace-relative path); `slug(s: string): string`.
  - Routes: `POST /api/ingest` (multipart, field `file`) → `201 {id, path}` | `202 {quarantined: true, path}` | `400 {error:'no-file'|'bad-name'}` | `413 {error:'too-large'}`; `POST /api/query {question}` → `201 {id}`; `POST /api/query/:id/file {title}` → `201 {path}` | `409 {error:'not-done'}` | `404`.

- [ ] **Step 1: Write the failing tests**

`server/test/ingest.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signedIn, ORIGIN } from './helpers.ts';
import { scanUpload, safeName, slug } from '../src/wiki-books.ts';
import { ingestBookkeeping } from '../src/wiki-books.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

function upload(cookie: string, name: string, content: string | Uint8Array) {
  const fd = new FormData();
  fd.append('file', new Blob([content]), name);
  return { method: 'POST', headers: { cookie, origin: ORIGIN }, body: fd };
}
const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('names are made safe; the scan names patterns, never the secret', () => {
  assert.equal(safeName('../../x/rapor:2026?.pdf'), 'rapor-2026-.pdf');
  assert.equal(safeName('.hidden'), null);
  assert.equal(safeName(''), null);
  assert.deepEqual(scanUpload(Buffer.from('nothing here, just notes about İstanbul')), []);
  const hits = scanUpload(Buffer.from('api_key = sk-abcdefghijklmnop1234'));
  assert.ok(hits.length >= 1);
  assert.ok(!hits.join(' ').includes('sk-abcdefghijklmnop1234'));
  assert.equal(slug('Kaç kanal var? İç yayın'), 'kac-kanal-var-ic-yayin');
});

test('a credential-shaped upload is quarantined verbatim, with an owner row and no job', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const r = await app.request('/api/ingest', upload(cookie, 'creds.txt', 'password: hunter2hunter2'));
  assert.equal(r.status, 202);
  const j = await r.json();
  assert.equal(j.path, `imports/${DAY}-quarantine/creds.txt`);
  assert.equal(fs.readFileSync(path.join(deps.workspace, j.path), 'utf8'), 'password: hunter2hunter2', 'verbatim');
  assert.equal(deps.jobs.list().length, 0, 'no model reads it');
  const rows = JSON.parse(fs.readFileSync(path.join(deps.workspace, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8'));
  const row = (Array.isArray(rows) ? rows : rows.rows).find((x: { title: string }) => /creds\.txt/.test(x.title));
  assert.equal(row.state, 'you');
  assert.ok(!JSON.stringify(rows).includes('hunter2'));
});

test('a clean upload is copied verbatim, registered, and starts a restricted ingest job', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const r = await app.request('/api/ingest', upload(cookie, 'notes.md', '# Notes\n\nThe encoder runs at 50 fps.\n'));
  assert.equal(r.status, 201);
  const { id, path: rel } = await r.json();
  assert.equal(rel, `imports/${DAY}-upload/notes.md`);
  const job = deps.jobs.get(id)!;
  assert.equal(job.type, 'ingest');
  assert.equal(job.pointers![0], rel);
  const reg = JSON.parse(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/sources.json'), 'utf8'));
  assert.equal(reg.sources[rel].status, 'raw');
  assert.equal(reg.sources[rel].job, id);
  await deps.jobs.idle();
});

test('after an ingest job the server marks the source compiled, rebuilds the index and logs it', async (t) => {
  const { deps } = await signedIn(t);
  const rel = `imports/${DAY}-upload/notes.md`;
  deps.store.importVerbatim(Buffer.from('# n'), rel);
  const done = { id: 'j-1', day: DAY, type: 'ingest', target: 'server', text: `Ingest ${rel}`, state: 'done', createdAt: '', model: 'sonnet', budgetUsd: 2, rowTitle: 'x', turns: 1,
    pointers: [rel], changed: [{ status: 'A', path: '.joserah/knowledge/wiki/sources/notes.md' }, { status: 'M', path: '.joserah/knowledge/wiki/entities/enc.md' }], flags: [] } as const;
  fs.mkdirSync(path.join(deps.workspace, '.joserah/knowledge/wiki/sources'), { recursive: true });
  fs.writeFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/sources/notes.md'), '---\ntitle: Notes\ntype: source\n---\n');
  const job = structuredClone(done) as unknown as import('../src/jobs.ts').JobRecord;
  ingestBookkeeping({ store: deps.store, workspace: deps.workspace })(job);
  const reg = JSON.parse(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/sources.json'), 'utf8'));
  assert.equal(reg.sources[rel].status, 'compiled');
  assert.deepEqual(reg.sources[rel].compiled_to, ['.joserah/knowledge/wiki/entities/enc.md', '.joserah/knowledge/wiki/sources/notes.md']);
  assert.match(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/index.md'), 'utf8'), /\[Notes\]\(sources\/notes\.md\)/);
  assert.match(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/log.md'), 'utf8'), /^## \[2026-10-06\] ingest \| notes\.md$/m);
  const none = { ...structuredClone(done), changed: [] } as unknown as import('../src/jobs.ts').JobRecord;
  ingestBookkeeping({ store: deps.store, workspace: deps.workspace })(none);
  assert.deepEqual(none.flags, ['ingest wrote no wiki page']);
});

test('a question runs a read-only query job; a good answer is filed as a page', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const r = await app.request('/api/query', json(cookie, { question: 'Kaç kanal var?' }));
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.equal(deps.jobs.get(id)!.type, 'query');
  await deps.jobs.idle();
  const f = await app.request(`/api/query/${id}/file`, json(cookie, { title: 'Kaç kanal var?' }));
  assert.equal(f.status, 201);
  const { path: rel } = await f.json();
  assert.equal(rel, '.joserah/knowledge/wiki/answers/kac-kanal-var.md');
  const text = fs.readFileSync(path.join(deps.workspace, rel), 'utf8');
  assert.match(text, /^title: Kaç kanal var\?$/m); assert.match(text, /^type: answer$/m); assert.match(text, new RegExp(`^source: job ${id}$`, 'm'));
  assert.match(text, /> Asked: Kaç kanal var\?/); assert.match(text, /Done\./);
  assert.match(fs.readFileSync(path.join(deps.workspace, '.joserah/knowledge/wiki/log.md'), 'utf8'), /query \| Kaç kanal var\?/);
  const again = await app.request(`/api/query/${id}/file`, json(cookie, { title: 'Kaç kanal var?' }));
  assert.equal((await again.json()).path, '.joserah/knowledge/wiki/answers/kac-kanal-var-2.md');
});

test('uploads over the limit and without a file are refused', async (t) => {
  const { app, cookie } = await signedIn(t);
  assert.equal((await app.request('/api/ingest', { method: 'POST', headers: { cookie, origin: ORIGIN }, body: new FormData() })).status, 400);
  assert.equal((await app.request('/api/ingest', upload(cookie, 'big.bin', new Uint8Array(25 * 1024 * 1024 + 1)))).status, 413);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/ingest.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/wiki-books.ts`.

- [ ] **Step 3: Write `server/src/wiki-books.ts`**

```ts
import crypto from 'node:crypto';
import type { Store } from './store.ts';
import type { JobRecord } from './jobs.ts';
import { wikiLib, redactions, type SourceEntry } from './cjs.ts';
import { localDay } from './paths.ts';

export const MAX_UPLOAD = 25 * 1024 * 1024;
const K = '.joserah/knowledge';

export function safeName(name: string): string | null {
  const base = String(name ?? '').split(/[\\/]/).pop()!.replace(/[:*?"<>|\0]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return !base || base.startsWith('.') ? null : base;
}

// Best effort on binary files (a PDF's text may be compressed); never a guarantee (AGENTS.md 8.3).
export function scanUpload(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  const texts = [buf.toString('utf8'), buf.toString('latin1')];
  const hits: string[] = [];
  redactions.SPECIFIC.forEach(([re], i) => {
    const once = new RegExp(re.source, re.flags.replace('g', ''));
    if (texts.some((t) => once.test(t))) hits.push(`pattern ${i + 1}`);
  });
  return hits;
}

export function slug(s: string): string {
  return wikiLib.fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'answer';
}

export function rebuildIndex(store: Store, workspace: string): boolean {
  const text = wikiLib.buildIndex(wikiLib.scan(workspace));
  if (store.read(`${K}/wiki/index.md`) === text) return false;
  store.write(`${K}/wiki/index.md`, text);
  return true;
}

export function appendLog(store: Store, op: 'ingest' | 'query' | 'lint', title: string): void {
  const rel = `${K}/wiki/log.md`;
  if (store.read(rel) === null) store.write(rel, '# Wiki log\n\n');
  store.append(rel, wikiLib.logLine(op, title, localDay()));
}

export function setSource(store: Store, workspace: string, rel: string, patch: Partial<SourceEntry>): void {
  const reg = wikiLib.readSources(workspace);
  reg.sources[rel] = { ...(reg.sources[rel] ?? { status: 'raw', added: new Date().toISOString() }), ...patch } as SourceEntry;
  store.writeJson(`${K}/sources.json`, reg);
}

export function ingestBookkeeping(o: { store: Store; workspace: string }): (job: JobRecord) => void {
  return (job) => {
    if (job.type !== 'ingest' || job.state !== 'done') return;
    const src = job.pointers?.[0];
    if (!src?.startsWith('imports/')) return;
    const pages = (job.changed ?? []).filter((c) => c.status !== 'D' && c.path.startsWith(`${K}/`) && c.path.endsWith('.md')
      && c.path !== `${K}/wiki/index.md` && c.path !== `${K}/wiki/log.md`).map((c) => c.path).sort();
    if (!pages.length) { job.flags = [...(job.flags ?? []), 'ingest wrote no wiki page']; return; }
    setSource(o.store, o.workspace, src, { status: 'compiled', compiled_to: pages, job: job.id });
    rebuildIndex(o.store, o.workspace);
    appendLog(o.store, 'ingest', src.split('/').pop()!);
  };
}

export function fileAnswer(o: { store: Store; workspace: string; job: JobRecord; title: string }): string {
  const title = o.title.replace(/\s+/g, ' ').trim().slice(0, 140) || o.job.text.slice(0, 80);
  const base = `${K}/wiki/answers/${slug(title)}`;
  let rel = `${base}.md`;
  for (let n = 2; o.store.read(rel) !== null; n++) rel = `${base}-${n}.md`;
  const body = ['---', `title: ${title}`, 'type: answer', `date: ${localDay()}`, `source: job ${o.job.id}`, '---', '', `# ${title}`, '',
    `> Asked: ${o.job.text.replace(/\s+/g, ' ').trim()}`, '', (o.job.resultText ?? '').trim(), ''].join('\n');
  o.store.write(rel, body);
  rebuildIndex(o.store, o.workspace);
  appendLog(o.store, 'query', title);
  return rel;
}

export const sha1 = (b: Uint8Array) => crypto.createHash('sha1').update(b).digest('hex');
```

- [ ] **Step 4: Write `server/src/routes/ingest.ts`**

```ts
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { jsonError } from '../app.ts';
import { localDay, hhmm } from '../paths.ts';
import { MAX_UPLOAD, safeName, scanUpload, setSource, fileAnswer, sha1 } from '../wiki-books.ts';
import { Refused } from '../jobs.ts';
import { workspaceLang } from '../config.ts';

const HELD = {
  tr: (n: string) => `Yüklenen ${n} bir kimlik bilgisi içeriyor gibi görünüyor; hiçbir model okumadı ve ayrı bir klasörde bekliyor. Sonraki: dosyaya bakın; gizli bilgiyi kasaya koyun, sonra dosyayı yeniden ekleyin.`,
  en: (n: string) => `The upload ${n} looks like it holds a credential; no model read it and it waits in a separate folder. Next: check the file; put the secret in the vault, then add the file again.`,
};

export function register(app: App, deps: AppDeps): void {
  app.post('/api/ingest', async (c) => {
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_UPLOAD + 64 * 1024) return jsonError(c, 413, 'too-large');
    let form: Record<string, unknown>;
    try { form = await c.req.parseBody(); } catch { return jsonError(c, 400, 'no-file'); }
    const file = form.file;
    if (!(file instanceof File)) return jsonError(c, 400, 'no-file');
    if (file.size > MAX_UPLOAD) return jsonError(c, 413, 'too-large');
    const name = safeName(file.name);
    if (!name) return jsonError(c, 400, 'bad-name');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const day = localDay();
    if (scanUpload(bytes).length) {
      const rel = deps.store.importVerbatim(bytes, `imports/${day}-quarantine/${name}`);
      setSource(deps.store, deps.workspace, rel, { status: 'quarantined', added: new Date().toISOString(), sha1: sha1(bytes) });
      const lang = workspaceLang(deps.workspace);
      deps.tracker.row({ title: `${lang === 'tr' ? 'Bekletilen dosya' : 'Held upload'}: ${name} · ${hhmm()}`, state: 'you', small: HELD[lang](name) });
      return c.json({ quarantined: true, path: rel }, 202);
    }
    const rel = deps.store.importVerbatim(bytes, `imports/${day}-upload/${name}`);
    try {
      const job = deps.jobs.submit({ type: 'ingest', text: `Ingest ${rel} into the wiki: a summary page for the source, then the entity and topic pages it touches.`,
        pointers: [rel, '.joserah/knowledge/wiki/README.md', '.joserah/knowledge/wiki/index.md', '.joserah/conventions.md'] });
      setSource(deps.store, deps.workspace, rel, { status: 'raw', added: new Date().toISOString(), sha1: sha1(bytes), job: job.id });
      return c.json({ id: job.id, path: rel }, 201);
    } catch (e) {
      setSource(deps.store, deps.workspace, rel, { status: 'raw', added: new Date().toISOString(), sha1: sha1(bytes) });
      if (e instanceof Refused) return jsonError(c, e.code === 'daily-budget' ? 429 : 400, e.code, { message: e.message, path: rel });
      throw e;
    }
  });
  app.post('/api/query', async (c) => {
    let b: { question?: unknown };
    try { b = await c.req.json(); } catch { return jsonError(c, 400, 'bad-text'); }
    try { return c.json({ id: deps.jobs.submit({ type: 'query', text: String(b.question ?? ''), pointers: ['.joserah/knowledge/wiki/index.md'] }).id }, 201); }
    catch (e) { if (e instanceof Refused) return jsonError(c, e.code === 'daily-budget' ? 429 : 400, e.code, { message: e.message }); throw e; }
  });
  app.post('/api/query/:id/file', async (c) => {
    const job = deps.jobs.get(c.req.param('id'));
    if (!job || job.type !== 'query') return jsonError(c, 404, 'not-found');
    if (job.state !== 'done' || !job.resultText) return jsonError(c, 409, 'not-done');
    let b: { title?: unknown } = {};
    try { b = await c.req.json(); } catch { /* title optional */ }
    return c.json({ path: fileAnswer({ store: deps.store, workspace: deps.workspace, job, title: String(b.title ?? '') }) }, 201);
  });
}
```

This needs the Tracker bridge on the deps: add `tracker: TrackerBridge` to `AppDeps` (main passes the same `cliTracker` the runner uses; `baseDeps` builds one for the test workspace). Register `ingestRoutes(app, deps)` in `createApp`.

`server/main.ts`: `jobs.onEnd(ingestBookkeeping({ store, workspace }));` (before `jobs.recover()`). In `server/test/helpers.ts` `baseDeps`, register the same `onEnd` on the runner it builds.

- [ ] **Step 5: The "file it" form on the job page**

In `server/src/routes/home.ts` `/jobs/:id`, before the stream list:

```ts
${j.type === 'query' && j.state === 'done' && j.resultText ? `<p><input id="file-title" value="${esc(j.text.slice(0, 120))}" aria-label="title"> ${btn('file', L.fileIt)}</p>` : ''}
```

In `server/src/client.ts`, in the `button[data-act]` handler, before the generic `post`:

```js
if(act==='file'){var ti=$('#file-title');post('/api/query/'+id+'/file',{title:ti?ti.value:''}).then(function(j){location.href='/w/page/'+j.path.replace(/^\.joserah\/knowledge\//,'')},function(x){alert((x&&(x.message||x.error))||'error')});return}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `ingest` (6) and all earlier.

- [ ] **Step 7: Commit**

```bash
git add server/src server/main.ts server/test
git commit -m "wiki: scanned uploads with quarantine, restricted ingest and query jobs, server-side bookkeeping"
```

---

### Task 14: Lint — deterministic on every change and nightly, the model only over the changed set (§6, B6, B11, B12)

**Files:**
- Create: `server/src/lint-scheduler.ts`, `server/src/routes/lint.ts`
- Modify: `server/main.ts` (start the scheduler), `server/src/deps.ts` (add `lint`), `server/src/app.ts` (register)
- Test: `server/test/lint.test.ts`

**Interfaces:**
- Consumes: `wikiLib.lint`, `wikiLib.scan` (Task 12); `rebuildIndex`, `appendLog` (Task 13); `JobRunner.submit`, `onEnd` (Task 9); `rotateLogs` (Task 9); `TrackerBridge.row`.
- Produces:
  - `lint-scheduler.ts`: `interface LintOptions`; `msUntil(hhmm: string, from: Date): number` (ms to the next local `HH:MM`, today if still ahead, else tomorrow); `class LintScheduler { constructor(o: { workspace: string; stateDir: string; store: Store; bus: EventBus; jobs: JobRunner; tracker: TrackerBridge; config: () => ServerConfig; lang: 'tr' | 'en'; debounceMs?: number }); start(): void; stop(): void; runDeterministic(): WikiFinding[]; changedSet(): string[]; runLlm(): JobRecord | null; nightly(at?: Date): boolean; latest(): { at: string; findings: WikiFinding[] } | null }`.
  - Files: `.joserah/desk/lint/latest.json` (`{at, findings}`), `.joserah/desk/lint/hashes.json` (`{ "<rel>": "<sha1>" }`, the set the last model pass covered), `<stateDir>/nightly.json` (`{ day }`, the lock), `.joserah/knowledge/.lint/conflicts.json` (written by the lint job).
  - Routes: `GET /w/lint` (findings by kind, last run time, two buttons), `POST /api/lint` → `200 {findings: n}`, `POST /api/lint/llm` → `201 {id}` | `200 {id: null, reason: 'nothing changed'}`.

- [ ] **Step 1: Write the failing tests**

`server/test/lint.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { msUntil, LintScheduler } from '../src/lint-scheduler.ts';
import { runnerFor, tmpdir, signedIn, ORIGIN } from './helpers.ts';
import { cliTracker } from '../src/tracker-bridge.ts';
import { DEFAULT_CONFIG, type ServerConfig } from '../src/config.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });
const put = (ws: string, rel: string, text: string) => { const p = path.join(ws, '.joserah/knowledge', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

function sched(t: import('node:test').TestContext, env: Record<string, string> = {}, cfg: Partial<ServerConfig> = {}) {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...cfg };
  const { runner, deps, ws } = runnerFor(t, { env, config: cfg });
  fs.rmSync(path.join(ws, '.joserah/knowledge'), { recursive: true, force: true }); // start from an empty wiki: the scaffold's READMEs would be pages too
  const s = new LintScheduler({ workspace: ws, stateDir: tmpdir(t), store: deps.store, bus: deps.bus, jobs: runner, tracker: cliTracker(ws, 'en'), config: () => config, lang: 'en', debounceMs: 10 });
  t.after(() => s.stop());
  return { s, ws, runner, deps };
}

test('msUntil: later today, else tomorrow', () => {
  assert.equal(msUntil('03:30', new Date(2026, 9, 6, 3, 0)), 30 * 60000);
  assert.equal(msUntil('03:30', new Date(2026, 9, 6, 4, 0)), (23 * 60 + 30) * 60000);
});

test('deterministic lint runs on a knowledge change, writes latest.json and the index', async (t) => {
  const { s, ws, deps } = sched(t);
  s.start();
  put(ws, 'wiki/topics/a.md', '# A\n\n[x](missing.md)\n');
  deps.store.pollOnce();
  await new Promise((r) => setTimeout(r, 100));
  const latest = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/lint/latest.json'), 'utf8'));
  assert.ok(latest.findings.some((f: { kind: string }) => f.kind === 'broken-link'));
  assert.match(fs.readFileSync(path.join(ws, '.joserah/knowledge/wiki/index.md'), 'utf8'), /\[A\]\(topics\/a\.md\)/);
});

test('the model pass runs only over the changed set', async (t) => {
  const { s, ws, runner } = sched(t);
  put(ws, 'wiki/topics/a.md', '# A\n');
  assert.deepEqual(s.changedSet(), ['wiki/topics/a.md']);
  const job = s.runLlm()!;
  assert.equal(job.type, 'lint');
  assert.deepEqual(job.pointers, ['.joserah/knowledge/wiki/topics/a.md']);
  await runner.idle();
  assert.deepEqual(s.changedSet(), [], 'covered set remembered');
  assert.equal(s.runLlm(), null, 'nothing changed: no model');
});

test('conflicts the lint job quotes become owner rows', async (t) => {
  const conflicts = JSON.stringify([{ a: { path: 'wiki/x.md', quote: 'runs at 50 fps' }, b: { path: 'wiki/y.md', quote: 'runs at 25 fps' }, note: 'frame rate disagrees' }]);
  const { s, ws, runner } = sched(t, { FAKE_CLAUDE_WRITE: `.joserah/knowledge/.lint/conflicts.json:${conflicts}` });
  put(ws, 'wiki/x.md', '# X\nruns at 50 fps\n');
  s.runLlm(); await runner.idle();
  const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8'));
  const row = (Array.isArray(j) ? j : j.rows).find((r: { title: string }) => r.title.startsWith('Wiki conflict: wiki/x.md vs wiki/y.md'));
  assert.equal(row.state, 'you');
  assert.match(row.small, /"runs at 50 fps" ↔ "runs at 25 fps"/);
  assert.match(fs.readFileSync(path.join(ws, '.joserah/knowledge/wiki/log.md'), 'utf8'), /lint \| 1 conflict/);
});

test('unreadable conflicts output fails closed: an owner row, nothing marked checked', async (t) => {
  const { s, ws, runner } = sched(t, { FAKE_CLAUDE_WRITE: '.joserah/knowledge/.lint/conflicts.json:not json' });
  put(ws, 'wiki/x.md', '# X
');
  s.runLlm(); await runner.idle();
  const j = JSON.parse(fs.readFileSync(path.join(ws, '.joserah/desk/artifacts', DAY, 'daily-tracker', 'rows.json'), 'utf8'));
  assert.ok((Array.isArray(j) ? j : j.rows).some((r: { title: string; state: string }) => r.title.startsWith('Wiki check output unreadable') && r.state === 'you'));
  assert.deepEqual(s.changedSet(), ['wiki/x.md'], 'not marked as checked');
});

test('nightly runs once a day, catches up after a missed night, and the model pass stays off by default', (t) => {
  const { s, runner } = sched(t);
  assert.equal(s.nightly(new Date(2026, 9, 6, 3, 31)), true);
  assert.equal(s.nightly(new Date(2026, 9, 6, 4, 0)), false, 'lock: once a day');
  assert.equal(runner.list().length, 0, 'nightlyLlmLint is off: no job');
  assert.equal(s.nightly(new Date(2026, 9, 7, 9, 0)), true, 'next day');
});

test('lint routes', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  put(deps.workspace, 'wiki/topics/a.md', '# A\n\n[x](missing.md)\n');
  const r = await app.request('/api/lint', { method: 'POST', headers: { cookie, origin: ORIGIN } });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).findings >= 1);
  const html = await (await app.request('/w/lint', { headers: { cookie } })).text();
  assert.match(html, /broken-link/);
  assert.match(html, /data-lint="llm"/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/lint.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/lint-scheduler.ts`.

- [ ] **Step 3: Write `server/src/lint-scheduler.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './store.ts';
import type { EventBus } from './events.ts';
import type { JobRunner, JobRecord } from './jobs.ts';
import type { TrackerBridge } from './tracker-bridge.ts';
import type { ServerConfig } from './config.ts';
import { wikiLib, type WikiFinding } from './cjs.ts';
import { rebuildIndex, appendLog } from './wiki-books.ts';
import { rotateLogs } from './jobs.ts';
import { localDay, hhmm, now } from './paths.ts';

const K = '.joserah/knowledge';
const LATEST = '.joserah/desk/lint/latest.json';
const HASHES = '.joserah/desk/lint/hashes.json';
const CONFLICTS = `${K}/.lint/conflicts.json`;

export function msUntil(at: string, from: Date): number {
  const [h, m] = at.split(':').map(Number);
  const next = new Date(from); next.setHours(h, m, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - from.getTime();
}

export interface LintOptions { workspace: string; stateDir: string; store: Store; bus: EventBus; jobs: JobRunner; tracker: TrackerBridge; config: () => ServerConfig; lang: 'tr' | 'en'; debounceMs?: number }

export class LintScheduler {
  #o: LintOptions;
  #pending = new Map<string, Record<string, string>>();
  #timer: NodeJS.Timeout | null = null;
  #night: NodeJS.Timeout | null = null;
  #off: (() => void) | null = null;
  constructor(o: LintOptions) {
    this.#o = o;
    o.jobs.onEnd((job) => this.#onEnd(job));
  }

  latest(): { at: string; findings: WikiFinding[] } | null { return this.#o.store.readJson(LATEST); }

  runDeterministic(): WikiFinding[] {
    if (!fs.existsSync(path.join(this.#o.workspace, '.joserah', 'config.json'))) return []; // an empty Docker volume before the wizard: write nothing
    const findings = wikiLib.lint(this.#o.workspace, { now: now() });
    const prev = this.latest();
    if (JSON.stringify(prev?.findings) !== JSON.stringify(findings)) this.#o.store.writeJson(LATEST, { at: now().toISOString(), findings });
    rebuildIndex(this.#o.store, this.#o.workspace);
    return findings;
  }

  changedSet(): string[] {
    const seen = this.#o.store.readJson<Record<string, string>>(HASHES) ?? {};
    return wikiLib.scan(this.#o.workspace).filter((p) => seen[p.rel] !== p.sha1).map((p) => p.rel);
  }

  runLlm(): JobRecord | null {
    const pages = wikiLib.scan(this.#o.workspace);
    const set = this.changedSet();
    if (!set.length) return null;
    const job = this.#o.jobs.submit({ type: 'lint', text: `Check these ${set.length} wiki pages against each other and the rest of the wiki; quote any two sentences that contradict each other.`,
      pointers: set.map((r) => `${K}/${r}`) });
    this.#pending.set(job.id, Object.fromEntries(pages.map((p) => [p.rel, p.sha1])));
    return job;
  }

  #onEnd(job: JobRecord): void {
    if (job.type !== 'lint') return;
    const covered = this.#pending.get(job.id); this.#pending.delete(job.id);
    if (job.state !== 'done') return;
    // Invalid output fails closed (B3): a conflicts file the server cannot read is an owner row, never "no conflicts".
    const raw = this.#o.store.read(CONFLICTS);
    let parsed: unknown = [];
    try { parsed = raw === null ? [] : JSON.parse(raw); } catch { parsed = null; }
    if (!Array.isArray(parsed)) {
      this.#o.tracker.row({ title: `Wiki check output unreadable · ${hhmm()}`, state: 'you', small: 'The model check wrote a conflicts file the server could not read; nothing was marked as checked. Next: look at .joserah/knowledge/.lint/conflicts.json, then run the check again.' });
      return;
    }
    const list = parsed as Array<{ a?: { path?: string; quote?: string }; b?: { path?: string; quote?: string }; note?: string }>;
    for (const c of list) {
      const a = c.a ?? {}; const b = c.b ?? {};
      this.#o.tracker.row({ title: `Wiki conflict: ${a.path ?? '?'} vs ${b.path ?? '?'} · ${hhmm()}`, state: 'you',
        small: `"${String(a.quote ?? '').slice(0, 160)}" ↔ "${String(b.quote ?? '').slice(0, 160)}" — ${String(c.note ?? '').slice(0, 160)}. Next: decide which holds; the other gets struck with superseded:.` });
    }
    if (covered) this.#o.store.writeJson(HASHES, { ...(this.#o.store.readJson<Record<string, string>>(HASHES) ?? {}), ...covered });
    appendLog(this.#o.store, 'lint', `${list.length} conflict${list.length === 1 ? '' : 's'}`);
    if (list.length) this.#o.store.remove(CONFLICTS);
  }

  nightly(at: Date = now()): boolean {
    const lock = path.join(this.#o.stateDir, 'nightly.json');
    const day = localDay(at);
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).day === day) return false; } catch { /* first night */ }
    fs.mkdirSync(this.#o.stateDir, { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ day }));
    this.runDeterministic();
    rotateLogs(this.#o.store, this.#o.config().rawLogDays, at);
    if (this.#o.config().nightlyLlmLint) this.runLlm();
    return true;
  }

  start(): void {
    this.#off = this.#o.bus.subscribe((_id, e) => {
      if (e.type !== 'changed' || !e.path.startsWith(`${K}/`) || e.path.startsWith(`${K}/.lint/`) || e.path === `${K}/wiki/index.md` || e.path === `${K}/wiki/log.md` || e.path === `${K}/sources.json`) return;
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { this.#timer = null; this.runDeterministic(); }, this.#o.debounceMs ?? 2000);
    });
    const at = this.#o.config().nightlyAt;
    const t = now();
    if (hhmm(t) >= at) this.nightly(t); // catch-up: past today's time — runs now unless the lock says it already ran today
    const arm = () => { this.#night = setTimeout(() => { this.nightly(); arm(); }, msUntil(this.#o.config().nightlyAt, now())); this.#night.unref(); };
    arm();
  }

  stop(): void { this.#off?.(); if (this.#timer) clearTimeout(this.#timer); if (this.#night) clearTimeout(this.#night); }
}
```

- [ ] **Step 4: Write `server/src/routes/lint.ts` and wire it**

```ts
import type { App } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import { shell, esc, LABELS } from '../layout.ts';
import { workspaceLang } from '../config.ts';

export function register(app: App, deps: AppDeps): void {
  const lang = () => workspaceLang(deps.workspace);
  app.post('/api/lint', (c) => c.json({ findings: deps.lint.runDeterministic().length }));
  app.post('/api/lint/llm', (c) => { const j = deps.lint.runLlm(); return j ? c.json({ id: j.id }, 201) : c.json({ id: null, reason: 'nothing changed' }); });
  app.get('/w/lint', (c) => {
    const L = LABELS[lang()]; const latest = deps.lint.latest() ?? { at: '', findings: [] };
    const byKind = new Map<string, typeof latest.findings>();
    for (const f of latest.findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind)!.push(f); }
    const body = `<h1>${esc(L.lint)}</h1><p class="muted">${esc(latest.at)}</p>
<p><button data-lint="now">${esc(L.lint)}</button> <button data-lint="llm">${esc(L.lint)} + model</button></p>
${[...byKind].map(([k, fs]) => `<h2>${esc(k)} (${fs.length})</h2><ul>${fs.map((f) => `<li><a href="/w/page/${esc(f.rel)}">${esc(f.rel)}${f.line ? `:${f.line}` : ''}</a> — ${esc(f.detail)}</li>`).join('')}</ul>`).join('')}
<script>document.querySelectorAll('button[data-lint]').forEach(function(b){b.addEventListener('click',function(){fetch(b.getAttribute('data-lint')==='llm'?'/api/lint/llm':'/api/lint',{method:'POST',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){location.href=j.id?'/jobs/'+j.id:'/w/lint'})})})</script>`;
    return c.html(shell({ title: L.lint, lang: lang(), body }));
  });
}
```

`deps.lint: LintScheduler` in `AppDeps`; `baseDeps` builds one (not started) for route tests; `server/main.ts` builds it after the runner and calls `lint.start()` in the serve callback after `store.start()`. Register `lintRoutes(app, deps)` in `createApp`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `lint` (7) and all earlier.

- [ ] **Step 6: Commit**

```bash
git add server/src server/main.ts server/test
git commit -m "wiki: lint on every change and nightly with a lock and catch-up; model pass only over the changed set"
```

---

### Task 15: Token economy (§7) — the guarantees, end to end

Most of §7 is already built into earlier tasks (briefs in Task 9, routing in Task 2, caps in Task 9). This task adds what is left — the daily budget stop, today's cost on the home screen, answer batching with the acknowledgement filter — and one conformance test file that pins every §7 requirement (a)–(f) of the Global Constraints, so a later change cannot quietly undo one.

**Files:**
- Create: `server/src/answer-trigger.ts`
- Modify: `server/src/jobs.ts` (`todayCostUsd()`, the daily-budget refusal in `submit`), `server/src/routes/home.ts` (today's cost line), `server/src/deps.ts` (add `answers: AnswerTrigger`), `server/main.ts` (start the trigger), `server/test/helpers.ts` (`baseDeps` builds an `AnswerTrigger`, not started, and its runner reads the config through `() => deps.config()`)
- Test: `server/test/token-economy.test.ts`

**Interfaces:**
- Consumes: `JobRunner` (Task 9), `answersLib` (Task 6), `composeBrief`, `BRIEF_PREFIX` (Task 9), `modelFor`, `loadServerConfig` (Task 2), `toolPath`.
- Produces:
  - `JobRunner.todayCostUsd(): number`; `submit` throws `Refused('daily-budget', …)` when today's estimated spend has reached `dailyBudgetUsd`.
  - `answer-trigger.ts`: `ACK_RE: RegExp`; `isAck(doc: AnswerDoc): boolean`; `class AnswerTrigger { constructor(o: { workspace: string; bus: EventBus; jobs: JobRunner; config: () => ServerConfig; batchMs?: number }); start(): void; stop(): void; fire(): JobRecord | null }`.
  - Home: `<p id="cost">` with today's estimated total and the daily cap.

- [ ] **Step 1: Write the failing conformance tests**

`server/test/token-economy.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runnerFor, tmpdir, signedIn, ORIGIN, trackerPage } from './helpers.ts';
import { BRIEF_PREFIX, composeBrief } from '../src/briefs.ts';
import { JOB_TYPES, loadServerConfig, ConfigError } from '../src/config.ts';
import { AnswerTrigger, isAck } from '../src/answer-trigger.ts';
import { answersLib } from '../src/cjs.ts';
import { Refused } from '../src/jobs.ts';

const DAY = '2026-10-06';
test.beforeEach(() => { process.env.JOSERAH_NOW = `${DAY}T09:00:00`; });
test.afterEach(() => { delete process.env.JOSERAH_NOW; });

test('(a) the model never writes or re-reads a page: no brief carries an .html path', async (t) => {
  for (const type of JOB_TYPES) assert.ok(!/[\w./-]+\.html?\b/.test(composeBrief({ type, task: 'x', pointers: ['.joserah/desk/artifacts/d/f/index.html', 'a.md'] })), type);
  const out = path.join(tmpdir(t), 'stdin.txt');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_STDIN_OUT: out } });
  runner.submit({ type: 'task', text: 'tidy the page', pointers: ['.joserah/desk/artifacts/2026-10-06/daily-tracker/index.html', '.joserah/desk/tasks/now.md'] });
  await runner.idle();
  const sent = fs.readFileSync(out, 'utf8');
  assert.ok(!sent.includes('index.html'));
  assert.match(sent, /do not write or re-read any \.html file/);
});

test('(b) a stable prefix first, then the task, then pointers — never file bodies', async (t) => {
  const out = path.join(tmpdir(t), 'stdin.txt');
  const { runner, ws } = runnerFor(t, { env: { FAKE_CLAUDE_STDIN_OUT: out } });
  fs.writeFileSync(path.join(ws, 'big-note.md'), 'BODY-MARKER-should-never-be-pasted\n'.repeat(100));
  runner.submit({ type: 'research', text: 'look at the note', pointers: ['big-note.md'] });
  await runner.idle();
  const a = fs.readFileSync(out, 'utf8');
  runner.submit({ type: 'code', text: 'something else' });
  await runner.idle();
  const b = fs.readFileSync(out, 'utf8');
  assert.ok(a.startsWith(BRIEF_PREFIX + '\n') && b.startsWith(BRIEF_PREFIX + '\n'), 'identical prefix bytes');
  assert.ok(a.indexOf('## Job') < a.indexOf('## Files'));
  assert.match(a, /^- big-note\.md$/m);
  assert.ok(!a.includes('BODY-MARKER'));
});

test('(c) model per job type reaches the CLI; haiku is refused for claim-touching types', async (t) => {
  const out = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_ARGS_OUT: out } });
  const seen: Record<string, string> = {};
  for (const type of ['answers', 'ingest', 'review'] as const) {
    runner.submit({ type, text: 'x' }); await runner.idle();
    const args = JSON.parse(fs.readFileSync(out, 'utf8')) as string[];
    seen[type] = args[args.indexOf('--model') + 1];
  }
  assert.deepEqual(seen, { answers: 'haiku', ingest: 'sonnet', review: 'opus' });
  const ws = tmpdir(t); fs.mkdirSync(path.join(ws, '.joserah'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.joserah', 'server.json'), JSON.stringify({ models: { lint: 'haiku' } }));
  assert.throws(() => loadServerConfig(ws), ConfigError);
});

test('(d) new answers go to one job; acknowledgement-only answers start no model', async (t) => {
  const { runner, ws } = runnerFor(t, { config: { answerStartsJob: true } });
  const d1 = trackerPage(ws, DAY);
  const d2 = path.join(ws, '.joserah/desk/artifacts', DAY, 'other'); fs.mkdirSync(d2, { recursive: true });
  assert.ok(isAck({ note: 'Tamam.' })); assert.ok(isAck({ note: 'thanks!' })); assert.ok(!isAck({ note: 'tamam ama B olsun' })); assert.ok(!isAck({ key: 'A', note: 'ok' }));
  answersLib.put(d1, 'a-1', { note: 'tamam' }, 'owner');
  // fire() does not use the bus (start() does); a long batch window keeps the follow-up timer out of the test.
  let t2 = new AnswerTrigger({ workspace: ws, bus: undefined as never, jobs: runner, config: () => ({ answerStartsJob: true, answerBatchSec: 3600 }) as never });
  t.after(() => t2.stop());
  assert.equal(t2.fire(), null, 'an acknowledgement alone starts nothing');
  assert.equal(answersLib.read(d1).docs['a-1'].state, 'read', 'and is marked read without a model');
  answersLib.put(d1, 'a-2', { key: 'B', note: 'the short one' }, 'owner');
  answersLib.put(d2, 'a-3', { note: 'please also order two' }, 'owner');
  const job = t2.fire()!;
  assert.equal(job.type, 'answers');
  assert.equal(t2.fire(), null, 'one answers job at a time');
  assert.ok(job.pointers!.some((p) => p.includes('answers.js')));
  assert.ok(job.pointers!.some((p) => p.endsWith(`${DAY}/daily-tracker`)) && job.pointers!.some((p) => p.endsWith(`${DAY}/other`)));
  await runner.idle();
  assert.equal(t2.fire(), null, 'answers already handed to a job are not handed again, even if the job left them unread');
  t2.stop();
  t2 = new AnswerTrigger({ workspace: ws, bus: undefined as never, jobs: runner, config: () => ({ answerStartsJob: false }) as never });
  answersLib.put(d1, 'a-4', { note: 'one more' }, 'owner');
  assert.equal(t2.fire(), null, 'answerStartsJob is off by default');
});

test('(e) each job shows its cost as an estimate; home shows today\'s total', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const j = deps.jobs.submit({ type: 'digest', text: 'x' }); await deps.jobs.idle();
  assert.equal(deps.jobs.todayCostUsd(), 0.0123);
  assert.match(await (await app.request(`/jobs/${j.id}`, { headers: { cookie } })).text(), /\$0\.0123 \(estimate\)/);
  assert.match(await (await app.request('/', { headers: { cookie } })).text(), /<p id="cost">Today(&#39;|')s estimated cost: \$0\.0123 \(estimate\) · cap \$10\.00<\/p>/);
});

test('(f) per-job money cap reaches the CLI; the daily budget stops new jobs', async (t) => {
  const out = path.join(tmpdir(t), 'args.json');
  const { runner } = runnerFor(t, { env: { FAKE_CLAUDE_ARGS_OUT: out }, config: { jobBudgetUsd: 1.5, dailyBudgetUsd: 0.02 } });
  runner.submit({ type: 'task', text: 'one' }); await runner.idle();
  const args = JSON.parse(fs.readFileSync(out, 'utf8')) as string[];
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '1.50');
  runner.submit({ type: 'task', text: 'two' }); await runner.idle(); // 0.0246 spent now
  assert.throws(() => runner.submit({ type: 'task', text: 'three' }), (e: unknown) => e instanceof Refused && e.code === 'daily-budget');
});

test('(f) the daily budget answers 429 to the browser', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const base = deps.config();
  deps.config = () => ({ ...base, dailyBudgetUsd: 0.01 });
  deps.jobs.submit({ type: 'task', text: 'x' }); await deps.jobs.idle();
  const r = await app.request('/api/jobs', { method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'y' }) });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, 'daily-budget');
});
```

For test (f, 429), `deps.config` must be reassignable and read through by the runner: in `baseDeps` build the runner with `config: () => deps.config()` (a closure over `deps`), not over a captured constant.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/token-economy.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/answer-trigger.ts`; once that exists, `todayCostUsd is not a function` and the cost line missing.

- [ ] **Step 3: Write the implementation**

In `server/src/jobs.ts`, add to `JobRunner`:

```ts
  todayCostUsd(): number {
    const day = localDay();
    return Math.round([...this.#jobs.values()].filter((j) => j.day === day).reduce((s, j) => s + (typeof j.costUsd === 'number' ? j.costUsd : 0), 0) * 1e6) / 1e6;
  }
```

and at the top of `submit`, after the type and text checks:

```ts
    const spent = this.todayCostUsd();
    if (spent >= cfg.dailyBudgetUsd) throw new Refused('daily-budget', `today's estimated spend $${spent.toFixed(2)} has reached the daily cap $${cfg.dailyBudgetUsd.toFixed(2)}; jobs start again tomorrow or after the cap is raised in server.json`);
```

(move `const cfg = this.#o.config();` above it).

`server/src/answer-trigger.ts`:

```ts
import path from 'node:path';
import type { EventBus } from './events.ts';
import type { JobRunner, JobRecord } from './jobs.ts';
import type { ServerConfig } from './config.ts';
import { answersLib, type AnswerDoc } from './cjs.ts';
import { toolPath } from './paths.ts';
import { Refused } from './jobs.ts';

// An answer that only acknowledges needs no judgement (B11): it is marked read and starts no model.
export const ACK_RE = /^(ok(ay)?|tamam(d[ıi]r)?|peki|olur|evet|yes|thanks|thank you|te[sş]ekk[uü]r(ler| ederim)?|sa[gğ] ?ol(un)?|anlad[ıi]m|got it|done|👍|✓)[.!\s]*$/iu;
export function isAck(d: AnswerDoc): boolean { return !d.key && !!d.note && ACK_RE.test(d.note.trim()); }

export class AnswerTrigger {
  #o: { workspace: string; bus: EventBus; jobs: JobRunner; config: () => ServerConfig; batchMs?: number };
  #timer: NodeJS.Timeout | null = null;
  #off: (() => void) | null = null;
  #handed = new Set<string>(); // "<dir>#<id>" already given to a job: never handed twice, so a job that leaves answers unread cannot loop
  constructor(o: { workspace: string; bus: EventBus; jobs: JobRunner; config: () => ServerConfig; batchMs?: number }) {
    this.#o = o;
    o.jobs.onEnd((j) => { if (j.type === 'answers') this.#schedule(); });
  }

  start(): void { this.#off = this.#o.bus.subscribe((_id, e) => { if (e.type === 'answers') this.#schedule(); }); }
  stop(): void { this.#off?.(); if (this.#timer) clearTimeout(this.#timer); }

  #schedule(): void {
    if (!this.#o.config().answerStartsJob || this.#timer) return;
    this.#timer = setTimeout(() => { this.#timer = null; this.fire(); }, this.#o.batchMs ?? this.#o.config().answerBatchSec * 1000);
    this.#timer.unref();
  }

  fire(): JobRecord | null {
    if (!this.#o.config().answerStartsJob) return null;
    if (this.#o.jobs.list().some((j) => j.type === 'answers' && (j.state === 'queued' || j.state === 'running'))) return null;
    const pages: string[] = [];
    const keys: string[] = [];
    for (const p of answersLib.newCounts(this.#o.workspace, 2)) {
      const real = answersLib.list(p.dir, { onlyNew: true }).filter((d) => {
        if (isAck(d)) { answersLib.markRead(p.dir, d.id); return false; }
        return !this.#handed.has(`${p.dir}#${d.id}`);
      });
      if (real.length) { pages.push(p.dir); keys.push(...real.map((d) => `${p.dir}#${d.id}`)); }
    }
    const n = keys.length;
    if (!n) return null;
    const tool = toolPath('answers.js');
    try {
      for (const k of keys) this.#handed.add(k);
      return this.#o.jobs.submit({ type: 'answers', text: `Process the ${n} new answer${n === 1 ? '' : 's'} the owner left on ${pages.length === 1 ? 'a page' : `${pages.length} pages`}.`,
        pointers: [`tool: node "${tool}" list|reply|mark <page dir> …`, ...pages.map((d) => path.relative(this.#o.workspace, d).split(path.sep).join('/'))] });
    } catch (e) { for (const k of keys) this.#handed.delete(k); if (e instanceof Refused) return null; throw e; }
  }
}
```

In `server/src/routes/home.ts`, after the job box form, add (labels from `LABELS`):

```ts
<p id="cost">${esc(L.cost)}: $${deps.jobs.todayCostUsd().toFixed(4)} (${esc(L.estimate)}) · cap $${deps.config().dailyBudgetUsd.toFixed(2)}</p>
```

(`L.cost` is "Today's estimated cost" in English, "Bugün tahmini maliyet" in Turkish — Task 4.)

`server/main.ts`: `const answers = new AnswerTrigger({ workspace, bus, jobs, config: () => cfg }); answers.start();` in the serve callback; add `answers` to deps.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `token-economy` (7) and all earlier.

- [ ] **Step 5: Commit**

```bash
git add server/src server/main.ts server/test
git commit -m "server: token economy — daily budget stop, today's cost, answer batching, conformance tests for §7"
```

---

### Task 16: Setup wizard

Five steps, each a live check, never a stored "done" flag: password; workspace; backup history and remote; Claude Code present and signed in; one real one-turn test job (B7: health proves work, not a 200).

**Files:**
- Create: `server/src/routes/setup.ts`
- Modify: `server/src/app.ts` (register), `server/src/security.ts` (nothing — `/setup`, `/api/setup/*`, `/_/setup.js` are already the setup-only paths)
- Test: `server/test/setup.test.ts`

**Interfaces:**
- Consumes: `auth.ts` (`setupToken`, `clearSetupToken`, `newAuthFile`, `writeAuth`, `signSession`, `COOKIE`, `MIN_PASSWORD`); `Engine.health()`; `JobRunner.submit`; `tools/scaffold.js` CLI; git.
- Produces:
  - `GET /setup` — in setup mode needs `?token=` (or the `jsetup` cookie it sets); otherwise `403`. Signed in: the remaining steps with their live state.
  - `POST /api/setup/password {token, password, confirm}` → `201 {next:'/setup'}` + session cookie | `403 {error:'token'}` | `400 {error:'short'|'mismatch'}` | `409 {error:'already-set'}`.
  - Signed-in only (`403 {error:'password-first'}` in setup mode): `POST /api/setup/workspace {owner, name, language}` → `201` | `409 {error:'exists'}`; `POST /api/setup/git-init` → `201 {commit}` | `409 {error:'exists'}`; `POST /api/setup/remote {url}` → `200 {url}` | `400 {error:'bad-url'|'credentials-in-url'}`; `GET /api/setup/engine` → `EngineHealth`; `POST /api/setup/test-job` → `201 {id}`; `GET /api/setup/test-job/:id` → `{state, pass: boolean}`.
  - `wizardPass(job: JobRecord): boolean` — done and the result contains "ready".

- [ ] **Step 1: Write the failing tests**

`server/test/setup.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { setupToken } from '../src/auth.ts';
import { wizardPass } from '../src/routes/setup.ts';
import { baseDeps, signedIn, ORIGIN, tmpdir, git } from './helpers.ts';

const post = (body: unknown, cookie = '') => ({ method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test('the wizard needs the setup token printed at start', async (t) => {
  const deps = baseDeps(t); const app = createApp(deps);
  assert.equal((await app.request('/setup')).status, 403);
  const tok = setupToken(deps.stateDir);
  const r = await app.request(`/setup?token=${tok}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /type="password"/);
});

test('the password step writes the hash outside the workspace and signs in', async (t) => {
  const deps = baseDeps(t); const app = createApp(deps);
  const tok = setupToken(deps.stateDir);
  assert.equal((await app.request('/api/setup/password', post({ token: 'nope', password: 'long-enough-1', confirm: 'long-enough-1' }))).status, 403);
  assert.equal((await app.request('/api/setup/password', post({ token: tok, password: 'short', confirm: 'short' }))).status, 400);
  assert.equal((await app.request('/api/setup/password', post({ token: tok, password: 'long-enough-1', confirm: 'long-enough-2' }))).status, 400);
  const r = await app.request('/api/setup/password', post({ token: tok, password: 'long-enough-1', confirm: 'long-enough-1' }));
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie') ?? '', /^jsid=/);
  assert.ok(fs.existsSync(path.join(deps.stateDir, 'auth.json')));
  assert.ok(path.relative(deps.workspace, deps.stateDir).startsWith('..'), 'the state dir is outside the workspace');
  assert.ok(!fs.existsSync(path.join(deps.stateDir, 'setup-token')));
  assert.equal(deps.auth.state.kind, 'ready');
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  assert.equal((await app.request('/api/setup/password', post({ token: tok, password: 'x'.repeat(12), confirm: 'x'.repeat(12) }, cookie))).status, 409);
});

test('later steps need the password first', async (t) => {
  const deps = baseDeps(t); const app = createApp(deps);
  assert.equal((await app.request('/api/setup/git-init', post({}))).status, 403);
});

test('workspace, backup history and remote steps', async (t) => {
  const empty = path.join(tmpdir(t), 'fresh');
  fs.mkdirSync(empty);
  const { app, deps, cookie } = await signedIn(t, { workspace: empty });
  let r = await app.request('/api/setup/workspace', post({ owner: 'O', name: 'w', language: 'English' }, cookie));
  assert.equal(r.status, 201);
  assert.ok(fs.existsSync(path.join(empty, '.joserah', 'config.json')));
  const gi = fs.readFileSync(path.join(empty, '.gitignore'), 'utf8');
  assert.match(gi, /^keys\/\*$/m, "the scaffold's secret rules");
  assert.match(gi, /desk\/jobs\/\*\*\/\*\.jsonl/, 'and the job-log lines');
  assert.equal((await app.request('/api/setup/workspace', post({ owner: 'O', name: 'w', language: 'English' }, cookie))).status, 409);
  r = await app.request('/api/setup/git-init', post({}, cookie));
  assert.equal(r.status, 201);
  assert.match(git(empty, 'log', '-1', '--format=%s'), /workspace: start/);
  assert.equal((await app.request('/api/setup/remote', post({ url: 'https://u:p@example.invalid/w.git' }, cookie))).status, 400);
  assert.equal((await app.request('/api/setup/remote', post({ url: 'file:///etc' }, cookie))).status, 400);
  r = await app.request('/api/setup/remote', post({ url: 'https://example.invalid/w.git' }, cookie));
  assert.equal(r.status, 200);
  assert.equal(git(empty, 'remote', 'get-url', 'origin').trim(), 'https://example.invalid/w.git');
  void deps;
});

test('the Claude Code step reads health; the test job is one real cheap job', async (t) => {
  const { app, deps, cookie } = await signedIn(t);
  const h = await (await app.request('/api/setup/engine', { headers: { cookie } })).json();
  assert.equal(h.installed, true);
  const r = await app.request('/api/setup/test-job', post({}, cookie));
  assert.equal(r.status, 201);
  const { id } = await r.json();
  const job = deps.jobs.get(id)!;
  assert.equal(job.type, 'bookkeeping');
  assert.equal(job.budgetUsd, 0.05);
  await deps.jobs.idle();
  assert.equal(wizardPass({ ...job, state: 'done', resultText: 'ready' }), true);
  assert.equal(wizardPass({ ...job, state: 'done', resultText: 'Done.' }), false);
  assert.equal(wizardPass({ ...job, state: 'failed', resultText: 'ready' }), false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-concurrency=1 server/test/setup.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` `../src/routes/setup.ts`.

- [ ] **Step 3: Write `server/src/routes/setup.ts`**

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { App, Env } from '../app.ts';
import type { AppDeps } from '../deps.ts';
import type { JobRecord } from '../jobs.ts';
import { ensureJobIgnores } from '../jobs.ts';
import { jsonError } from '../app.ts';
import { setupToken, clearSetupToken, newAuthFile, writeAuth, signSession, COOKIE, MIN_PASSWORD } from '../auth.ts';
import { shell, esc } from '../layout.ts';
import { toolPath } from '../paths.ts';
import { workspaceLang } from '../config.ts';

export function wizardPass(job: JobRecord): boolean { return job.state === 'done' && /\bready\b/i.test(job.resultText ?? ''); }
const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const gitIn = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=Joserah Server', '-c', 'user.email=server@joserah.invalid', ...args], { cwd, encoding: 'utf8', windowsHide: true });

const SETUP_JS = `(function(){function post(u,b){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j})})}
document.querySelectorAll('form[data-step]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var b={};new FormData(f).forEach(function(v,k){b[k]=v});var err=f.querySelector('.err');if(err)err.textContent='';
post('/api/setup/'+f.getAttribute('data-step'),b).then(function(j){if(j.id){var t=setInterval(function(){fetch('/api/setup/test-job/'+j.id,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(s){if(s.state!=='queued'&&s.state!=='running'){clearInterval(t);location.reload()}})},2000)}else location.href='/setup'},function(x){if(err)err.textContent=(x&&(x.message||x.error))||'error'})})})})();`;

export function register(app: App, deps: AppDeps): void {
  const tr = () => workspaceLang(deps.workspace) === 'tr';
  const ready = () => deps.auth.state.kind === 'ready';
  let lastTest: string | null = null;

  app.get('/_/setup.js', (c) => c.body(SETUP_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));

  app.get('/setup', async (c) => {
    if (!ready()) {
      const tok = setupToken(deps.stateDir);
      const given = c.req.query('token') ?? getCookie(c, 'jsetup') ?? '';
      if (!same(given, tok)) return c.html(shell({ title: 'Setup', lang: tr() ? 'tr' : 'en', nav: false, body: `<p>${tr() ? 'Kurulum bağlantısını sunucunun başlarken yazdığı satırdan açın.' : 'Open the setup link the server printed when it started.'}</p>` }), 403);
      setCookie(c, 'jsetup', tok, { httpOnly: true, sameSite: 'Strict', path: '/', secure: deps.secureCookies, maxAge: 3600 });
      return c.html(shell({ title: 'Setup', lang: tr() ? 'tr' : 'en', nav: false, body: `<h1>${tr() ? 'Kurulum' : 'Setup'} 1/5</h1>
<form data-step="password"><input type="hidden" name="token" value="${esc(tok)}"><p><label>${tr() ? 'Parola' : 'Password'} (≥ ${MIN_PASSWORD})<br><input type="password" name="password" minlength="${MIN_PASSWORD}" required autocomplete="new-password"></label></p>
<p><label>${tr() ? 'Tekrar' : 'Again'}<br><input type="password" name="confirm" required autocomplete="new-password"></label></p><p><button>OK</button> <span class="err"></span></p></form><script src="/_/setup.js"></script>` }));
    }
    const ws = deps.workspace;
    const hasWs = fs.existsSync(path.join(ws, '.joserah', 'config.json'));
    const isRepo = gitIn(ws, 'rev-parse', '--is-inside-work-tree').status === 0;
    const remote = isRepo ? gitIn(ws, 'remote', 'get-url', 'origin').stdout.trim() : '';
    const h = await deps.engine.health(); deps.engineHealth = h; deps.health.signedIn = h.signedIn;
    const test = lastTest ? deps.jobs.get(lastTest) : undefined;
    const ok = (b: boolean) => (b ? '✓' : '·');
    const docker = process.env.JOSERAH_IN_DOCKER === '1';
    const body = `<h1>${tr() ? 'Kurulum' : 'Setup'}</h1>
<h2>${ok(true)} 1. ${tr() ? 'Parola' : 'Password'}</h2>
<h2>${ok(hasWs)} 2. ${tr() ? 'Çalışma alanı' : 'Workspace'}</h2><p class="muted">${esc(ws)}</p>
${hasWs ? '' : `<form data-step="workspace"><input name="owner" required placeholder="${tr() ? 'Adınız' : 'Your name'}"> <input name="name" required placeholder="${tr() ? 'Çalışma alanı adı' : 'Workspace name'}"> <select name="language"><option>Turkish</option><option>English</option></select> <button>OK</button> <span class="err"></span></form>`}
<h2>${ok(isRepo && !!remote)} 3. ${tr() ? 'Yedek' : 'Backup'}</h2>
${isRepo ? '' : `<form data-step="git-init"><button>${tr() ? 'Yedek geçmişini başlat' : 'Start the backup history'}</button> <span class="err"></span></form>`}
<form data-step="remote"><input name="url" type="url" required value="${esc(remote)}" placeholder="https://…/workspace.git"> <button>OK</button> <span class="err"></span></form>
<h2>${ok(h.installed && h.signedIn)} 4. Claude Code</h2><p>${esc(h.installed ? `${h.version} · ${h.detail}` : h.detail)}</p>
${h.signedIn ? '' : `<p>${tr() ? 'Bir terminalde bir kez çalıştırıp giriş yapın:' : 'Run once in a terminal and sign in:'} <code>${docker ? 'docker exec -it -w /workspace joserah claude' : 'claude'}</code> — ${tr() ? 'sonra bu sayfayı yenileyin.' : 'then reload this page.'}</p>`}
<h2>${ok(!!test && wizardPass(test))} 5. ${tr() ? 'Deneme işi' : 'Test job'}</h2>${test ? `<p>${esc(test.state)} · ${esc(test.resultText ?? test.error ?? '')}</p>` : ''}
${h.signedIn ? `<form data-step="test-job"><button>${tr() ? 'Deneme işini çalıştır' : 'Run the test job'}</button> <span class="err"></span></form>` : ''}
<p><a href="/">${tr() ? 'Ana sayfa' : 'Home'}</a></p><script src="/_/setup.js"></script>`;
    return c.html(shell({ title: 'Setup', lang: tr() ? 'tr' : 'en', body }));
  });

  app.post('/api/setup/password', async (c) => {
    if (ready()) return jsonError(c, 409, 'already-set');
    const b = await c.req.json().catch(() => ({})) as { token?: string; password?: string; confirm?: string };
    if (!same(String(b.token ?? ''), setupToken(deps.stateDir))) return jsonError(c, 403, 'token');
    const pw = String(b.password ?? '');
    if (pw.length < MIN_PASSWORD) return jsonError(c, 400, 'short', { message: `at least ${MIN_PASSWORD} characters` });
    if (pw !== String(b.confirm ?? '')) return jsonError(c, 400, 'mismatch');
    const file = newAuthFile(pw);
    writeAuth(deps.stateDir, file);
    clearSetupToken(deps.stateDir);
    deps.auth.state = { kind: 'ready', file };
    setCookie(c, COOKIE, signSession(file), { httpOnly: true, sameSite: 'Strict', path: '/', secure: deps.secureCookies, maxAge: 30 * 86400 });
    return c.json({ next: '/setup' }, 201);
  });

  const signedOnly = (c: Context<Env>) => (ready() && c.get('signedIn') ? null : jsonError(c, 403, 'password-first'));

  app.post('/api/setup/workspace', async (c) => {
    const no = signedOnly(c); if (no) return no;
    if (fs.existsSync(path.join(deps.workspace, '.joserah', 'config.json'))) return jsonError(c, 409, 'exists');
    const b = await c.req.json().catch(() => ({})) as { owner?: string; name?: string; language?: string };
    const owner = String(b.owner ?? '').trim(); const name = String(b.name ?? '').trim(); const language = b.language === 'English' ? 'English' : 'Turkish';
    if (!owner || !name) return jsonError(c, 400, 'missing');
    const r = spawnSync(process.execPath, [toolPath('scaffold.js'), '--target', deps.workspace, '--owner', owner, '--workspace', name, '--language', language, '--role', ''], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return jsonError(c, 500, 'scaffold', { message: (r.stderr || r.stdout).trim().split('\n')[0] });
    ensureJobIgnores(deps.workspace); // now that the scaffold wrote its .gitignore
    return c.json({ ok: true }, 201);
  });

  app.post('/api/setup/git-init', (c) => {
    const no = signedOnly(c); if (no) return no;
    if (gitIn(deps.workspace, 'rev-parse', '--is-inside-work-tree').status === 0) return jsonError(c, 409, 'exists');
    for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '--allow-empty', '-m', 'workspace: start', '-m', 'Joserah Server']]) {
      const r = gitIn(deps.workspace, ...args);
      if (r.status !== 0) return jsonError(c, 500, 'git', { message: r.stderr.trim().split('\n')[0] });
    }
    return c.json({ commit: gitIn(deps.workspace, 'rev-parse', 'HEAD').stdout.trim() }, 201);
  });

  app.post('/api/setup/remote', async (c) => {
    const no = signedOnly(c); if (no) return no;
    const b = await c.req.json().catch(() => ({})) as { url?: string };
    const url = String(b.url ?? '').trim();
    if (/^https?:\/\/[^/@\s]+@/i.test(url)) return jsonError(c, 400, 'credentials-in-url', { message: 'put the token in the vault, not in the address' });
    if (!/^(https:\/\/|ssh:\/\/|git@)[^\s]+$/.test(url)) return jsonError(c, 400, 'bad-url');
    const has = gitIn(deps.workspace, 'remote', 'get-url', 'origin').status === 0;
    const r = gitIn(deps.workspace, 'remote', has ? 'set-url' : 'add', 'origin', url);
    return r.status === 0 ? c.json({ url }) : jsonError(c, 500, 'git', { message: r.stderr.trim().split('\n')[0] });
  });

  app.get('/api/setup/engine', async (c) => {
    const no = signedOnly(c); if (no) return no;
    const h = await deps.engine.health(); deps.engineHealth = h; deps.health.signedIn = h.signedIn;
    return c.json(h);
  });

  app.post('/api/setup/test-job', (c) => {
    const no = signedOnly(c); if (no) return no;
    const j = deps.jobs.submit({ type: 'bookkeeping', text: 'This is the setup check. Reply with the single word: ready', budgetUsd: 0.05 });
    lastTest = j.id;
    return c.json({ id: j.id }, 201);
  });

  app.get('/api/setup/test-job/:id', (c) => {
    const no = signedOnly(c); if (no) return no;
    const j = deps.jobs.get(c.req.param('id'));
    return j ? c.json({ state: j.state, pass: wizardPass(j) }) : jsonError(c, 404, 'not-found');
  });
}
```

Register `setupRoutes(app, deps)` in `createApp` right after `authRoutes`. The guard (Task 4) lets `/setup`, `/api/setup/*` and `/_/setup.js` through in setup mode; in ready mode they need a session like everything else, and `signedOnly` refuses the non-password steps in setup mode.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts"`
Expected: PASS — `setup` (5) and all earlier.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test
git commit -m "server: setup wizard — password, workspace, backup, Claude Code sign-in check, one real test job"
```

---

### Task 17: Docker image, compose and a smoke run

Self-contained: the image carries Node, git, Claude Code (pinned), the plugin and the server; the workspace, the Claude Code login and the server's secrets live in three named volumes; nothing is shared from the host; the port is published to `127.0.0.1` only. **One heavy thing at a time** (rule 6): nothing else builds or runs a browser while this task builds.

**Files:**
- Create: `server/Dockerfile`, `server/compose.yaml`, `server/compose.gpu.yaml`, `server/docker/claude`, `server/docker/smoke.sh`, `.dockerignore`
- Modify: `server/main.ts` (engine command from `JOSERAH_CLAUDE_BIN`, optional `JOSERAH_CLAUDE_PREFIX` for tests — see Task 18)
- Test: `server/test/docker-files.test.ts` (in the suite), `server/docker/smoke.sh` (run by hand, not in the suite)

**Interfaces:**
- Consumes: `server/main.ts` (`--workspace`), `JOSERAH_IN_DOCKER`, `JOSERAH_STATE_DIR`, `/healthz`.
- Produces: image `joserah:dev`; container name `${JOSERAH_CONTAINER:-joserah}`; volumes `${JOSERAH_VOLUME_PREFIX:-joserah}-workspace`, `-claude`, `-state`; host port `127.0.0.1:${JOSERAH_HOST_PORT:-4747}`; passthrough of `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` from the host environment when set (Task 20 fallback); the terminal door `docker exec -it -w /workspace joserah claude`.

- [ ] **Step 1: Write the failing file test**

`server/test/docker-files.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT, REPO_ROOT } from './helpers.ts';

const read = (p: string) => fs.readFileSync(path.join(SERVER_ROOT, p), 'utf8');

test('the image is non-root, pinned, self-contained and healthchecked', () => {
  const d = read('Dockerfile');
  assert.match(d, /^FROM node:24-slim$/m);
  assert.match(d, /^ARG CLAUDE_CODE_VERSION=2\.1\.289$/m);
  assert.match(d, /claude\.ai\/install\.sh \| bash -s "?\$\{CLAUDE_CODE_VERSION\}"?/);
  assert.match(d, /^USER joserah$/m);
  assert.match(d, /DISABLE_AUTOUPDATER=1/); assert.match(d, /JOSERAH_IN_DOCKER=1/); assert.match(d, /CLAUDE_CONFIG_DIR=\/home\/joserah\/\.claude/); assert.match(d, /JOSERAH_STATE_DIR=\/home\/joserah\/state/);
  assert.match(d, /^HEALTHCHECK /m);
  assert.match(d, /npm ci --omit=dev/);
});

test('compose publishes one port on 127.0.0.1 and shares nothing from the host', () => {
  const c = read('compose.yaml');
  assert.match(c, /"127\.0\.0\.1:\$\{JOSERAH_HOST_PORT:-4747\}:4747"/);
  assert.equal((c.match(/:4747"/g) ?? []).length, 1, 'one published port');
  for (const line of c.split('\n').filter((l) => /^\s+- .*:\/(workspace|home)/.test(l))) assert.match(line, /^\s+- (workspace|claude|state):\//, `named volume only: ${line}`);
  assert.doesNotMatch(c, /- \.\.?\//, 'no host bind mount');
  assert.match(read('compose.gpu.yaml'), /gpus: all/);
});

test('the claude wrapper loads the plugin for sessions and passes subcommands through', () => {
  const w = read('docker/claude');
  assert.match(w, /^#!\/usr\/bin\/env bash/);
  assert.match(w, /--plugin-dir \/opt\/joserah/);
  assert.match(w, /auth\|setup-token/);
  assert.ok(!w.includes('\r'));
});

test('.dockerignore keeps node_modules and git history out of the image', () => {
  const i = fs.readFileSync(path.join(REPO_ROOT, '.dockerignore'), 'utf8');
  for (const l of ['**/node_modules', '.git']) assert.ok(i.split('\n').includes(l), l);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-concurrency=1 server/test/docker-files.test.ts`
Expected: FAIL — `ENOENT ... Dockerfile`.

- [ ] **Step 3: Write the files**

`server/Dockerfile` (build context: the repository root):

```dockerfile
FROM node:24-slim
ARG CLAUDE_CODE_VERSION=2.1.289
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl bash ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 --shell /bin/bash joserah \
 && mkdir -p /workspace /home/joserah/.claude /home/joserah/state /opt/joserah \
 && chown -R joserah:joserah /workspace /home/joserah /opt/joserah
USER joserah
ENV PATH=/opt/joserah/server/docker:/home/joserah/.local/bin:$PATH \
    CLAUDE_CONFIG_DIR=/home/joserah/.claude \
    DISABLE_AUTOUPDATER=1 \
    JOSERAH_IN_DOCKER=1 \
    JOSERAH_STATE_DIR=/home/joserah/state \
    LANG=C.UTF-8
RUN curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_CODE_VERSION}" \
 && /home/joserah/.local/bin/claude --version
COPY --chown=joserah:joserah . /opt/joserah
RUN cd /opt/joserah/server && npm ci --omit=dev && chmod +x /opt/joserah/server/docker/claude
WORKDIR /workspace
VOLUME ["/workspace", "/home/joserah/.claude", "/home/joserah/state"]
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4747/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/opt/joserah/server/main.ts", "--workspace", "/workspace"]
```

If the native installer fails inside the build (it is the documented method, verified in the docs on 2026-10-06, but not yet run in this image), replace the `RUN curl …` line with the documented npm route and nothing else:

```dockerfile
ENV NPM_CONFIG_PREFIX=/home/joserah/.local
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && /home/joserah/.local/bin/claude --version
```

and update the Dockerfile test's installer line to match; say so in the commit message.

`server/compose.yaml`:

```yaml
name: joserah
services:
  joserah:
    image: joserah:dev
    build:
      context: ..
      dockerfile: server/Dockerfile
    container_name: ${JOSERAH_CONTAINER:-joserah}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${JOSERAH_HOST_PORT:-4747}:4747"
    environment:
      - CLAUDE_CODE_OAUTH_TOKEN
      - ANTHROPIC_API_KEY
    volumes:
      - workspace:/workspace
      - claude:/home/joserah/.claude
      - state:/home/joserah/state
volumes:
  workspace:
    name: ${JOSERAH_VOLUME_PREFIX:-joserah}-workspace
  claude:
    name: ${JOSERAH_VOLUME_PREFIX:-joserah}-claude
  state:
    name: ${JOSERAH_VOLUME_PREFIX:-joserah}-state
```

`server/compose.gpu.yaml`:

```yaml
# Optional: docker compose -f compose.yaml -f compose.gpu.yaml up -d
services:
  joserah:
    gpus: all
```

`server/docker/claude`:

```bash
#!/usr/bin/env bash
# The image's `claude`: the real binary, with the Joserah plugin loaded for sessions (jobs and the
# terminal door). Subcommands and plain flags pass straight through.
REAL=/home/joserah/.local/bin/claude
case "${1:-}" in
  auth|setup-token|install|update|doctor|plugin|plugins|mcp|--version|-v|--help|-h) exec "$REAL" "$@" ;;
  *) exec "$REAL" --plugin-dir /opt/joserah "$@" ;;
esac
```

`server/docker/smoke.sh`:

```bash
#!/usr/bin/env bash
# Build the image and prove the container serves, without touching the real `joserah` container or volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
export JOSERAH_CONTAINER=joserah-smoke JOSERAH_HOST_PORT=14747 JOSERAH_VOLUME_PREFIX=joserah-smoke
C="docker compose -p joserah-smoke -f compose.yaml"
$C build
$C up -d
trap '$C down -v >/dev/null 2>&1 || true' EXIT
H=$(curl -fsS --retry 30 --retry-connrefused --retry-delay 2 http://127.0.0.1:14747/healthz)
echo "healthz: $H"
[ "$H" = '{"alive":true,"signedIn":false,"lastJobOk":null}' ]
[ "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:14747/)" = "302 http://127.0.0.1:14747/setup" ]
docker exec joserah-smoke claude --version | grep -q '^2\.1\.289 (Claude Code)$'
[ "$(docker exec joserah-smoke id -u)" = "10001" ]
docker exec joserah-smoke test -f /home/joserah/state/setup-token
docker exec joserah-smoke sh -c 'test ! -e /workspace/keys/server'
[ "$(docker logs joserah-smoke 2>&1 | grep -c 'First start — open http://127.0.0.1:4747/setup?token=')" = "1" ]
docker port joserah-smoke | grep -q '^4747/tcp -> 127.0.0.1:14747$'
echo "smoke: ok"
```

`.dockerignore` (repository root):

```
**/node_modules
.git
.superpowers
server/test/browser/.cache
*.log
```

`server/main.ts`: the engine becomes

```ts
const engine = new ClaudeCliEngine({ command: process.env.JOSERAH_CLAUDE_BIN || 'claude', prefixArgs: process.env.JOSERAH_CLAUDE_PREFIX ? [process.env.JOSERAH_CLAUDE_PREFIX] : [] });
```

(`JOSERAH_CLAUDE_PREFIX` exists for the browser test, which runs the fake CLI through `node`. Both variables are server-only: `jobEnv()` never passes `JOSERAH_*` to a job.)

- [ ] **Step 4: Run the file test**

Run: `node --test --test-concurrency=1 server/test/docker-files.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Build and smoke — alone on the machine**

Run: `chmod +x server/docker/claude server/docker/smoke.sh && git update-index --chmod=+x server/docker/claude server/docker/smoke.sh && bash server/docker/smoke.sh`
Expected: the build completes; the last lines are `healthz: {"alive":true,"signedIn":false,"lastJobOk":null}` and `smoke: ok`; the trap removes the smoke container and its three volumes (`docker volume ls | grep -c joserah-smoke` → `0`).

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile server/compose.yaml server/compose.gpu.yaml server/docker .dockerignore server/main.ts server/test/docker-files.test.ts
git commit -m "server: self-contained Docker image, compose with named volumes and a local-only port, smoke run"
```

---

### Task 18: One browser test — answer a Tracker row through the shim, see it come back over SSE

**Files:**
- Create: `server/test/browser/answer.e2e.ts`
- Test: itself (run on its own; not in the default glob, because it starts a real server and a browser)

**Interfaces:**
- Consumes: the whole server through `node server/main.ts`; `tools/tracker.js`; `tools/answers.js`; `newAuthFile`/`writeAuth`; `JOSERAH_CLAUDE_BIN` + `JOSERAH_CLAUDE_PREFIX` (Task 17).
- Produces: nothing new; it pins Review Focus 5 (signed-out banner) in a real browser and the phone-width rule (decision 9).

- [ ] **Step 1: Install the browser — alone on the machine**

Run: `npx --prefix server playwright install chromium`
Expected: `chromium ... downloaded` (or already present). Nothing else heavy runs meanwhile.

- [ ] **Step 2: Write the test**

`server/test/browser/answer.e2e.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { newAuthFile, writeAuth } from '../../src/auth.ts';
import { localDay } from '../../src/paths.ts';
import { REPO_ROOT, SERVER_ROOT, FAKE_CLAUDE } from '../helpers.ts';

const PW = 'pw-0123456789';
const free = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const tool = (name: string, args: string[]) => { const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', name), ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };

let server: ChildProcess; let browser: Browser; let base = ''; let ws = ''; let page = '';

test.before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'joserah-e2e-'));
  ws = path.join(root, 'ws'); const state = path.join(root, 'state');
  tool('scaffold.js', ['--target', ws, '--owner', 'O', '--workspace', 'w', '--language', 'en', '--role', 'r']);
  page = path.join(ws, '.joserah/desk/artifacts', localDay(), 'daily-tracker');
  tool('tracker.js', ['init', page, '--title', 'Daily Tracker', '--lang', 'en']);
  tool('tracker.js', ['row', page, '--title', 'Which cable?', '--state', 'you', '--option', 'A|Long cable', '--option', 'B|Short cable', '--recommend', 'B', '--why', 'fits the rack']);
  writeAuth(state, newAuthFile(PW));
  const port = await free(); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(SERVER_ROOT, 'main.ts'), '--workspace', ws, '--port', String(port)],
    { env: { ...process.env, JOSERAH_STATE_DIR: state, JOSERAH_CLAUDE_BIN: process.execPath, JOSERAH_CLAUDE_PREFIX: FAKE_CLAUDE }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => { server.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('Joserah server:')) resolve(); }); server.on('exit', (c) => reject(new Error(`server exit ${c}`))); });
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.kill(); });

test('answer a row from the page and see the reply come back live', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  let loads = 0; p.on('load', () => { loads += 1; });
  await p.goto(`${base}/p/tracker`);
  assert.match(p.url(), /\/login\?next=/);
  await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL(/\/p\/\d{4}-\d{2}-\d{2}\/daily-tracker\/$/), p.click('form[action="/login"] button')]);
  await p.click('button.tx >> text=Which cable?');
  await p.click('li[data-k="B"]');
  await p.fill('form.ans[data-choice] input', 'the short one');
  await p.click('form.ans[data-choice] .send');
  await p.waitForSelector('[data-an]:has-text("answered: B")');
  const id = await p.getAttribute('form.ans[data-choice]', 'data-ans');
  const docs = JSON.parse(fs.readFileSync(path.join(page, 'answers.json'), 'utf8')).docs;
  assert.equal(docs[id!].key, 'B');
  loads = 0;
  tool('answers.js', ['reply', page, id!, '--note', 'Ordered the short one.']);
  await p.waitForSelector('ol.th li.as:has-text("Ordered the short one.")', { timeout: 10000 });
  assert.ok(loads <= 1, `no reload loop (${loads} loads)`);
  await ctx.close();
});

test('every server page fits a 390 px screen', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/login`);
  await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL(`${base}/`), p.click('form[action="/login"] button')]);
  for (const u of ['/', '/p/tracker', '/tv', '/w/', '/w/claims', '/jobs']) {
    await p.goto(base + u);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `${u} is ${w}px wide`);
  }
  await ctx.close();
});

test('signed-out banner', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/login?next=%2Fp%2Ftracker`);
  await p.fill('input[name="password"]', PW);
  await Promise.all([p.waitForURL(/daily-tracker\/$/), p.click('form[action="/login"] button')]);
  await ctx.clearCookies();
  await p.click('button.tx >> text=Which cable?');
  await p.fill('form.ans[data-choice] input', 'after sign-out');
  await p.click('form.ans[data-choice] .send');
  const banner = p.locator('#jh-out');
  await banner.waitFor();
  assert.match(await banner.innerText(), /Signed out/);
  assert.match((await banner.locator('a').getAttribute('href'))!, /^\/login\?next=%2Fp%2F/);
  await ctx.close();
});
```

Before running, open `tools/tracker.js` `formOf`/`detailOf` (lines 569-633) and confirm the selectors the test uses (`button.tx`, `li[data-k]`, `form.ans[data-choice]`, `.send`, `[data-an]`, `ol.th li.as`); if one differs, change the **test's** selector, never the tool. If `/p/tracker` or `/tv` is wider than 390 px, the fix goes into `templates/tracker/index.html` (re-rendered pages pick it up) or `TV_CSS` — never into `tools/tracker.js` (Global Constraints) — and is reported to the orchestrator as a finding.

- [ ] **Step 3: Run it**

Run: `node --test --test-concurrency=1 server/test/browser/answer.e2e.ts`
Expected: PASS (3). A failure in the first test after "answered: B" means the reply did not travel CLI → `answers.json` → mtime poll (2 s) → `answers` event → shim `refresh()` → `onSnapshot` → thread; check each hop in that order.

- [ ] **Step 4: Commit**

```bash
git add server/test/browser/answer.e2e.ts
git commit -m "server: browser test — answer through the shim, live reply over SSE, phone width, signed-out banner"
```

---

### Task 19: `joserah serve`, the docs and the release

**Files:**
- Create: `server/bin/joserah.mjs`, `server/README.md`, `server/test/serve.test.ts`
- Modify: `README.md` (a short "The web server" section), `CHANGELOG.md` (`## 0.19.0`), `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (0.18.1 → 0.19.0)

**Interfaces:**
- Consumes: `server/main.ts`; `stateDir()`; `setup-token` in the state dir.
- Produces: `node server/bin/joserah.mjs serve [--workspace <dir>] [--port <n>]` (finds the workspace by walking up from the current folder; prints the URL; opens no window; refuses Node < 22.18); `node server/bin/joserah.mjs setup-link [--workspace <dir>] [--port <n>]` (prints the one-time setup link from the state dir, or `already set up`); `npm --prefix server link` exposes `joserah`.

- [ ] **Step 1: Write the failing test**

`server/test/serve.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { SERVER_ROOT, tmpdir, tmpWorkspace } from './helpers.ts';
import { setupToken } from '../src/auth.ts';

const BIN = path.join(SERVER_ROOT, 'bin', 'joserah.mjs');
const free = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });

test('usage and a folder outside any workspace are refused plainly', (t) => {
  let r = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /usage: joserah serve/);
  r = spawnSync(process.execPath, [BIN, 'serve'], { cwd: tmpdir(t), encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /no workspace here/);
});

test('serve finds the workspace from a subfolder and prints its URL', async (t) => {
  const ws = tmpWorkspace(t); const port = await free();
  const child = spawn(process.execPath, [BIN, 'serve', '--port', String(port)], { cwd: path.join(ws, '.joserah'), env: { ...process.env, JOSERAH_STATE_DIR: path.join(tmpdir(t), 's') } });
  t.after(() => child.kill());
  const line = await new Promise<string>((resolve, reject) => {
    let out = ''; child.stdout.on('data', (d: Buffer) => { out += d; if (out.includes('/setup?token=')) resolve(out); });
    setTimeout(() => reject(new Error(`no URL: ${out}`)), 15000).unref();
  });
  assert.match(line, new RegExp(`Joserah server: http://127\\.0\\.0\\.1:${port}/`));
});

test('setup-link prints the link from the state dir, never creating a password', (t) => {
  const ws = tmpWorkspace(t); const s = path.join(tmpdir(t), 's');
  const tok = setupToken(s);
  const r = spawnSync(process.execPath, [BIN, 'setup-link', '--workspace', ws], { encoding: 'utf8', env: { ...process.env, JOSERAH_STATE_DIR: s } });
  assert.equal(r.stdout.trim(), `http://127.0.0.1:4747/setup?token=${tok}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-concurrency=1 server/test/serve.test.ts`
Expected: FAIL — `Cannot find module …/bin/joserah.mjs`.

- [ ] **Step 3: Write `server/bin/joserah.mjs`**

```js
#!/usr/bin/env node
// joserah serve [--workspace <dir>] [--port <n>]  — run the Joserah server for this workspace.
// joserah setup-link [--workspace <dir>] [--port <n>] — print the one-time setup link (first start only).
// Plain JavaScript on purpose: it must start on any Node and say plainly when Node is too old.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const here = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
const [cmd, ...args] = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(`joserah: ${m}`); process.exit(1); };
if (cmd !== 'serve' && cmd !== 'setup-link') { console.error('usage: joserah serve [--workspace <dir>] [--port <n>] | joserah setup-link [--workspace <dir>]'); process.exit(1); }

function findWs(start) {
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.joserah', 'config.json'))) return d;
    if (path.dirname(d) === d) return null;
  }
}
const ws = opt('--workspace') ? path.resolve(opt('--workspace')) : findWs(process.cwd());
if (!ws) die('no workspace here — run it inside a Joserah workspace or pass --workspace <dir>');

if (cmd === 'setup-link') {
  const state = process.env.JOSERAH_STATE_DIR || path.join(os.homedir(), '.joserah-server', crypto.createHash('sha1').update(path.resolve(ws)).digest('hex').slice(0, 12));
  if (fs.existsSync(path.join(state, 'auth.json'))) { console.log('already set up — sign in at the server address'); process.exit(0); }
  let tok = ''; try { tok = fs.readFileSync(path.join(state, 'setup-token'), 'utf8').trim(); } catch { die('start the server once first (joserah serve)'); }
  console.log(`http://127.0.0.1:${opt('--port') || 4747}/setup?token=${tok}`);
  process.exit(0);
}

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 18)) die(`Node ${process.versions.node} is too old — the server needs 22.18 or newer`);
const child = spawn(process.execPath, [path.join(here, '..', 'main.ts'), '--workspace', ws, ...(opt('--port') ? ['--port', opt('--port')] : [])], { stdio: 'inherit' });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', (code) => process.exit(code ?? 1));
```

(`stateDir()` in `server/src/paths.ts` and this launcher compute the same folder; keep the two in step — the test above pins it through `JOSERAH_STATE_DIR`, and `setup-link` reads the default folder exactly as `stateDir()` builds it.)

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test --test-concurrency=1 server/test/serve.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Write the docs**

`server/README.md` — sections, in this order, each a few lines, no personal data:

1. **What it is** — the web door to a Joserah workspace: live pages, answers from the page, jobs run by your own signed-in Claude Code; the terminal plugin keeps working on the same files.
2. **Native** — Node ≥ 22.18, git, Claude Code signed in. `npm --prefix <plugin>/server ci`, then from inside the workspace `node <plugin>/server/bin/joserah.mjs serve` (or `npm --prefix <plugin>/server link` once, then `joserah serve`). It prints `Joserah server: http://127.0.0.1:4747/` and, on the first start, the one-time setup link; `joserah setup-link` prints it again.
3. **Docker** — `docker compose -f server/compose.yaml up -d --build`; setup link: `docker logs joserah | grep setup`; sign Claude Code in once with `docker exec -it -w /workspace joserah claude` and `/login`; GPU: add `-f server/compose.gpu.yaml`; the three volumes and what each holds; full copy: `docker run --rm -v joserah-workspace:/w -v "$PWD":/out busybox tar czf /out/workspace.tgz -C /w .`.
4. **Access** — `.joserah/server.json` `exposure`: `local` (default), `tailnet` with `bind` set to the machine's tailnet address (Tailscale encrypts), `internet` only with `https` certificate files or `proxy: true` behind an HTTPS reverse proxy. In Docker, change the published address in `compose.yaml` instead of `bind`.
5. **Settings** — every key of `server.json` with its default (copy `DEFAULT_CONFIG` and `DEFAULT_MODELS` from `server/src/config.ts`), including that `answerStartsJob` and `nightlyLlmLint` are off until switched on, and that Haiku is refused for `ingest`, `query`, `lint`, `research`, `plan`, `review`.
6. **Safety** — the password and cookie key live outside the workspace; every job is preceded by a checkpoint commit and followed by a changed-file list; deletions and writes outside a job's area raise an owner row; raw job logs stay out of the backup and are deleted after 30 days.
7. **Costs** — each job shows the CLI's estimate; the per-job cap and the daily budget.
8. **Troubleshooting** — "Jobs cannot start" (Claude Code missing or signed out), "the workspace is not a git repository" (wizard step 3), a page that says "signed out", a port already in use (`--port`).

`README.md` — after the install section, add:

```markdown
## The web server (0.19.0)

Joserah can also run as a small web server on your machine: the Tracker and other pages live in the
browser, you answer rows there, and give jobs that your own signed-in Claude Code carries out. It runs
natively (`joserah serve`) or self-contained in Docker. See [server/README.md](server/README.md).
```

`CHANGELOG.md` — a new section at the top:

```markdown
## 0.19.0

0.19.0 — the web server: the workspace in your browser, jobs behind it. Owner, 2026-10-05.

- **Your pages, live in the browser.** `joserah serve` (or the Docker image) serves the Daily Tracker, Trails, Cases, Markdown reports and the knowledge wiki on this computer only, behind a password. Pages update by themselves when something changes; a phone works, and `/tv` shows the Tracker large for a screen on the wall.
- **Answer on the page.** Choices and notes you leave on a row are kept in the page's folder; the assistant reads them at the next session start (`tools/answers.js`) and replies in the same thread. Nothing is overwritten: your answer and the assistant's reply are separate.
- **Give a job from the browser.** It runs with your own Claude Code, starts fresh every time, shows its stream, its changed files and an estimated cost; it can be stopped, answered, retried. Before each job the workspace is saved, and any deletion or write outside the job's area waits for you on the Tracker.
- **The wiki, visible.** Pages with backlinks, a search, a claims view where a measurement stands beside the calculation it outranks, a log, and checks that run on every change at no cost. Drop a file to have it read into the wiki; a file that looks like it holds a password is held back for you first.
- **Spending stays yours.** Jobs that start by themselves are off until you switch them on; there is a cap per job and per day.
```

Version bump: `.claude-plugin/plugin.json` `"version": "0.19.0"`; `.claude-plugin/marketplace.json` `metadata.version` and `plugins[0].version` `"0.19.0"`.

- [ ] **Step 6: Run both suites**

Run: `node --test --test-concurrency=1 "server/test/*.test.ts" && node --test tests/*.test.js 2>&1 | tail -4`
Expected: server suite `# fail 0`; existing suite `# fail 0` (the changelog and version tests pass with the new section and the bumped versions).

- [ ] **Step 7: Commit**

```bash
git add server/bin server/README.md server/test/serve.test.ts README.md CHANGELOG.md .claude-plugin
git commit -m "server: joserah serve and setup-link, docs, 0.19.0"
```

- [ ] **Step 8: Start it on this machine (orchestrator, not a worker)**

The morning target (handoff, 2026-10-06): the server running on the owner's PC, port 4747, against the owner's workspace. `<repo>` is this repository's checkout and `<workspace>` the workspace root that holds it (no machine paths in the repository, CONTRIBUTING.md). The orchestrator runs, in the background:

Run: `node <repo>/server/bin/joserah.mjs serve --workspace <workspace> > "<scratchpad>/joserah-server.log" 2>&1`
Expected: `curl -s --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:4747/healthz` → `{"alive":true,"signedIn":true,"lastJobOk":null}` (`signedIn` reads `null` for the first seconds, until the first health check returns); the workspace `.gitignore` gained the two job-log lines (the log says so). The setup link is in the log file: the orchestrator does **not** copy it into chat, a note or the Tracker — the owner prints it in Task 20 step 1.

---

### Task 20: Owner present — not for agents

Each step needs a person at the keyboard (a browser sign-in, `/plugin install`, a password). An agent may prepare the commands; it does not run them.

- [ ] **Step 1: Set the password (native).** In your own terminal: `node <repo>/server/bin/joserah.mjs setup-link --workspace <workspace>` → open the link → choose a password (10+ characters) → walk the wizard: workspace ✓, backup ✓ (the existing remote shows), Claude Code ✓, **Run the test job** → `ready`.
- [ ] **Step 2: Install the three outside skills** in a Claude Code session in this repository: `/plugin marketplace add honojs/skills`, `/plugin install hono@hono`, `/plugin install security-guidance@claude-plugins-official`, `/plugin install typescript-lsp@claude-plugins-official`. Expected: each reports installed; `/plugin` lists them.
- [ ] **Step 3: Claude Code sign-in inside the container (the spike, spec §4).** `docker compose -f server/compose.yaml up -d --build` (alone on the machine) → `docker logs joserah 2>&1 | grep setup` → open the link, set a password → `docker exec -it -w /workspace joserah claude` → `/login` → open the printed address in any browser, sign in, paste the code back → `/exit` → wizard step 4 shows signed in → run the test job → `ready`. Record the result in one line (works / where it failed).
  - Fallback if the in-container sign-in fails: on the host run `claude setup-token`; store the token at once — `node .joserah/tools/secret.js --set anthropic.claude-code.oauth-token` (the vault window opens; type it there) — then start the container with it passed through: `CLAUDE_CODE_OAUTH_TOKEN="$(node .joserah/tools/secret.js anthropic.claude-code.oauth-token)" docker compose -f server/compose.yaml up -d`.
- [ ] **Step 4: Confirm job confinement in the container.** `docker exec -w /workspace joserah bash -c 'mkdir -p .joserah/knowledge && printf "Use the Write tool twice: write ok into .joserah/knowledge/k.txt, then ok into top.txt." | claude -p --output-format json --model haiku --restricted --strict-mcp-config --tools Read,Write --permission-mode dontAsk --permission-prompts none --allowedTools "Write(.joserah/knowledge/**)" --max-budget-usd 0.05 | grep -o "permission_denials.*top.txt" | head -1; ls .joserah/knowledge/k.txt; ls top.txt'`. Expected: a denial naming `top.txt`; `k.txt` exists; `top.txt: No such file`. (Natively this was verified on 2026-10-06.) Remove `k.txt` afterwards.
- [ ] **Step 5: Security review before the first release.** In a Claude Code session in this repository, with `security-guidance` installed, ask for a review of `server/`; every finding becomes a Tracker row or a fix task.
- [ ] **Step 6 (later): Tailscale.** When wanted: `.joserah/server.json` `{"exposure":"tailnet","bind":"<this PC's tailnet address>"}`, restart `joserah serve`; open it from the phone over Tailscale.

---

## Assumptions (Lead, 2026-10-06)

Where the spec, the lessons or the handoff left something open, the plan takes the default below. Each is one setting or one line of code to change if the owner decides otherwise.

1. **Restricted jobs use `--permission-mode dontAsk` with allow rules**, not `--permission-mode default` (the partial head's wording, which `claude --help` 2.1.289 does not list). Verified on this PC on 2026-10-06 with two Haiku probes: the allowed write into `.joserah/knowledge/` landed, the write to `top.txt` was denied (`system/permission_denied`, `result.permission_denials`). The probe repeats inside the container in Task 20.
2. **Turn limit = tool round-trips.** The CLI has no turn flag; the server counts `user` lines carrying a `tool_result` and stops past `jobMaxTurns` (default 60). Timeout default 30 min (spec §5).
3. **Money defaults:** `jobBudgetUsd` 2.00 (passed as `--max-budget-usd`), `dailyBudgetUsd` 10.00. Both are settings.
4. **The server keeps each job's Tracker row, not the model.** Restricted jobs have no Bash, and general jobs run with `--permission-prompts none`, so a model asked to run `tracker.js` could be denied mid-job. The brief tells the model not to edit the Tracker; the server opens, updates and closes the row (zero tokens). This replaces lesson B10's "the brief carries the row id"; B10's "zero-token check afterwards, else an owner row" holds — a done job without a result, with flags, or interrupted becomes an owner row.
5. **Checkpoints are commits in the workspace's own git history**, authored `Joserah Server <server@joserah.invalid>`, with hooks and signing left on. A failing checkpoint refuses the job with an owner row. A workspace without git refuses jobs until wizard step 3 starts the history.
6. **`imports/` is watched by a size-and-mtime manifest**, because it is outside git (rule 4) and a job deleting a raw file must still be seen.
7. **A general job's area** is the whole workspace except `imports/`, `keys/`, `.joserah/config.json`, `.joserah/server.json`, `.claude/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`. The server's own writes (`.joserah/desk/jobs/**`, `.joserah/desk/artifacts/**`) are listed but never flagged; job records are not listed at all.
8. **Two jobs at once** (`maxConcurrentJobs: 2`) share one working tree, so each job's diff can include the other's writes; such jobs carry `overlap: true` on their record.
9. **Sessions are signed cookies** valid 30 days, carrying a generation number: a server restart keeps the owner signed in; a password change signs out every device. Minimum password 10 characters.
10. **The setup token** is printed on the server's console and kept in the state directory; `joserah setup-link` prints it again. No agent copies it into chat, a note or the Tracker.
11. **Pages** are the folders under `.joserah/desk/artifacts/<day>/<folder>/` that hold an `index.html`; the home lists the newest 14 days; reports are the `.md` files in those folders. Answers live per page in `answers.json` beside `rows.json` (`PUT /api/db/<day>/<folder>/answers/<id>`).
12. **A cancel by the owner ends a job `cancelled`**, not `failed` as spec §5 words it; it still keeps the log and raises an owner row.
13. **Acknowledgement-only answers** are a note with no choice matching the Turkish/English list in Task 15 (`tamam`, `ok`, `teşekkürler`, `thanks`, …). A choice is never an acknowledgement. Answers already handed to a job are never handed again.
14. **Wiki limits:** a page over 48 KB is flagged; a raw file not compiled after 7 days is flagged; filed answers go to `.joserah/knowledge/wiki/answers/`; the lint job may write only `.joserah/knowledge/.lint/conflicts.json`; unreadable output is an owner row, never "no conflicts".
15. **Nightly at 03:30 local:** deterministic lint, raw-log rotation (30 days), and the model pass only when `nightlyLlmLint` is on. **No separate nightly "digest" job in v1** — spec §7 mentions one, nothing defines what it digests; it can be a job type later without route changes.
16. **Uploads** up to 25 MB; the credential scan is best effort on binary files (a PDF's text may be compressed).
17. **Strip roles for jobs:** `research`, `query` → Scout; `plan`, `review` → Architect; every other type → Builder.
18. **Docker:** Claude Code through the native installer pinned to 2.1.289 with auto-update off (the npm route is the written fallback); the plugin reaches sessions through the image's `claude` wrapper (`--plugin-dir /opt/joserah`); the image is built for the local platform; the `linux/arm64` build waits until an image is published (spec §4), and runs alone.
19. **`/healthz` is public** and says only alive, signed in, last job ok — no ids, paths or versions.
20. **Worker commit signature** `<model> <effort> — Joserah Worker` (the partial head omitted the effort).
21. **The morning start** (Task 19 step 8) is done by the orchestrator against the owner's workspace, as the handoff asks; its first start appends the two job-log lines to the workspace `.gitignore`. Nothing else in the workspace changes until a job runs.
22. **An empty Docker volume stays untouched** until the wizard scaffolds it: no `.gitignore`, lint file or job record is written before `.joserah/config.json` exists, so the scaffold's own `.gitignore` (with its secret rules) is the one that lands.
23. **Mail gets no extra gate in v1:** general jobs run with `--permission-prompts none`, so any tool that would ask (a send) is denied and the job ends `needs-approval`; restricted jobs load no MCP servers at all.

---

## Self-review (Architect, 2026-10-06)

### 1. Spec coverage

| Spec item | Task |
|---|---|
| Decision 1–4, §1 structure (`server/`, Hono, type stripping, MIT deps, tools reused) | 2, 5 |
| Decision 5 live pages, answers, jobs, wizard | 5, 6, 9–11, 16 |
| Decision 6, §3 exposure local / tailnet / internet, strict login | 2 (`resolveListen`), 4 |
| Decision 7, §4 Docker self-contained, named volumes, GPU optional, native mode | 17, 19 |
| Decision 8, 11 device runner reserved: `target` on every job, `/api/devices` 501 | 2, 9 |
| Decision 9 screens: phone width, TV view | 4 (`PAGE_CSS`), 5 (`/tv`), 18 (390 px check) |
| Decision 10 one `Engine` interface | 8 |
| §1 Store (atomic, events, 2 s poll) | 3 |
| §1 Pages (tools' output, Markdown in the Theme) | 5 |
| §1 Artifact shim (`use("db")`, `hot`) | 6 |
| §1 Jobs (stream, log, cancel, at most 2, default 1) | 8, 9 |
| §1 Home screen (live Tracker, job box, streams, pages) | 11 |
| §2 SSE with Last-Event-ID; answers `PUT`; `tools/answers.js`; brief line; `answerStartsJob`; `--resume`; crew strip | 6, 7, 9, 15 |
| §3 scrypt, cookie flags, Origin, rate limit, redaction, `security-guidance` review | 4, 9, 20 |
| §4 sign-in spike in the container; `setup-token` fallback; backup remote; volume export docs | 16, 19, 20 |
| §5 failure handling (signed out, crash, timeout, cancel, SSE drop → 10 s poll); tests (`app.request`, fake CLI, temp workspace, one Playwright test, `tsc`) | 4, 6, 8, 9, 18, 2 |
| §5 dev skills (ours: Task 1; outside ones: Task 20) | 1, 20 |
| §6 three layers, wiki browser, index, log, claims view, search | 12 |
| §6 ingest, query with "file it" | 13 |
| §6 lint two layers, conflicts as owner rows; anti-drift rule in the ingest brief | 14, 9 |
| §7 (a)–(f) | 9, 2, 15 (conformance file) |
| §8 tool allowlist per type; checkpoint and diff; logs outside the backup; answers never overwrite | 8, 10, 9, 6 |
| Lessons B1–B12 not already in §8 | B1 → 8; B2 → 10; B3 → 8, 14 (fail closed); B4 → 4, 8, 17; B5 → 6; B6 → 9, 14; B7 → 2, 8, 16; B8 → 9; B9 → 13; B10 → 9 (Assumption 4); B11 → 2, 15; B12 → 9, 12, 19 |
| Handoff: no Amplify/AWS; port 4747 on this PC, Tailscale later; publishing off (pages are files); Docker self-contained, Linux | 2, 19 step 8, 20 step 6, 5, 17 |

Gaps left on purpose: the nightly "digest" job (Assumption 15); SQLite full-text (spec: only past ~1,000 notes); OpenRouter and the device runner (out of scope). Watch-sized screens get the phone layout; no separate watch test.

### 2. Placeholder scan

Searched the plan for `TBD`, `TODO`, `implement later`, `fill in`, `similar to Task`, `add appropriate`, `handle edge cases`: none. Every code step carries its code; every test step its test.

### 3. Type and name consistency

- `AppDeps` grows by task and every test helper builds the full set from then on: Task 2 `workspace, stateDir, config, baseUrl, health` · Task 4 `auth, limiter, secureCookies` · Task 6 `store, bus` · Task 9 `engine, jobs, engineHealth` · Task 13 `tracker` · Task 14 `lint` · Task 15 `answers`.
- `JobRecord` fields used by later tasks (`pointers`, `changed`, `flags`, `denials`, `costUsd`, `resultText`, `sessionId`, `fallbackOf`, `overlap`) are all declared in Task 9; `Checkpointer` is declared in Task 9 and implemented in Task 10.
- `TrackerBridge.row({title, state, small, url, label})` and `.crew({role, job, state, row?, reason?})` are the only Tracker calls in Tasks 9, 13, 14.
- `answersLib.reply` returns `{ok, id, doc}` (Task 6) — Tasks 6, 7 and 18 read `id`.
- `EngineRun.done` resolves `{code, signal, spawnError}` (Task 8) — Task 9 reads `spawnError`.
- `composeBrief({task, type, rule?, pointers?})` (Task 9) — Tasks 13–15 pass `pointers` through `submit`, never call it with bodies.
- `wikiLib` declarations in `cjs.ts` (Task 12) match `tools/lib/wiki.js` exports one for one; `SourceEntry` and `WikiFinding` are reused by Tasks 13 and 14.
- `LintOptions` is the scheduler's constructor type (Task 14).

### 4. Review Focus

The five lines above each have their test in the owning task (Tasks 4, 5, 6, 8, 9, 12, 18). Further failure modes checked and pinned along the way: the redaction masking the 36-character `session_id` (Task 9 takes it from the raw event first); a resumed session that no longer exists (Task 9 fallback job from the digest); a job that leaves answers unread (Task 15 never hands them twice); an empty Docker volume (Task 9/14/16 guards); unreadable lint output (Task 14 fails closed); an empty, unreadable or directory-shaped `auth.json` (Task 4).

### 5. Risks an implementer should expect

- `marked` 18's `RendererObject` passes token objects and `this.parser`; if its types differ, adapt `markdown.ts`, keep the tests.
- TypeScript 7.0.2 is the native compiler; if an option above is renamed, follow its message and keep `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`.
- Hono is strict about trailing slashes (Task 5 registers both `/p/:day/:folder/` and `/*`).
- The Tracker template may overflow at 390 px; the fix belongs in `templates/tracker/index.html`, not `tools/tracker.js` (Task 18).
- Windows file locks during `rename` are retried (Tasks 3, 6); a persistent lock surfaces as a failed write, never a silent loss.

## Progress (Lead, 2026-10-06 01:40 — account-switch checkpoint)

- Merged on main and pushed: Tasks 1, 2, 3, 4, 5, 7, 8, 9; Task 6 tools part (`tools/lib/answers.js`); Task 12 tools part (`tools/lib/wiki.js`, `tools/wiki.js`). Server suite 93/93, existing suite 922/922.
- On branches, pushed, not merged (reviewer findings 1–3 each still to fix): `task/t06s-answers-server` (Task 6 server half, 7a9f8b7, suite 109/109), `task/t10-checkpoint` (Task 10, 3948ea9, suite 101/101). Worktrees `../joserah-wt-t06s-answers-server`, `../joserah-wt-t10-checkpoint`; findings in each builder report.
- Remaining: fix + merge 6s and 10 → 11 → 12 (server half) ∥ 15 → 13 → 14 → 16 → 17 (heavy, alone) → 18 (heavy, alone) → 19. Task 20 is the owner's.
- Known gap: Task 9 — a hard server crash can orphan a CLI process.
- 01:54 (Manager): Task 6 server half (t06s, review fixes 4635f73, d392f7b) and Task 10 (t10, fixes 2c07f51, 7ece418) merged; server suite 127/127, existing 922/922.
- 02:01 (Manager): Task 11 (job routes, home, job page; 350645b, a0ed52a) merged (5b53382); server suite 135/135, existing 922/922.
- 02:22 (Manager): Task 12 server half (wiki routes; a7d820a, 801f9ea) merged (d0ee252); server suite 144/144, existing 922/922.
- 02:23 (Manager): Task 15 (token economy; ac7c408, be7ff5a) merged (e5629d5); server suite 152/152, existing 922/922.
