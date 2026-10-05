# Local server — research (2026-10-05)

Input to the brainstorming for Joserah as a local web server (pages served from data files, login, live updates,
Claude Code as the engine behind it, Docker). Sources were opened by the research agents on 2026-10-05; anything not
verified is marked.

## Today's page surface (repo survey, v0.18.0, 881 tests)

- Renderers are zero-dependency Node CLIs writing static `index.html`: `tools/tracker.js` (936 lines; `init|row|crew|<dir>`,
  store `rows.json` `{rows, crew}`), `tools/trail.js` (499; `new|add|render|types`, `trail.json` append-only entries),
  `tools/case.js` (120; `cases.json`), `tools/changelog.js` (124), `tools/lib/theme.js` (54; tokens, console CSS).
- Wrap and reports have no tool: hand-written from `.brand/report.html` placeholders.
- Artifact coupling: page answers via `claude.use("db")` collection `answers` (`ANSWER_JS`, tracker.js 304-337);
  `claude.hot` snapshot/ready (opportunistic, localStorage fallback); publish only via the harness Artifact tool;
  `hooks/tracker-guard.js` (Stop A2/B1/B2) and `hooks/report-fresh.js` key on Artifact publishes and claude.ai links.
- Answers live only in the artifact db — no local file. Nothing in code reads them; the agent uses ArtifactData.
- No server code except the one-shot vault dialog (`templates/memory/tools/lib/vault-dialog.js:153`). No SSE/WebSocket.
- Windows assumed throughout (Git Bash hooks, `C:/` paths, `upd.js` hard-codes the plugin path).

## Engine: driving Claude Code

- TypeScript `@anthropic-ai/claude-agent-sdk` / Python `claude-agent-sdk`; both bundle the native binary and spawn it
  over stdio (code.claude.com/docs/en/agent-sdk/hosting). CLI alternative: `claude -p --output-format stream-json`.
- Sessions: `session_id` → `resume`, `forkSession`; stored under `$CLAUDE_CONFIG_DIR/projects/`.
- Subagents: defined in `query()` options `agents`; "each subagent runs in its own conversation, which starts fresh";
  `omitClaudeMd`; limits on depth/concurrency; `maxBudgetUsd`.
- Permissions: `canUseTool` callback lets our UI answer approvals; `bypassPermissions` refused as root.
- Cost: `total_cost_usd`, `modelUsage` per result — "client-side estimates".
- Docker: documented; ~1 GiB RAM, 1 CPU per agent; `CLAUDE_CONFIG_DIR` on a named volume; run non-root.
- Auth: `ANTHROPIC_API_KEY`, or `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` (subscription).
- Terms (code.claude.com/docs/en/legal-and-compliance): products built with the Agent SDK "should use API key
  authentication"; third parties may not "route requests through Free, Pro, or Max plan credentials on behalf of their
  users"; does not prevent an end user signing in to the unmodified Claude Code binary with their own subscription.
  Reading (inference): own subscription, own machine, own use is tolerable; anything shipped to others → API key.
- "Claude Code" may not be used as the product name.

## OpenRouter

- OpenAI-compatible chat completions with tools (own loop needed). OpenRouter documents pointing Claude Code / Agent SDK
  at it via `ANTHROPIC_BASE_URL=https://openrouter.ai/api`; Anthropic says routing Claude Code to non-Claude models is
  unsupported (code.claude.com/docs/en/llm-gateway).

## Stack

- SSE fits (server → browser stream, POST for answers); 6 connections/domain on HTTP/1.1.
- Windows bind mounts: inotify does not fire for files on the Windows filesystem
  (docs.docker.com/desktop/features/wsl/best-practices) → server emits its own events on its writes + 1–2 s mtime poll.
- Node/TS + Hono (or Fastify) matches the existing Node code and the official SDK; Go has no SDK; Python is a second language.
- Docker Desktop (WSL 2): memory set in `.wslconfig` (none on this PC; default 50% RAM); `.gitattributes eol=lf`.

## Existing projects

- `siteboon/claudecodeui` (AGPL, 13.9k stars, CLI-based, auth not mentioned), `winfunc/opcode` (AGPL, desktop),
  `sugyan/claude-code-webui` (MIT, archived 2026-05-29). Learn from, do not reuse: none serves pages from data files.

## Research recommendation (not a decision)

Node 22+/TypeScript, Hono, data files as source of truth, SSE + mtime poll, Agent SDK per job (fresh session, subagents
in code, `canUseTool` for UI answers, budget cap), password + session cookie on localhost, OpenRouter later.

## Skills for TypeScript / Hono (research 2026-10-05)

- Official `anthropics/skills`: nothing for TypeScript, Node, Hono or Docker. Official plugin marketplace has
  `typescript-lsp` and `security-guidance` (pattern warnings, diff review, commit reviewer; Apache-2.0 repo).
- Hono publishes https://hono.dev/llms.txt (+ llms-full/llms-small) and serves any docs page as Markdown with
  `Accept: text/markdown`. Official skills: github.com/honojs/skills (MIT; `hono`, `hono-jsx`), install
  `/plugin marketplace add honojs/skills` → `/plugin install hono@hono`; its CLI parts assume the unreleased `@hono/cli@next`.
- Community: addyosmani/agent-skills (MIT; TDD, security-and-hardening, generic), antfu/skills (MIT; vitest).
  Unlicensed repos skipped (ChrisWiles, SpillwaveSolutions, shipengqi).
- Node: "Type stripping is enabled by default as of v23.6.0 and v22.18.0"; stable in v24.12.0. No enums/namespaces/
  parameter properties/decorators (`erasableSyntaxOnly`). Node refuses TS inside `node_modules`. `node:test` stable and runs
  `*.test.ts`. Current: Node 24.21.0 LTS, TypeScript 7.0.2.
- Hono 4.13.13 (2026-10-04), MIT, zero dependencies, Web Standards; on Node via `@hono/node-server` 2.1.3 (MIT).
- Recommendation: install `hono@hono`, `security-guidance`, `typescript-lsp`; write our own `joserah-node-ts-strip`,
  `joserah-hono-sse-routes`, `joserah-claude-cli-driver`, `joserah-auth-and-secrets`, `joserah-docker-native-parity`.
