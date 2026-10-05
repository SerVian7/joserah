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
